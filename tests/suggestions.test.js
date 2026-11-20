const test = require("node:test");
const assert = require("node:assert/strict");
const { suggestCommands } = require("../src/shared/suggestions.js");

const commands = ["help", "version", "clear", "close", "move", "reload", "windows"];

test("suggests a nearby command for a typo", () => {
  assert.deepEqual(suggestCommands("clsoe", commands), ["close"]);
});

test("returns deterministic suggestions ordered by edit distance", () => {
  assert.deepEqual(suggestCommands("mvoe", commands), ["move"]);
});

test("does not suggest commands for arguments or empty input", () => {
  assert.deepEqual(suggestCommands("close twitch", commands), []);
  assert.deepEqual(suggestCommands(":", commands), []);
});

test("does not suggest distant commands", () => {
  assert.deepEqual(suggestCommands("zzzzzz", commands), []);
});
