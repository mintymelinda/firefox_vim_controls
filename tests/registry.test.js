const test = require("node:test");
const assert = require("node:assert/strict");
const registry = require("../src/shared/registry.js");

test("registry distinguishes implemented and planned commands", () => {
  assert.equal(registry.get("help").status, "implemented");
  assert.equal(registry.get("close").status, "implemented");
  assert.equal(registry.get("focus").status, "implemented");
  assert.equal(registry.get("windows").status, "implemented");
  assert.equal(registry.get("merge").status, "implemented");
  assert.equal(registry.get("sort").status, "implemented");
  assert.equal(registry.get("open").status, "implemented");
  assert.equal(registry.get("search").status, "implemented");
  assert.equal(registry.get("back").status, "implemented");
  assert.equal(registry.get("forward").status, "implemented");
  assert.equal(registry.get("refresh").status, "implemented");
  assert.equal(registry.get("home").status, "implemented");
  assert.equal(registry.get("history").status, "implemented");
  assert.equal(registry.get("clear_history").status, "implemented");
  assert.equal(registry.get("alias").status, "implemented");
  assert.equal(registry.get("unalias").status, "implemented");
  assert.equal(registry.get("aliases").status, "implemented");
  assert.equal(registry.get("set").status, "implemented");
  assert.equal(registry.get("stop").status, "planned");
});

test("registry lookup is case-insensitive and returns a copy", () => {
  const command = registry.get("CLOSE");
  assert.equal(command.name, "close");
  command.name = "overwritten";
  assert.equal(registry.get("close").name, "close");
});

test("registry exposes completion names", () => {
  assert.ok(registry.names().includes("move"));
  assert.ok(registry.names().includes("new_window"));
});
