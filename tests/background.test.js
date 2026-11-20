const test = require("node:test");
const assert = require("node:assert/strict");
const {
  handleMessage,
  removableTabs,
  resolveMoveTarget,
  validateCommandRequest,
} = require("../src/background/background.js");
const selectors = require("../src/shared/selectors.js");
require("../src/shared/registry.js");
require("../src/shared/command-state.js");
require("../src/shared/session-state.js");

function makeWindows() {
  return [
    {
      id: 10,
      focused: true,
      incognito: false,
      tabs: [
        { id: 1, url: "https://www.twitch.tv/a", title: "Twitch", active: true },
        { id: 2, url: "https://example.com", title: "Example", audible: true },
      ],
    },
    {
      id: 11,
      focused: false,
      incognito: false,
      tabs: [
        { id: 3, url: "https://www.youtube.com/watch?v=1", title: "Video" },
        { id: 4, url: "https://youtube.com/watch?v=1#comments", title: "Video copy" },
      ],
    },
    {
      id: 12,
      focused: false,
      incognito: true,
      tabs: [{ id: 5, url: "https://private.example", title: "Private" }],
    },
  ];
}

function createBrowserApi() {
  const windows = makeWindows();
  const calls = {
    removed: [],
    updated: [],
    reloaded: [],
    discarded: [],
    moved: [],
    windowUpdates: [],
    windowCreates: [],
    windowRemoves: [],
    tabCreates: [],
    wentBack: [],
    wentForward: [],
    storageGets: [],
    storageSets: [],
    stateBroadcasts: [],
  };
  const storageData = {};
  let nextWindowId = 20;
  let nextTabId = 50;
  return {
    calls,
    storageData,
    storage: {
      local: {
        get: async (keys) => {
          calls.storageGets.push(keys);
          return Object.fromEntries(keys.map((key) => [key, storageData[key]]));
        },
        set: async (values) => {
          calls.storageSets.push(values);
          Object.assign(storageData, values);
        },
      },
    },
    windows: {
      getAll: async () => windows,
      update: async (id, properties) => {
        calls.windowUpdates.push({ id, properties });
        return { id, ...properties };
      },
      remove: async (id) => {
        calls.windowRemoves.push(id);
        const index = windows.findIndex((window) => window.id === id);
        if (index >= 0) windows.splice(index, 1);
      },
      create: async ({ tabId, url, focused } = {}) => {
        const id = nextWindowId++;
        const tab = tabId
          ? windows.flatMap((window) => window.tabs).find((item) => item.id === tabId)
          : undefined;
        for (const window of windows) {
          window.tabs = window.tabs.filter((item) => item.id !== tabId);
        }
        const createdTabs = tab
          ? [tab]
          : url
            ? [{ id: nextTabId++, url, title: url, active: true, pinned: false }]
            : [];
        windows.push({
          id,
          focused: focused !== false,
          incognito: false,
          state: "normal",
          tabs: createdTabs,
        });
        calls.windowCreates.push({ id, tabId, url, focused });
        return { id, tabs: createdTabs };
      },
    },
    tabs: {
      query: async (query = {}) =>
        windows
          .filter((window) => query.windowId === undefined || window.id === query.windowId)
          .flatMap((window) =>
            window.tabs.map((tab) => ({ ...tab, incognito: window.incognito, windowId: window.id })),
          ),
      sendMessage: async (id, message) => calls.stateBroadcasts.push({ id, message }),
      remove: async (ids) => {
        const values = Array.isArray(ids) ? ids : [ids];
        calls.removed.push(...values);
        for (const window of windows) {
          window.tabs = window.tabs.filter((tab) => !values.includes(tab.id));
        }
      },
      update: async (id, properties) => {
        calls.updated.push({ id, properties });
        for (const window of windows) {
          const tab = window.tabs.find((item) => item.id === id);
          if (!tab) continue;
          if (properties.active) {
            for (const item of window.tabs) item.active = item.id === id;
          }
          Object.assign(tab, properties);
        }
      },
      create: async (properties) => {
        calls.tabCreates.push(properties);
        const tab = { id: nextTabId++, ...properties, title: properties.url, active: properties.active };
        const window = windows.find((item) => item.id === properties.windowId);
        if (window) window.tabs.push(tab);
        return tab;
      },
      goBack: async (id) => calls.wentBack.push(id),
      goForward: async (id) => calls.wentForward.push(id),
      reload: async (id) => calls.reloaded.push(id),
      discard: async (id) => calls.discarded.push(id),
      move: async (ids, properties) => calls.moved.push({ ids, properties }),
    },
  };
}

function request(name, args = [], destination = []) {
  return {
    type: "VIM_COMMAND_REQUEST",
    command: { name, args, destination },
  };
}

test("validates command message shape and rejects unexpected data", () => {
  assert.equal(validateCommandRequest(request("tabs")), null);
  assert.match(validateCommandRequest({ type: "OTHER" }), /message type/);
  assert.match(validateCommandRequest(request("tabs").command), /message type/);
  assert.match(
    validateCommandRequest({
      ...request("tabs"),
      command: { ...request("tabs").command, extra: true },
    }),
    /Unexpected command properties/,
  );
  assert.match(
    validateCommandRequest(request("tabs", ["x".repeat(257)])),
    /Invalid command arguments/,
  );
  assert.equal(
    validateCommandRequest(request("open", [`https://example.com/?q=${"x".repeat(1000)}`])),
    null,
  );
});

test("supports read-only inspection and excludes private windows", async () => {
  const api = createBrowserApi();
  const tabs = await handleMessage(request("tabs"), api, selectors);
  const current = await handleMessage(request("current"), api, selectors);
  const domains = await handleMessage(request("domains"), api, selectors);
  const duplicates = await handleMessage(request("duplicates"), api, selectors);

  assert.equal(tabs.output.length, 4);
  assert.equal(
    tabs.output.some((line) => line.includes("private.example")),
    false,
  );
  assert.match(current.output[0], /Twitch/);
  assert.deepEqual(domains.output, ["example.com", "twitch.tv", "youtube.com"]);
  assert.match(duplicates.output[0], /Duplicate group/);
});

test("protects the final tab in every window during close operations", () => {
  const windows = makeWindows().filter((window) => !window.incognito);
  const tabs = windows.flatMap((window) =>
    window.tabs.map((tab) => ({ ...tab, windowId: window.id })),
  );
  const result = removableTabs(tabs, windows);
  assert.deepEqual(
    result.removable.map((tab) => tab.id),
    [2, 4],
  );
  assert.equal(result.protectedCount, 2);
});

test("closes one selected tab immediately but previews multi-tab closes", async () => {
  const api = createBrowserApi();
  const single = await handleMessage(request("close", ["domain:example.com"]), api, selectors);
  assert.deepEqual(api.calls.removed, [2]);
  assert.match(single.output[0], /1 of 1 tab/);

  const getAll = api.windows.getAll;
  api.windows.getAll = async () => {
    const windows = await getAll();
    if (!windows[1].tabs.some((tab) => tab.id === 6)) {
      windows[1].tabs.push({
        id: 6,
        url: "https://other.example",
        title: "Keep open",
      });
    }
    return windows;
  };
  const preview = await handleMessage(request("close", ["youtube"]), api, selectors);
  assert.equal(preview.output[0], 'Preview: close would affect 2 tab(s) matching "youtube".');
  assert.deepEqual(api.calls.removed, [2]);

  const confirmed = await handleMessage(request("close", ["youtube", "--confirm"]), api, selectors);
  assert.deepEqual(api.calls.removed, [2, 3, 4]);
  assert.match(confirmed.output[0], /2 of 2 tab/);
});

test("does not close the last tab in a window", async () => {
  const api = createBrowserApi();
  const windows = makeWindows();
  windows[0].tabs = [windows[0].tabs[0]];
  api.windows.getAll = async () => windows;
  const onlyTab = await handleMessage(request("close", ["twitch"]), api, selectors);
  assert.deepEqual(onlyTab, {
    ok: true,
    output: ["The selected tabs are the last tabs in their windows; nothing was closed."],
  });
  assert.deepEqual(api.calls.removed, []);
});

test("moves selected tabs to a new or existing normal window", async () => {
  const api = createBrowserApi();
  const newWindow = await handleMessage(
    request("move", ["youtube"], ["new_window"]),
    api,
    selectors,
  );
  assert.deepEqual(api.calls.moved, [{ ids: [4], properties: { windowId: 20, index: -1 } }]);
  assert.match(newWindow.output[0], /new window 20/);

  const existing = await handleMessage(
    request("move", ["twitch"], ["window", "2"]),
    api,
    selectors,
  );
  assert.deepEqual(api.calls.moved[1], {
    ids: [1],
    properties: { windowId: 11, index: -1 },
  });
  assert.match(existing.output[0], /window 2/);
});

test("applies reload, audio, pin, and discard operations safely", async () => {
  const api = createBrowserApi();
  const reloadPreview = await handleMessage(request("reload", ["youtube"]), api, selectors);
  assert.match(reloadPreview.output[0], /Preview: reload/);
  const reload = await handleMessage(request("reload", ["youtube", "--confirm"]), api, selectors);
  assert.deepEqual(api.calls.reloaded, [3, 4]);
  assert.match(reload.output[0], /2 of 2 tab/);

  await handleMessage(request("mute", ["audible"]), api, selectors);
  await handleMessage(request("unmute", ["audible"]), api, selectors);
  await handleMessage(request("pin", ["twitch"]), api, selectors);
  await handleMessage(request("unpin", ["twitch"]), api, selectors);
  assert.deepEqual(
    api.calls.updated.map((call) => call.properties),
    [{ muted: true }, { muted: false }, { pinned: true }, { pinned: false }],
  );

  const discardPreview = await handleMessage(request("discard"), api, selectors);
  assert.match(discardPreview.output[0], /Preview: discard/);
  const discard = await handleMessage(request("discard", ["--confirm"]), api, selectors);
  assert.deepEqual(api.calls.discarded, [2, 3, 4]);
  assert.match(discard.output[0], /3 of 3 tab/);
  assert.match(discard.output[1], /Skipped 1 active/);
});

test("validates move destinations and preserves read-only inspection commands", async () => {
  assert.throws(() => resolveMoveTarget(["private_window"], [], null), /Move destination/);
  const api = createBrowserApi();
  const result = await handleMessage(request("count", ["youtube"]), api, selectors);
  assert.deepEqual(result.output, ["2 tab(s) matched youtube."]);
});

test("lists, focuses, creates, and changes normal window states", async () => {
  const api = createBrowserApi();
  const windows = await handleMessage(request("windows"), api, selectors);
  assert.equal(windows.output.length, 2);
  assert.match(windows.output[0], /Window 1/);

  const focus = await handleMessage(request("window", ["2"]), api, selectors);
  assert.match(focus.output[0], /Focused window 2/);
  assert.deepEqual(api.calls.windowUpdates[0], { id: 11, properties: { focused: true } });

  const created = await handleMessage(request("new_window"), api, selectors);
  assert.match(created.output[0], /Created normal window/);

  await handleMessage(request("maximize"), api, selectors);
  assert.deepEqual(api.calls.windowUpdates[1], { id: 10, properties: { state: "maximized" } });
});

test("merges selected windows and splits matching tabs into a new window", async () => {
  const api = createBrowserApi();
  const merged = await handleMessage(request("merge", ["2"]), api, selectors);
  assert.match(merged.output[0], /Moved 2 tab/);
  assert.deepEqual(api.calls.moved[0], {
    ids: [3, 4],
    properties: { windowId: 10, index: -1 },
  });

  const split = await handleMessage(request("split", ["twitch"]), api, selectors);
  assert.match(split.output[0], /new window/);
  assert.equal(api.calls.windowCreates.length, 1);
});

test("sorts, reverses, and shuffles within pinned and unpinned partitions", async () => {
  const api = createBrowserApi();
  const sorted = await handleMessage(request("sort", ["title"]), api, selectors);
  assert.match(sorted.output[0], /Sorted by title/);
  assert.ok(api.calls.moved.length > 0);

  const reversed = await handleMessage(request("reverse"), api, selectors);
  assert.match(reversed.output[0], /reverse selection/);

  const shuffled = await handleMessage(request("shuffle"), api, selectors);
  assert.match(shuffled.output[0], /shuffle selection/);
});

test("sorting keeps pinned and unpinned tabs in their own positions", async () => {
  const api = createBrowserApi();
  const window = {
    id: 30,
    focused: true,
    incognito: false,
    tabs: [
      { id: 1, title: "Z pinned", pinned: true, index: 0 },
      { id: 3, title: "A pinned", pinned: true, index: 1 },
      { id: 2, title: "Z regular", pinned: false, index: 2 },
      { id: 4, title: "A regular", pinned: false, index: 3 },
    ],
  };
  api.windows.getAll = async () => [window];
  const result = await handleMessage(request("sort", ["title"]), api, selectors);
  assert.match(result.output[0], /Sorted by title/);
  assert.deepEqual(
    api.calls.moved.map((call) => ({ id: call.ids, index: call.properties.index })),
    [
      { id: 3, index: 0 },
      { id: 4, index: 2 },
    ],
  );
});

test("opens safe URLs and shortcuts in the requested destination", async () => {
  const api = createBrowserApi();
  const opened = await handleMessage(request("open", ["twitch"]), api, selectors);
  assert.match(opened.output[0], /https:\/\/www\.twitch\.tv\//);
  assert.deepEqual(api.calls.updated[0], {
    id: 1,
    properties: { url: "https://www.twitch.tv/" },
  });

  const newTab = await handleMessage(
    request("open", ["https://example.com/path"], ["new_tab"]),
    api,
    selectors,
  );
  assert.match(newTab.output[0], /new tab/);
  assert.deepEqual(api.calls.tabCreates[0], {
    windowId: 10,
    url: "https://example.com/path",
    active: true,
  });

  const newWindow = await handleMessage(
    request("open", ["example.org"], ["new_window"]),
    api,
    selectors,
  );
  assert.match(newWindow.output[0], /new window/);
  assert.equal(api.calls.windowCreates[0].url, "https://example.org/");
});

test("rejects unsafe URL schemes and embedded credentials", async () => {
  const api = createBrowserApi();
  const scriptUrl = await handleMessage(request("open", ["javascript:alert(1)"]), api, selectors);
  const credentialUrl = await handleMessage(
    request("open", ["https://user:secret@example.com"]),
    api,
    selectors,
  );
  assert.match(scriptUrl.error, /Only HTTP and HTTPS/);
  assert.match(credentialUrl.error, /embedded credentials/);
  assert.deepEqual(api.calls.updated, []);
});

test("searches the web and navigates tab history", async () => {
  const api = createBrowserApi();
  await handleMessage(request("search", ["cats", "and", "dogs"]), api, selectors);
  const searchUrl = new URL(api.calls.updated[0].properties.url);
  assert.equal(searchUrl.origin, "https://duckduckgo.com");
  assert.equal(searchUrl.searchParams.get("q"), "cats and dogs");

  const back = await handleMessage(request("back", ["youtube"]), api, selectors);
  assert.deepEqual(api.calls.wentBack, [3, 4]);
  assert.match(back.output[0], /Navigated back 2 of 2/);

  const forward = await handleMessage(request("forward"), api, selectors);
  assert.deepEqual(api.calls.wentForward, [1]);
  assert.match(forward.output[0], /Navigated forward 1 of 1/);
});

test("refresh defaults to the active tab and previews broad refreshes", async () => {
  const api = createBrowserApi();
  const active = await handleMessage(request("refresh"), api, selectors);
  assert.deepEqual(api.calls.reloaded, [1]);
  assert.match(active.output[0], /Refreshed 1 of 1/);

  const preview = await handleMessage(request("refresh", ["all"]), api, selectors);
  assert.match(preview.output[0], /Preview: refresh would affect 4 tab/);
  assert.deepEqual(api.calls.reloaded, [1]);
  api.calls.reloaded.length = 0;

  const confirmed = await handleMessage(request("refresh", ["all", "--confirm"]), api, selectors);
  assert.deepEqual(api.calls.reloaded, [1, 2, 3, 4]);
  assert.match(confirmed.output[0], /Refreshed 4 of 4/);
});

test("home navigates the active tab and stop remains explicitly planned", async () => {
  const api = createBrowserApi();
  const home = await handleMessage(request("home"), api, selectors);
  assert.deepEqual(api.calls.updated[0], {
    id: 1,
    properties: { url: "about:home" },
  });
  assert.match(home.output[0], /home page/);

  const stop = await handleMessage(request("stop"), api, selectors);
  assert.match(stop.error, /not implemented yet/);
});

test("persists normalized command state for normal tabs only", async () => {
  const api = createBrowserApi();
  const normalSender = { tab: { id: 1, incognito: false } };
  const privateSender = { tab: { incognito: true } };
  const initial = await handleMessage({ type: "VIM_STATE_GET" }, api, selectors, normalSender);
  assert.equal(initial.ok, true);
  assert.deepEqual(initial.state, {
    history: [],
    aliases: {},
    preferences: { historyLimit: 100, searchEngine: "duckduckgo" },
  });

  const saved = await handleMessage(
    {
      type: "VIM_STATE_SET",
      state: {
        history: [":tabs", ":move twitch, new_window"],
        aliases: {
          stream: {
            command: { name: "move", args: ["twitch"], destination: ["new_window"] },
          },
          nested: {
            command: { name: "alias", args: ["other"], destination: [] },
          },
        },
        preferences: { historyLimit: 20, searchEngine: "google" },
      },
    },
    api,
    selectors,
    normalSender,
  );
  assert.deepEqual(saved, { ok: true, persisted: true });
  assert.deepEqual(
    api.calls.stateBroadcasts.map((item) => item.id),
    [2, 3, 4],
  );

  const loaded = await handleMessage({ type: "VIM_STATE_GET" }, api, selectors, normalSender);
  assert.deepEqual(loaded.state.history, [":tabs", ":move twitch, new_window"]);
  assert.deepEqual(Object.keys(loaded.state.aliases), ["stream"]);
  assert.deepEqual(loaded.state.preferences, {
    historyLimit: 20,
    searchEngine: "google",
  });

  const getCount = api.calls.storageGets.length;
  const setCount = api.calls.storageSets.length;
  const broadcastCount = api.calls.stateBroadcasts.length;
  const privateRead = await handleMessage({ type: "VIM_STATE_GET" }, api, selectors, privateSender);
  const privateWrite = await handleMessage(
    {
      type: "VIM_STATE_SET",
      state: {
        history: [":open https://private.example"],
        aliases: {},
        preferences: { historyLimit: 100, searchEngine: "duckduckgo" },
      },
    },
    api,
    selectors,
    privateSender,
  );
  assert.equal(privateRead.persisted, false);
  assert.deepEqual(privateRead.state.history, []);
  assert.deepEqual(privateWrite, { ok: true, persisted: false });
  assert.equal(api.calls.storageGets.length, getCount);
  assert.equal(api.calls.storageSets.length, setCount);
  assert.equal(api.calls.stateBroadcasts.length, broadcastCount);
});

test("rejects malformed command state messages", async () => {
  const api = createBrowserApi();
  assert.match(
    (await handleMessage({ type: "VIM_STATE_SET", state: { history: [] } }, api, selectors)).error,
    /Invalid state values/,
  );
  assert.match(
    (await handleMessage({ type: "VIM_STATE_GET", extra: true }, api, selectors)).error,
    /Unexpected state message properties/,
  );
});


test("saves, lists, loads, appends, and restores named sessions", async () => {
  const api = createBrowserApi();
  const sender = { tab: { id: 1, incognito: false } };
  const saved = await handleMessage(request("session", ["save", "work"]), api, selectors, sender);
  assert.match(saved.output[0], /Saved session "work"/);
  assert.equal(api.storageData.fvcSessions.work.snapshot.windows.length, 2);
  assert.equal(api.storageData.fvcSessions.work.snapshot.windows[0].tabs.length, 2);
  assert.equal(api.storageData.fvcLastSessionName, "work");

  const listed = await handleMessage(request("session", ["list"]), api, selectors, sender);
  assert.match(listed.output[0], /work — 2 window\(s\), 4 tab\(s\)/);

  const loaded = await handleMessage(request("session", ["load", "work"]), api, selectors, sender);
  assert.match(loaded.output[0], /2 new window\(s\)/);
  assert.equal(api.calls.windowCreates.length, 2);
  assert.equal(api.calls.tabCreates.length, 2);
  assert.deepEqual(api.calls.windowUpdates.at(-1), {
    id: 20,
    properties: { focused: true },
  });

  api.calls.windowCreates.length = 0;
  api.calls.tabCreates.length = 0;
  const restored = await handleMessage(request("session", ["restore"]), api, selectors, sender);
  assert.match(restored.output[0], /Loaded session "work"/);
  assert.equal(api.calls.windowCreates.length, 2);

  const appended = await handleMessage(request("session", ["append", "work"]), api, selectors, sender);
  assert.match(appended.output[0], /Appended 4 tab\(s\)/);
  assert.equal(api.calls.tabCreates.length, 4);
  assert.equal(api.calls.tabCreates.every((tab) => tab.windowId === 10 && tab.active === false), true);
  assert.deepEqual(api.calls.updated.at(-1).properties, { active: true });
});

test("deletes sessions and reports missing records", async () => {
  const api = createBrowserApi();
  const sender = { tab: { incognito: false } };
  await handleMessage(request("session", ["save", "work"]), api, selectors, sender);
  const deleted = await handleMessage(request("session", ["delete", "work"]), api, selectors, sender);
  assert.match(deleted.output[0], /Deleted session "work"/);
  assert.deepEqual(Object.keys(api.storageData.fvcSessions), []);
  assert.equal(api.storageData.fvcLastSessionName, "");
  const missing = await handleMessage(request("session", ["load", "work"]), api, selectors, sender);
  assert.match(missing.error, /No saved session named/);
});

test("creates, lists, switches, and renames workspaces", async () => {
  const api = createBrowserApi();
  const sender = { tab: { incognito: false } };
  const created = await handleMessage(request("workspace", ["create", "streaming"]), api, selectors, sender);
  assert.match(created.output[0], /Created workspace "streaming"/);
  const duplicate = await handleMessage(
    request("workspace", ["create", "streaming"]),
    api,
    selectors,
    sender,
  );
  assert.match(duplicate.error, /already exists/);

  const listed = await handleMessage(request("workspace", ["list"]), api, selectors, sender);
  assert.match(listed.output[0], /streaming — 2 window\(s\), 4 tab\(s\)/);

  const switched = await handleMessage(
    request("workspace", ["switch", "streaming"]),
    api,
    selectors,
    sender,
  );
  assert.match(switched.output[0], /Opened workspace "streaming"/);
  assert.equal(api.calls.windowCreates.length, 2);

  const renamed = await handleMessage(
    request("workspace", ["rename", "streaming", "studio"]),
    api,
    selectors,
    sender,
  );
  assert.match(renamed.output[0], /Renamed workspace "streaming" to "studio"/);
  assert.deepEqual(Object.keys(api.storageData.fvcWorkspaces), ["studio"]);
});

test("session and workspace commands never access storage from private tabs", async () => {
  const api = createBrowserApi();
  const beforeGets = api.calls.storageGets.length;
  const beforeSets = api.calls.storageSets.length;
  const sender = { tab: { id: 5, incognito: true } };
  const session = await handleMessage(request("session", ["list"]), api, selectors, sender);
  const workspace = await handleMessage(request("workspace", ["list"]), api, selectors, sender);
  assert.match(session.error, /disabled in private browsing/);
  assert.match(workspace.error, /disabled in private browsing/);
  assert.equal(api.calls.storageGets.length, beforeGets);
  assert.equal(api.calls.storageSets.length, beforeSets);
});

test("session restoration reports browser API failures without closing existing tabs", async () => {
  const api = createBrowserApi();
  const sender = { tab: { incognito: false } };
  await handleMessage(request("session", ["save", "work"]), api, selectors, sender);
  api.windows.create = async () => {
    throw new Error("window creation blocked");
  };
  const result = await handleMessage(request("session", ["load", "work"]), api, selectors, sender);
  assert.equal(result.ok, false);
  assert.match(result.error, /window creation blocked/);
  assert.deepEqual(api.calls.removed, []);
});
