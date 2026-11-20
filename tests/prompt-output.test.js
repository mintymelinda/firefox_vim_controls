const test = require("node:test");
const assert = require("node:assert/strict");
const { trimOutput } = require("../src/shared/prompt-output.js");

function createContainer(values) {
  return {
    values: [...values],
    get childElementCount() {
      return this.values.length;
    },
    get firstElementChild() {
      return this.values[0];
    },
    removeChild(value) {
      this.values.splice(this.values.indexOf(value), 1);
    },
  };
}

test("trims prompt output to the newest bounded lines", () => {
  const container = createContainer(["one", "two", "three", "four"]);
  trimOutput(container, 2);
  assert.deepEqual(container.values, ["three", "four"]);
});

test("keeps output below the limit and supports a zero-line limit", () => {
  const container = createContainer(["one", "two"]);
  trimOutput(container, 3);
  assert.deepEqual(container.values, ["one", "two"]);
  trimOutput(container, 0);
  assert.deepEqual(container.values, []);
});

test("ignores invalid containers and limits safely", () => {
  assert.doesNotThrow(() => trimOutput(null, 10));
  const container = createContainer(["one"]);
  trimOutput(container, -1);
  trimOutput(container, 1.5);
  assert.deepEqual(container.values, ["one"]);
});
