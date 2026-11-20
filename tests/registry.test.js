const test = require("node:test");
const assert = require("node:assert/strict");
const registry = require("../src/shared/registry.js");

test("registry distinguishes implemented and planned commands", () => {
  assert.equal(registry.get("help").status, "implemented");
  assert.equal(registry.get("close").status, "implemented");
  assert.equal(registry.get("windows").status, "implemented");
  assert.equal(registry.get("merge").status, "implemented");
  assert.equal(registry.get("sort").status, "implemented");
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
