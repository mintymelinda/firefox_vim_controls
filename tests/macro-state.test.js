const test = require("node:test");
const assert = require("node:assert/strict");
const macros = require("../src/shared/macro-state.js");

const allowed = ["tabs", "count", "move", "pin", "unpin", "mute", "unmute", "sort"];

test("normalizes safe macro names and parsed command objects", () => {
  assert.equal(macros.normalizeName("Work_Flow"), "work_flow");
  assert.deepEqual(
    macros.normalizeCommands(
      [{ name: "move", args: ["twitch"], destination: ["new_window"] }],
      allowed,
    ),
    [{ name: "move", args: ["twitch"], destination: ["new_window"] }],
  );
  assert.throws(
    () => macros.normalizeCommands([{ name: "macro", args: ["run", "other"], destination: [] }], allowed),
    /invalid or unsupported/,
  );
  assert.throws(
    () => macros.normalizeCommands([{ name: "tabs", args: ["x".repeat(257)], destination: [] }], allowed),
    /invalid or unsupported/,
  );
  assert.throws(
    () => macros.normalizeCommands([{ name: "close", args: ["all", "--confirm"], destination: [] }], allowed),
    /invalid or unsupported/,
  );
  assert.throws(() => macros.normalizeName("../bad"), /Macro names/);
});

test("saves, lists, and deletes bounded named macros", () => {
  const commands = [{ name: "tabs", args: ["twitch"], destination: [] }];
  const saved = macros.saveMacro({}, "stream", commands, allowed);
  assert.deepEqual(macros.listMacros(saved, allowed), [{ name: "stream", commands: 1 }]);
  assert.throws(() => macros.saveMacro(saved, "stream", commands, allowed), /already exists/);
  assert.throws(() => macros.deleteMacro(saved, "missing", allowed), /No macro named/);
  assert.deepEqual(Object.keys(macros.deleteMacro(saved, "stream", allowed)), []);
});

test("discards malformed persisted macros without losing valid entries", () => {
  const normalized = macros.normalizeMacros(
    {
      good: {
        commands: [{ name: "count", args: ["all"], destination: [] }],
        updatedAt: 1000,
      },
      bad: { commands: [{ name: "eval", args: ["alert(1)"], destination: [] }] },
      recursive: { commands: [{ name: "macro", args: ["run", "good"], destination: [] }] },
    },
    allowed,
  );
  assert.deepEqual(Object.keys(normalized), ["good"]);
  assert.equal(normalized.good.updatedAt, 1000);
});

test("enforces macro count, command count, and storage bounds", () => {
  const commands = Array.from({ length: macros.LIMITS.commands + 1 }, () => ({
    name: "tabs",
    args: [],
    destination: [],
  }));
  assert.throws(() => macros.saveMacro({}, "too_many", commands, allowed), /between 1 and/);
  let collection = {};
  for (let index = 0; index < macros.LIMITS.macros; index += 1) {
    collection = macros.saveMacro(
      collection,
      `macro${index}`,
      [{ name: "tabs", args: [], destination: [] }],
      allowed,
    );
  }
  assert.throws(
    () => macros.saveMacro(collection, "overflow", [{ name: "tabs", args: [], destination: [] }], allowed),
    /limit of 20/,
  );
});
