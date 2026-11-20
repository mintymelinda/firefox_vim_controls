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
  const calls = { removed: [], updated: [], reloaded: [], discarded: [], moved: [] };
  return {
    calls,
    windows: {
      getAll: async () => windows,
      create: async ({ tabId }) => {
        const tab = windows.flatMap((window) => window.tabs).find((item) => item.id === tabId);
        for (const window of windows) {
          window.tabs = window.tabs.filter((item) => item.id !== tabId);
        }
        windows.push({
          id: 20,
          focused: true,
          incognito: false,
          tabs: [tab],
        });
        return { id: 20, tabs: [tab] };
      },
    },
    tabs: {
      remove: async (id) => calls.removed.push(id),
      update: async (id, properties) => calls.updated.push({ id, properties }),
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
