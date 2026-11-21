const test = require("node:test");
const assert = require("node:assert/strict");
const {
  handleMessage,
  clearUndoStack,
  removableTabs,
  resolveMoveTarget,
  validateCommandRequest,
} = require("../src/background/background.js");
const selectors = require("../src/shared/selectors.js");
require("../src/shared/registry.js");
require("../src/shared/command-state.js");
require("../src/shared/session-state.js");
require("../src/shared/macro-state.js");

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
  const syncIndexes = (window) => {
    window.tabs.forEach((tab, index) => {
      tab.index = index;
    });
  };
  windows.forEach(syncIndexes);
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
          syncIndexes(window);
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
        syncIndexes(windows.at(-1));
        calls.windowCreates.push({ id, tabId, url, focused });
        return { id, tabs: createdTabs };
      },
    },
    tabs: {
      query: async (query = {}) =>
        windows
          .filter((window) => query.windowId === undefined || window.id === query.windowId)
          .flatMap((window) =>
            window.tabs.map((tab) => ({
              ...tab,
              incognito: window.incognito,
              windowId: window.id,
            })),
          ),
      sendMessage: async (id, message) => calls.stateBroadcasts.push({ id, message }),
      remove: async (ids) => {
        const values = Array.isArray(ids) ? ids : [ids];
        calls.removed.push(...values);
        for (const window of windows) {
          window.tabs = window.tabs.filter((tab) => !values.includes(tab.id));
          syncIndexes(window);
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
          syncIndexes(window);
        }
      },
      create: async (properties) => {
        calls.tabCreates.push(properties);
        const tab = {
          id: nextTabId++,
          ...properties,
          title: properties.url,
          active: properties.active,
        };
        const window = windows.find((item) => item.id === properties.windowId);
        if (window) {
          window.tabs.push(tab);
          syncIndexes(window);
        }
        return tab;
      },
      goBack: async (id) => calls.wentBack.push(id),
      goForward: async (id) => calls.wentForward.push(id),
      reload: async (id) => calls.reloaded.push(id),
      discard: async (id) => calls.discarded.push(id),
      move: async (ids, properties) => {
        calls.moved.push({ ids, properties });
        const tabIds = Array.isArray(ids) ? ids : [ids];
        const movingTabs = [];
        for (const id of tabIds) {
          for (const window of windows) {
            const index = window.tabs.findIndex((tab) => tab.id === id);
            if (index < 0) continue;
            movingTabs.push(window.tabs.splice(index, 1)[0]);
            syncIndexes(window);
            break;
          }
        }
        const target = windows.find((window) => window.id === properties.windowId);
        if (target) {
          const index = properties.index < 0 ? target.tabs.length : properties.index;
          target.tabs.splice(index, 0, ...movingTabs);
          syncIndexes(target);
        }
        return movingTabs;
      },
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

test("hostname suggestions include only tabs from the requesting privacy context", async () => {
  const api = createBrowserApi();
  const normal = await handleMessage({ type: "VIM_HOSTNAME_SUGGESTIONS" }, api, selectors, {
    tab: { incognito: false },
  });
  const privateResult = await handleMessage({ type: "VIM_HOSTNAME_SUGGESTIONS" }, api, selectors, {
    tab: { incognito: true },
  });

  assert.deepEqual(normal, {
    ok: true,
    hostnames: ["example.com", "twitch.tv", "youtube.com"],
  });
  assert.deepEqual(privateResult, {
    ok: true,
    hostnames: ["private.example"],
  });
  assert.deepEqual(
    await handleMessage({ type: "VIM_HOSTNAME_SUGGESTIONS", extra: true }, api, selectors),
    { ok: false, error: "Unexpected hostname suggestion request properties" },
  );
});

test("plans to close windows when every tab in them is selected", () => {
  const windows = makeWindows().filter((window) => !window.incognito);
  const tabs = windows.flatMap((window) =>
    window.tabs.map((tab) => ({ ...tab, windowId: window.id })),
  );
  const result = removableTabs(tabs, windows);
  assert.deepEqual(result.removable, []);
  assert.deepEqual(
    result.windowsToClose.map((window) => window.id),
    [10, 11],
  );
});

test("removes selected tabs without closing windows that retain other tabs", () => {
  const windows = makeWindows().filter((window) => !window.incognito);
  const selected = windows.flatMap((window) =>
    window.tabs
      .filter((tab) => tab.id === 2 || tab.id === 4)
      .map((tab) => ({ ...tab, windowId: window.id })),
  );
  const result = removableTabs(selected, windows);
  assert.deepEqual(
    result.removable.map((tab) => tab.id),
    [2, 4],
  );
  assert.deepEqual(result.windowsToClose, []);
});

test("closes one selected tab immediately but previews multi-tab closes", async () => {
  const api = createBrowserApi();
  const single = await handleMessage(request("close", ["example"]), api, selectors);
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

test("closes the whole window when its final tab is selected", async () => {
  const api = createBrowserApi();
  const windows = makeWindows();
  windows[0].tabs = [windows[0].tabs[0]];
  api.windows.getAll = async () => windows;
  const onlyTab = await handleMessage(request("close", ["twitch"]), api, selectors);
  assert.deepEqual(onlyTab, {
    ok: true,
    output: ["1 of 1 tab(s) closed."],
  });
  assert.deepEqual(api.calls.removed, []);
  assert.deepEqual(api.calls.windowRemoves, [10]);
  assert.equal(
    windows.some((window) => window.id === 10),
    false,
  );
});

test("closes a multi-tab window instead of removing its tabs individually", async () => {
  const api = createBrowserApi();
  const result = await handleMessage(request("close", ["youtube", "--confirm"]), api, selectors);
  assert.deepEqual(result, {
    ok: true,
    output: ["2 of 2 tab(s) closed."],
  });
  assert.deepEqual(api.calls.removed, []);
  assert.deepEqual(api.calls.windowRemoves, [11]);
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

test("focus activates the most recently used matching tab and its window", async () => {
  const api = createBrowserApi();
  const getAll = api.windows.getAll;
  api.windows.getAll = async (options) => {
    const windows = await getAll(options);
    windows[0].tabs[0].lastAccessed = 100;
    windows[1].tabs[0].lastAccessed = 300;
    windows[1].tabs[1].lastAccessed = 200;
    return windows;
  };

  const result = await handleMessage(request("focus", ["youtube"]), api, selectors);

  assert.deepEqual(api.calls.windowUpdates, [{ id: 11, properties: { focused: true } }]);
  assert.deepEqual(api.calls.updated, [{ id: 3, properties: { active: true } }]);
  assert.match(result.output[0], /Focused tab #3 in window 2: Video/);
});

test("focus reports when no tabs match and requires a selector", async () => {
  const api = createBrowserApi();
  const missing = await handleMessage(request("focus", ["does-not-exist"]), api, selectors);
  assert.deepEqual(missing, { ok: true, output: ['No tabs matched "does-not-exist".'] });
  const missingSelector = await handleMessage(request("focus"), api, selectors);
  assert.deepEqual(missingSelector, {
    ok: false,
    error: "Focus syntax: :focus hostname-selector.",
  });
  assert.deepEqual(api.calls.updated, []);
  assert.deepEqual(api.calls.windowUpdates, []);
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
  api.calls.tabCreates.length = 0;

  const appended = await handleMessage(
    request("session", ["append", "work"]),
    api,
    selectors,
    sender,
  );
  assert.match(appended.output[0], /Appended 4 tab\(s\)/);
  assert.equal(api.calls.tabCreates.length, 4);
  assert.equal(
    api.calls.tabCreates.every((tab) => tab.windowId === 10 && tab.active === false),
    true,
  );
  assert.deepEqual(api.calls.updated.at(-1).properties, { active: true });
});

test("deletes sessions and reports missing records", async () => {
  const api = createBrowserApi();
  const sender = { tab: { incognito: false } };
  await handleMessage(request("session", ["save", "work"]), api, selectors, sender);
  const deleted = await handleMessage(
    request("session", ["delete", "work"]),
    api,
    selectors,
    sender,
  );
  assert.match(deleted.output[0], /Deleted session "work"/);
  assert.deepEqual(Object.keys(api.storageData.fvcSessions), []);
  assert.equal(api.storageData.fvcLastSessionName, "");
  const missing = await handleMessage(request("session", ["load", "work"]), api, selectors, sender);
  assert.match(missing.error, /No saved session named/);
});

test("creates, lists, switches, and renames workspaces", async () => {
  const api = createBrowserApi();
  const sender = { tab: { incognito: false } };
  const created = await handleMessage(
    request("workspace", ["create", "streaming"]),
    api,
    selectors,
    sender,
  );
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

test("rolls back windows created before a session restore failure", async () => {
  const api = createBrowserApi();
  const sender = { tab: { incognito: false } };
  await handleMessage(request("session", ["save", "work"]), api, selectors, sender);
  const createWindow = api.windows.create;
  let attempts = 0;
  api.windows.create = async (options) => {
    attempts += 1;
    if (attempts === 2) throw new Error("second window failed");
    return createWindow(options);
  };
  const result = await handleMessage(request("session", ["load", "work"]), api, selectors, sender);
  assert.equal(result.ok, false);
  assert.match(result.error, /Session restore failed after creating 1 window/);
  assert.deepEqual(api.calls.windowRemoves, [20]);
});

test("rolls back tabs appended before a session append failure", async () => {
  const api = createBrowserApi();
  const sender = { tab: { incognito: false } };
  await handleMessage(request("session", ["save", "work"]), api, selectors, sender);
  const createTab = api.tabs.create;
  let attempts = 0;
  api.tabs.create = async (properties) => {
    attempts += 1;
    if (attempts === 2) throw new Error("tab creation failed");
    return createTab(properties);
  };
  const result = await handleMessage(
    request("session", ["append", "work"]),
    api,
    selectors,
    sender,
  );
  assert.equal(result.ok, false);
  assert.match(result.error, /Session append failed after creating 1 tab/);
  assert.deepEqual(api.calls.removed, [50]);
});

test("rejects invalid session command syntax and missing focused append target", async () => {
  const api = createBrowserApi();
  const sender = { tab: { incognito: false } };
  const missingAction = await handleMessage(request("session"), api, selectors, sender);
  assert.match(missingAction.error, /Session syntax/);
  await handleMessage(request("session", ["save", "work"]), api, selectors, sender);
  const originalGetAll = api.windows.getAll;
  api.windows.getAll = async () =>
    (await originalGetAll()).map((window) => ({
      ...window,
      focused: false,
    }));
  const append = await handleMessage(
    request("session", ["append", "work"]),
    api,
    selectors,
    sender,
  );
  assert.match(append.error, /There is no focused normal browser window/);
});

test("persists and validates macros through the background message boundary", async () => {
  const api = createBrowserApi();
  const sender = { tab: { id: 1, incognito: false } };
  const commands = [
    { name: "tabs", args: ["twitch"], destination: [] },
    { name: "count", args: ["all"], destination: [] },
  ];
  const saved = await handleMessage(
    { type: "VIM_MACRO_SET", name: "stream", commands },
    api,
    selectors,
    sender,
  );
  assert.equal(saved.ok, true);
  assert.deepEqual(api.storageData.fvcCommandMacros.stream.commands, commands);

  const loaded = await handleMessage(
    { type: "VIM_MACRO_GET", name: "stream" },
    api,
    selectors,
    sender,
  );
  assert.deepEqual(loaded.commands, commands);

  const listed = await handleMessage({ type: "VIM_MACRO_GET" }, api, selectors, sender);
  assert.deepEqual(listed.macros, [{ name: "stream", commands: 2 }]);

  const invalid = await handleMessage(
    {
      type: "VIM_MACRO_SET",
      name: "unsafe",
      commands: [{ name: "eval", args: ["alert(1)"], destination: [] }],
    },
    api,
    selectors,
    sender,
  );
  assert.equal(invalid.ok, false);
  assert.match(invalid.error, /invalid or unsupported/);

  const deleted = await handleMessage(
    { type: "VIM_MACRO_DELETE", name: "stream" },
    api,
    selectors,
    sender,
  );
  assert.equal(deleted.ok, true);
  assert.deepEqual(Object.keys(api.storageData.fvcCommandMacros), []);
});

test("macro storage is never accessed from private tabs", async () => {
  const api = createBrowserApi();
  const sender = { tab: { id: 9, incognito: true } };
  const beforeGets = api.calls.storageGets.length;
  const beforeSets = api.calls.storageSets.length;
  const result = await handleMessage({ type: "VIM_MACRO_GET" }, api, selectors, sender);
  assert.equal(result.ok, false);
  assert.match(result.error, /disabled in private browsing/);
  assert.equal(api.calls.storageGets.length, beforeGets);
  assert.equal(api.calls.storageSets.length, beforeSets);
});

test("undo restores tabs moved into a new window", async () => {
  clearUndoStack();
  const api = createBrowserApi();
  const sender = { tab: { incognito: false } };
  const moved = await handleMessage(
    request("move", ["twitch"], ["new_window"]),
    api,
    selectors,
    sender,
  );
  assert.equal(moved.ok, true);
  assert.deepEqual(
    (await api.windows.getAll()).find((window) => window.id === 10).tabs.map((tab) => tab.id),
    [2],
  );

  const undone = await handleMessage(request("undo"), api, selectors, sender);
  assert.equal(undone.ok, true);
  assert.match(undone.output[0], /Undid move/);
  assert.deepEqual(
    (await api.windows.getAll()).find((window) => window.id === 10).tabs.map((tab) => tab.id),
    [1, 2],
  );
  assert.equal(
    (await api.windows.getAll()).some((window) => window.id === 20),
    false,
  );
});

test("undo restores previous pinned and muted state", async () => {
  clearUndoStack();
  const api = createBrowserApi();
  const sender = { tab: { incognito: false } };
  await handleMessage(request("pin", ["twitch"]), api, selectors, sender);
  const pinUndo = await handleMessage(request("undo"), api, selectors, sender);
  assert.equal(pinUndo.ok, true);
  assert.ok(api.calls.updated.some((call) => call.id === 1 && call.properties.pinned === false));

  await handleMessage(request("mute", ["twitch"]), api, selectors, sender);
  const muteUndo = await handleMessage(request("undo"), api, selectors, sender);
  assert.equal(muteUndo.ok, true);
  assert.ok(api.calls.updated.some((call) => call.id === 1 && call.properties.muted === false));
});

test("undo restores original tab ordering after sort or reverse", async () => {
  clearUndoStack();
  const api = createBrowserApi();
  const sender = { tab: { incognito: false } };
  await handleMessage(request("reverse", ["all"]), api, selectors, sender);
  assert.deepEqual(
    (await api.windows.getAll()).find((window) => window.id === 10).tabs.map((tab) => tab.id),
    [2, 1],
  );
  const undone = await handleMessage(request("undo"), api, selectors, sender);
  assert.equal(undone.ok, true);
  assert.deepEqual(
    (await api.windows.getAll()).find((window) => window.id === 10).tabs.map((tab) => tab.id),
    [1, 2],
  );
});

test("undo restores tabs to source windows after merge", async () => {
  clearUndoStack();
  const api = createBrowserApi();
  const sender = { tab: { incognito: false } };
  await handleMessage(request("merge"), api, selectors, sender);
  assert.deepEqual((await api.windows.getAll()).find((window) => window.id === 11).tabs, []);
  await api.windows.remove(11);
  const undone = await handleMessage(request("undo"), api, selectors, sender);
  assert.equal(undone.ok, true);
  const restoredWindow = (await api.windows.getAll()).find((window) =>
    window.tabs.some((tab) => tab.id === 3),
  );
  assert.notEqual(restoredWindow.id, 11);
  assert.deepEqual(
    restoredWindow.tabs.map((tab) => tab.id),
    [3, 4],
  );
});

test("irreversible commands clear undo history and private undo is blocked", async () => {
  clearUndoStack();
  const api = createBrowserApi();
  const sender = { tab: { incognito: false } };
  await handleMessage(request("pin", ["twitch"]), api, selectors, sender);
  await handleMessage(request("tabs", ["all"]), api, selectors, sender);
  const stillAvailable = await handleMessage(request("undo"), api, selectors, sender);
  assert.equal(stillAvailable.ok, true);

  await handleMessage(request("pin", ["twitch"]), api, selectors, sender);
  await handleMessage(request("reload", ["active"]), api, selectors, sender);
  const cleared = await handleMessage(request("undo"), api, selectors, sender);
  assert.equal(cleared.ok, false);
  assert.match(cleared.error, /There is no supported command to undo/);

  const privateUndo = await handleMessage(request("undo"), api, selectors, {
    tab: { incognito: true },
  });
  assert.equal(privateUndo.ok, false);
  assert.match(privateUndo.error, /private browsing/);
});

test("confirmation previews stop destructive actions without clearing undo", async () => {
  clearUndoStack();
  const api = createBrowserApi();
  const sender = { tab: { incognito: false } };
  await handleMessage(request("pin", ["twitch"]), api, selectors, sender);
  const preview = await handleMessage(request("close", ["all"]), api, selectors, sender);
  assert.equal(preview.ok, true);
  assert.equal(preview.requiresConfirmation, true);
  const undone = await handleMessage(request("undo"), api, selectors, sender);
  assert.equal(undone.ok, true);
  assert.ok(api.calls.updated.some((call) => call.id === 1 && call.properties.pinned === false));
});
