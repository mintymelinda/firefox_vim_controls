const test = require("node:test");
const assert = require("node:assert/strict");
const chain = require("../src/shared/command-chain.js");

test("executes commands sequentially in input order", async () => {
  const order = [];
  const commands = [{ name: "tabs" }, { name: "count" }, { name: "domains" }];
  const results = await chain.executeChain(commands, async (command) => {
    order.push(command.name);
    return { ok: true, output: [command.name] };
  });
  assert.deepEqual(order, ["tabs", "count", "domains"]);
  assert.equal(results.length, 3);
});

test("stops immediately after a failed command", async () => {
  const order = [];
  const results = await chain.executeChain(
    [{ name: "tabs" }, { name: "close" }, { name: "count" }],
    async (command) => {
      order.push(command.name);
      return { ok: command.name !== "close" };
    },
  );
  assert.deepEqual(order, ["tabs", "close"]);
  assert.equal(results.length, 2);
});

test("stops at confirmation previews rather than treating them as success", async () => {
  const order = [];
  const results = await chain.executeChain(
    [{ name: "close" }, { name: "tabs" }],
    async (command) => {
      order.push(command.name);
      return { ok: true, requiresConfirmation: command.name === "close" };
    },
  );
  assert.deepEqual(order, ["close"]);
  assert.equal(results[0].result.requiresConfirmation, true);
});

test("propagates executor exceptions without running later commands", async () => {
  const order = [];
  await assert.rejects(
    chain.executeChain([{ name: "tabs" }, { name: "count" }], async (command) => {
      order.push(command.name);
      throw new Error("executor failed");
    }),
    /executor failed/,
  );
  assert.deepEqual(order, ["tabs"]);
});


test("rejects command chains that exceed the execution bound", async () => {
  await assert.rejects(
    chain.executeChain(Array.from({ length: 51 }, () => ({ name: "tabs" })), async () => ({
      ok: true,
    })),
    /cannot contain more than 50/,
  );
});
