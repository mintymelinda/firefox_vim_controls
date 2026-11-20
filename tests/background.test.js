const test = require("node:test");
const assert = require("node:assert/strict");
const { handleMessage, validateCommandRequest } = require("../src/background/background.js");
const selectors = require("../src/shared/selectors.js");

const windows = [
  {
    id: 10,
    focused: true,
    incognito: false,
    tabs: [
      { id: 1, url: "https://www.twitch.tv/a", title: "Twitch", active: true },
      { id: 2, url: "https://example.com", title: "Example" },
    ],
  },
  {
    id: 11,
    focused: false,
    incognito: false,
    tabs: [
      { id: 3, url: "https://youtube.com/watch?v=1", title: "Video" },
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

function browserApi() {
  return { windows: { getAll: async () => windows } };
}

function request(name, args = []) {
  return { type: "VIM_COMMAND_REQUEST", command: { name, args, destination: [] } };
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

test("lists tabs across normal windows and excludes private windows", async () => {
  const result = await handleMessage(request("tabs"), browserApi(), selectors);
  assert.equal(result.ok, true);
  assert.equal(result.output.length, 4);
  assert.equal(
    result.output.some((line) => line.includes("private.example")),
    false,
  );
});

test("runs count, current, domains, and duplicate read commands", async () => {
  const count = await handleMessage(request("count", ["youtube"]), browserApi(), selectors);
  const current = await handleMessage(request("current"), browserApi(), selectors);
  const domains = await handleMessage(request("domains"), browserApi(), selectors);
  const duplicates = await handleMessage(request("duplicates"), browserApi(), selectors);

  assert.deepEqual(count.output, ["2 tab(s) matched youtube."]);
  assert.match(current.output[0], /Twitch/);
  assert.deepEqual(domains.output, ["example.com", "twitch.tv", "youtube.com"]);
  assert.match(duplicates.output[0], /Duplicate group/);
  assert.equal(
    duplicates.output.some((line) => line.includes("private.example")),
    false,
  );
});

test("rejects commands that are not part of the read-only command surface", async () => {
  const result = await handleMessage(request("close"), browserApi(), selectors);
  assert.deepEqual(result, { ok: false, error: "Command is not implemented yet: close" });
});
