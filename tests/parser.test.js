const test = require("node:test");
const assert = require("node:assert/strict");
const { parseCommandLine, tokenize } = require("../src/shared/parser.js");

test("parses a simple command and selector arguments", () => {
  assert.deepEqual(parseCommandLine(":close twitch"), {
    commands: [{ name: "close", args: ["twitch"], destination: [], raw: "close twitch" }],
  });
});

test("parses comma-separated destinations", () => {
  assert.deepEqual(parseCommandLine("move twitch, new_window"), {
    commands: [{ name: "move", args: ["twitch"], destination: ["new_window"], raw: "move twitch, new_window" }],
  });
});

test("parses chained commands without executing them", () => {
  const result = parseCommandLine("mute twitch && move twitch, new_window");
  assert.equal(result.commands.length, 2);
  assert.equal(result.commands[0].name, "mute");
  assert.equal(result.commands[1].destination[0], "new_window");
});

test("preserves quoted arguments containing spaces and delimiters", () => {
  const result = parseCommandLine('open "https://example.com/a,b"');
  assert.deepEqual(result.commands[0].args, ["https://example.com/a,b"]);
  assert.deepEqual(tokenize('"two words" plain'), ["two words", "plain"]);
});

test("rejects empty and malformed command lines", () => {
  assert.throws(() => parseCommandLine(":"), /Enter a command/);
  assert.throws(() => parseCommandLine("close &&"), /Empty command/);
  assert.throws(() => parseCommandLine('open "unfinished'), /Unclosed quote/);
});

test("recognizes command names case-insensitively", () => {
  assert.equal(parseCommandLine(":CLOSE Twitch").commands[0].name, "close");
});
