const test = require("node:test");
const assert = require("node:assert/strict");
const state = require("../src/shared/command-state.js");

const commandNames = [
  "help",
  "tabs",
  "close",
  "move",
  "open",
  "search",
  "alias",
  "aliases",
  "unalias",
  "history",
  "clear_history",
  "set",
  "session",
  "workspace",
];

test("normalizes and bounds persistent command history", () => {
  assert.deepEqual(state.normalizeHistory(["one", null, "", "two", "three"], 2), ["two", "three"]);
  assert.deepEqual(state.appendHistory(["one"], "one", 10), ["one"]);
  assert.deepEqual(state.appendHistory(["one"], "two", 2), ["one", "two"]);
  assert.deepEqual(state.appendHistory(["one", "two"], "three", 2), ["two", "three"]);
});

test("validates aliases and refuses to shadow commands or target local alias commands", () => {
  assert.equal(state.isValidAliasName("stream", commandNames), true);
  assert.equal(state.isValidAliasName("move", commandNames), false);
  assert.equal(state.isValidAliasName("bad name", commandNames), false);
  assert.throws(
    () =>
      state.createAlias(
        "stream",
        { name: "alias", args: ["nested"], destination: [] },
        commandNames,
      ),
    /implemented command/,
  );
  assert.throws(
    () => state.createAlias("move", { name: "tabs", args: [], destination: [] }, commandNames),
    /cannot shadow/,
  );
});

test("creates and expands structured aliases without evaluating command text", () => {
  const alias = state.createAlias(
    "stream",
    { name: "move", args: ["twitch"], destination: ["new_window"] },
    commandNames,
  );
  const aliases = { stream: alias };
  assert.deepEqual(
    state.expandAlias({ name: "stream", args: ["youtube"], destination: [] }, aliases),
    {
      name: "move",
      args: ["twitch", "youtube"],
      destination: ["new_window"],
    },
  );
  assert.deepEqual(
    state.expandAlias({ name: "stream", args: [], destination: ["current_window"] }, aliases)
      .destination,
    ["current_window"],
  );
});

test("normalizes stored aliases and discards malformed or recursive entries", () => {
  const aliases = state.normalizeAliases(
    {
      stream: {
        command: { name: "move", args: ["twitch"], destination: ["new_window"] },
      },
      nested: {
        command: { name: "alias", args: ["other"], destination: [] },
      },
      malformed: { command: { name: "move", args: "twitch", destination: [] } },
      close: {
        command: { name: "move", args: [], destination: [] },
      },
    },
    commandNames,
  );
  assert.deepEqual(Object.keys(aliases), ["stream"]);
});

test("validates preferences and builds encoded search URLs", () => {
  assert.deepEqual(state.normalizePreferences({}), {
    historyLimit: 100,
    searchEngine: "duckduckgo",
  });
  assert.deepEqual(state.updatePreference({}, "history_limit", "250"), {
    historyLimit: 250,
    searchEngine: "duckduckgo",
  });
  assert.deepEqual(state.updatePreference({}, "search_engine", "google"), {
    historyLimit: 100,
    searchEngine: "google",
  });
  assert.throws(() => state.updatePreference({}, "history_limit", "5"), /10 to 500/);
  assert.throws(() => state.updatePreference({}, "search_engine", "unknown"), /duckduckgo/);
  const searchUrl = new URL(state.buildSearchUrl("cats & dogs", "google"));
  assert.equal(searchUrl.origin, "https://www.google.com");
  assert.equal(searchUrl.searchParams.get("q"), "cats & dogs");
});

test("completes command names, aliases, selectors, destinations, and preference values", () => {
  const aliases = { stream: { command: { name: "move", args: [], destination: [] } } };
  assert.ok(state.completionCandidates(":str", commandNames, aliases).includes("stream"));
  assert.ok(state.completionCandidates(":close tw", commandNames, aliases).includes("twitch"));
  assert.ok(
    state.completionCandidates(":move twitch, new_", commandNames, aliases).includes("new_window"),
  );
  assert.ok(
    state.completionCandidates(":set search_engine g", commandNames, aliases).includes("google"),
  );
  assert.ok(
    state.completionCandidates(":session s", commandNames, aliases).includes("save"),
  );
  assert.ok(
    state.completionCandidates(":workspace sw", commandNames, aliases).includes("switch"),
  );
});

test("never persists command state from private browsing contexts", () => {
  const storage = { get: async () => ({}), set: async () => {} };
  assert.equal(state.canPersistState(true, storage), false);
  assert.equal(state.canPersistState(false, storage), true);
  assert.equal(state.canPersistState(false, null), false);
});
