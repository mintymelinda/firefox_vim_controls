const test = require("node:test");
const assert = require("node:assert/strict");
const { isEditableTarget, shouldOpenCommandMode } = require("../src/shared/activation.js");

function target(selector) {
  return { closest: (query) => (query.includes(selector) ? {} : null) };
}

test("identifies editable controls", () => {
  assert.equal(isEditableTarget(target("input")), true);
  assert.equal(isEditableTarget(target("textarea")), true);
  assert.equal(isEditableTarget(target("[contenteditable]")), true);
  assert.equal(isEditableTarget(target("main")), false);
});

test("opens only for an unmodified colon outside editable controls", () => {
  assert.equal(shouldOpenCommandMode({ key: ":", target: target("main") }), true);
  assert.equal(shouldOpenCommandMode({ key: ":", target: target("input") }), false);
  assert.equal(shouldOpenCommandMode({ key: ":", target: target("main"), ctrlKey: true }), false);
  assert.equal(shouldOpenCommandMode({ key: "a", target: target("main") }), false);
});
