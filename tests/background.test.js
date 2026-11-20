const test = require("node:test");
const assert = require("node:assert/strict");
const {
  handleMessage,
  removableTabs,
  resolveMoveTarget,
  validateCommandRequest,
} = require("../src/background/background.js");
const selectors = require("../src/shared/selectors.js");

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
    tabCreates: [],
    wentBack: [],
    wentForward: [],
  };
  let nextWindowId = 20;
  return {
    calls,
    windows: {
      getAll: async () => windows,
      update: async (id, properties) => {
        calls.windowUpdates.push({ id, properties });
        return { id, ...properties };
      },
      create: async ({ tabId, url } = {}) => {
        const id = nextWindowId++;
        const tab = tabId
          ? windows.flatMap((window) => window.tabs).find((item) => item.id === tabId)
          : undefined;
        for (const window of windows) {
          window.tabs = window.tabs.filter((item) => item.id !== tabId);
        }
        const createdTabs = tab ? [tab] : [];
        windows.push({
          id,
          focused: true,
          incognito: false,
          state: "normal",
          tabs: createdTabs,
        });
        calls.windowCreates.push({ id, tabId, url });
        return { id, tabs: createdTabs };
      },
    },
    tabs: {
      remove: async (id) => calls.removed.push(id),
      update: async (id, properties) => calls.updated.push({ id, properties }),
      create: async (properties) => {
        calls.tabCreates.push(properties);
        return { id: 40 + calls.tabCreates.length, ...properties };
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
