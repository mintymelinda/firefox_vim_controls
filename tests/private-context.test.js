const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getNormalWindowSnapshot,
  handleMessage,
} = require("../src/background/background.js");
const selectors = require("../src/shared/selectors.js");
require("../src/shared/registry.js");
require("../src/shared/command-state.js");
require("../src/shared/session-state.js");
require("../src/shared/macro-state.js");

function request(name, args = [], destination = []) {
  return {
    type: "VIM_COMMAND_REQUEST",
    command: { name, args, destination },
  };
}

function createBrowserApi() {
  const windows = [
    {
      id: 10,
      focused: true,
      incognito: false,
      state: "normal",
      tabs: [
        {
          id: 1,
          index: 0,
          url: "https://public.example/",
          title: "Public page",
          active: true,
          incognito: false,
        },
        {
          id: 2,
          index: 1,
          url: "https://private-in-normal.example/secret",
          title: "Private tab accidentally reported in normal window",
          active: false,
          incognito: true,
        },
      ],
    },
    {
      id: 20,
      focused: false,
      incognito: true,
      state: "normal",
      tabs: [
        {
          id: 3,
          index: 0,
          url: "https://private.example/secret",
          title: "Private secret title",
          active: true,
          incognito: true,
        },
      ],
    },
  ];
  const storageData = {
    fvcSessions: {},
    fvcLastSessionName: "",
    fvcWorkspaces: {},
    fvcCommandMacros: {
      existing: {
        commands: [{ name: "tabs", args: ["all"], destination: [] }],
      },
    },
  };
  const calls = { gets: [], sets: [], windowGets: 0 };
  return {
    windows,
    storageData,
    calls,
    windowsApi: {
      getAll: async () => {
        calls.windowGets += 1;
        return windows;
      },
    },
    storage: {
      local: {
        get: async (keys) => {
          calls.gets.push(keys);
          return Object.fromEntries(keys.map((key) => [key, storageData[key]]));
        },
        set: async (values) => {
          calls.sets.push(values);
          Object.assign(storageData, values);
        },
      },
    },
  };
}

function browserApiParts(api) {
  return {
    windows: api.windowsApi,
    storage: api.storage,
  };
}

test("normal snapshots exclude private windows and incognito tabs regardless of window", async () => {
  const api = createBrowserApi();
  const snapshot = await getNormalWindowSnapshot(browserApiParts(api));
  assert.equal(snapshot.length, 1);
  assert.deepEqual(
    snapshot.flatMap((window) => window.tabs).map((tab) => tab.url),
    ["https://public.example/"],
  );
  assert.doesNotMatch(JSON.stringify(snapshot), /private\.example|private-in-normal\.example|Private secret title/);
});

test("private session and workspace saves never persist private URL or title data", async () => {
  const api = createBrowserApi();
  const browser = browserApiParts(api);
  const sender = { tab: { id: 1, incognito: false } };

  const session = await handleMessage(
    request("session", ["save", "public-only"]),
    browser,
    selectors,
    sender,
  );
  assert.equal(session.ok, true);

  const workspace = await handleMessage(
    request("workspace", ["create", "public-only"]),
    browser,
    selectors,
    sender,
  );
  assert.equal(workspace.ok, true);

  const persisted = JSON.stringify({
    sessions: api.storageData.fvcSessions,
    workspaces: api.storageData.fvcWorkspaces,
  });
  assert.match(persisted, /public\.example/);
  assert.doesNotMatch(
    persisted,
    /private\.example|private-in-normal\.example|Private secret title|secret/,
  );
});

test("private state reads return an empty transient state without reading storage", async () => {
  const api = createBrowserApi();
  const before = structuredClone(api.storageData);
  const result = await handleMessage(
    { type: "VIM_STATE_GET" },
    browserApiParts(api),
    selectors,
    { tab: { id: 3, incognito: true } },
  );

  assert.deepEqual(result, {
    ok: true,
    persisted: false,
    state: {
      history: [],
      aliases: {},
      preferences: require("../src/shared/command-state.js").normalizePreferences(),
    },
  });
  assert.deepEqual(api.calls.gets, []);
  assert.deepEqual(api.calls.sets, []);
  assert.equal(api.calls.windowGets, 0);
  assert.deepEqual(api.storageData, before);
});

test("private state writes are acknowledged as transient and never reach storage", async () => {
  const api = createBrowserApi();
  const before = structuredClone(api.storageData);
  const result = await handleMessage(
    {
      type: "VIM_STATE_SET",
      state: {
        history: [{ command: "tabs", timestamp: 1 }],
        aliases: {},
        preferences: {},
      },
    },
    browserApiParts(api),
    selectors,
    { tab: { id: 3, incognito: true } },
  );

  assert.deepEqual(result, { ok: true, persisted: false });
  assert.deepEqual(api.calls.gets, []);
  assert.deepEqual(api.calls.sets, []);
  assert.equal(api.calls.windowGets, 0);
  assert.deepEqual(api.storageData, before);
});

test("private macro get, set, and delete are all rejected before storage access", async () => {
  const api = createBrowserApi();
  const before = structuredClone(api.storageData);
  const browser = browserApiParts(api);
  const sender = { tab: { id: 3, incognito: true } };
  const attempts = [
    { type: "VIM_MACRO_GET" },
    {
      type: "VIM_MACRO_SET",
      name: "private-attempt",
      commands: [{ name: "tabs", args: ["all"], destination: [] }],
    },
    { type: "VIM_MACRO_DELETE", name: "existing" },
  ];

  for (const message of attempts) {
    const result = await handleMessage(message, browser, selectors, sender);
    assert.equal(result.ok, false);
    assert.match(result.error, /Macros are disabled in private browsing/);
  }

  assert.deepEqual(api.calls.gets, []);
  assert.deepEqual(api.calls.sets, []);
  assert.deepEqual(api.storageData, before);
});

test("private session, workspace, and undo commands are rejected without storage or browser access", async () => {
  const api = createBrowserApi();
  const before = structuredClone(api.storageData);
  const browser = browserApiParts(api);
  const sender = { tab: { id: 3, incognito: true } };

  for (const command of [
    request("session", ["list"]),
    request("workspace", ["list"]),
    request("undo"),
  ]) {
    const result = await handleMessage(command, browser, selectors, sender);
    assert.equal(result.ok, false);
    assert.match(result.error, /disabled in private browsing/);
  }

  assert.deepEqual(api.calls.gets, []);
  assert.deepEqual(api.calls.sets, []);
  assert.deepEqual(api.storageData, before);
});
