const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const vm = require("node:vm");
const parser = require("../src/shared/parser.js");
const activation = require("../src/shared/activation.js");
const commandState = require("../src/shared/command-state.js");
const registry = require("../src/shared/registry.js");
const chain = require("../src/shared/command-chain.js");
const suggestions = require("../src/shared/suggestions.js");
const promptOutput = require("../src/shared/prompt-output.js");

class FakeElement {
  constructor(document, tagName = "div") {
    this.ownerDocument = document;
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.listeners = new Map();
    this.attributes = new Map();
    this.parentElement = null;
    this.isConnected = false;
    this.value = "";
    this.textContent = "";
    this.className = "";
    this.scrollHeight = 0;
    this.scrollTop = 0;
  }

  set innerHTML(value) {
    this.markup = value;
    if (this.tagName !== "SECTION") return;
    this.input = new FakeElement(this.ownerDocument, "input");
    this.output = new FakeElement(this.ownerDocument, "div");
    this.hint = new FakeElement(this.ownerDocument, "div");
    this.output.className = "fvc-output";
    this.hint.className = "fvc-hint";
    for (const child of [this.input, this.output, this.hint]) {
      child.parentElement = this;
      child.isConnected = true;
      this.children.push(child);
    }
  }

  setAttribute(name, value) {
    this.attributes.set(name, value);
  }

  getAttribute(name) {
    return this.attributes.get(name);
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  async dispatch(type, event = {}) {
    const listeners = this.listeners.get(type) || [];
    for (const listener of listeners) await listener({ ...event, target: this });
  }

  querySelector(selector) {
    if (selector === "input") return this.input;
    if (selector === ".fvc-output") return this.output;
    if (selector === ".fvc-hint") return this.hint;
    return null;
  }

  append(child) {
    child.parentElement = this;
    child.isConnected = true;
    this.children.push(child);
  }

  remove() {
    if (this.parentElement) {
      this.parentElement.children = this.parentElement.children.filter((item) => item !== this);
    }
    this.isConnected = false;
  }

  contains(target) {
    return target === this || this.children.some((child) => child.contains(target));
  }

  focus() {
    this.ownerDocument.activeElement = this;
    this.ownerDocument.dispatch("focusin", { target: this });
  }

  blur() {
    if (this.ownerDocument.activeElement === this) {
      this.ownerDocument.activeElement = this.ownerDocument.body;
    }
  }

  closest(selector) {
    if (this.matchesEditable) return {};
    if (this.tagName === "INPUT" && selector.includes("input")) return {};
    return null;
  }

  appendChild(child) {
    this.append(child);
    return child;
  }

  replaceChildren(...children) {
    this.children = [];
    for (const child of children) this.append(child);
  }

  get childElementCount() {
    return this.children.length;
  }

  get firstElementChild() {
    return this.children[0] || null;
  }

  removeChild(child) {
    this.children = this.children.filter((item) => item !== child);
    child.isConnected = false;
  }
}

class FakeDocument {
  constructor() {
    this.listeners = new Map();
    this.body = new FakeElement(this, "body");
    this.body.isConnected = true;
    this.activeElement = this.body;
    this.documentElement = new FakeElement(this, "html");
    this.documentElement.isConnected = true;
  }

  createElement(tagName) {
    return new FakeElement(this, tagName);
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.set(
      type,
      (this.listeners.get(type) || []).filter((item) => item !== listener),
    );
  }

  async dispatch(type, event = {}) {
    const listeners = this.listeners.get(type) || [];
    for (const listener of listeners) await listener({ ...event, target: event.target || this.activeElement });
  }

  getElementById(id) {
    return this.documentElement.children.find((item) => item.id === id) || null;
  }
}

async function createPromptHarness({ history = ["tabs", "help"], privateContext = false } = {}) {
  const document = new FakeDocument();
  const messages = [];
  const runtimeListeners = [];
  const browser = {
    extension: { inIncognitoContext: privateContext },
    i18n: { getMessage: () => "" },
    runtime: {
      onMessage: { addListener: (listener) => runtimeListeners.push(listener) },
      sendMessage: async (message) => {
        messages.push(message);
        if (message.type === "VIM_STATE_GET") {
          return { ok: true, state: { history, aliases: {}, preferences: {} } };
        }
        if (message.type === "VIM_STATE_SET") return { ok: true };
        if (message.type === "VIM_COMMAND_REQUEST") {
          return { ok: true, output: ["background accepted command"] };
        }
        return { ok: false, error: "Unexpected message" };
      },
    },
  };
  const context = vm.createContext({
    document,
    browser,
    console,
    Object,
    Array,
    Boolean,
    Number,
    String,
    Map,
    Set,
    URL,
    globalThis: null,
  });
  context.globalThis = context;
  Object.assign(context, {
    VimCommandParser: parser,
    VimCommandActivation: activation,
    VimCommandState: commandState,
    VimCommandRegistry: registry,
    VimCommandChain: chain,
    VimCommandSuggestions: suggestions,
    VimPromptOutput: promptOutput,
  });
  const source = readFileSync(require.resolve("../src/content/entry.js"), "utf8");
  vm.runInContext(source, context, { filename: "src/content/entry.js" });
  await Promise.resolve();
  await Promise.resolve();
  return {
    document,
    messages,
    runtimeListeners,
    open: async (target = document.body) => {
      await document.dispatch("keydown", { key: ":", target, preventDefault() { this.prevented = true; } });
      return document.getElementById("fvc-command-panel");
    },
    key: async (key, options = {}) => {
      const input = document.getElementById("fvc-command-panel")?.input;
      assert.ok(input, "command prompt should be open");
      await input.dispatch("keydown", {
        key,
        shiftKey: Boolean(options.shiftKey),
        preventDefault() { this.prevented = true; },
      });
      await Promise.resolve();
      await Promise.resolve();
      return input;
    },
  };
}

test("prompt activation ignores editable targets and opens after Escape releases focus", async () => {
  const harness = await createPromptHarness();
  const editable = new FakeElement(harness.document, "input");
  editable.matchesEditable = true;
  harness.document.activeElement = editable;

  assert.equal(await harness.open(editable), null);
  await harness.document.dispatch("keydown", { key: "Escape", target: editable });
  assert.equal(harness.document.activeElement, harness.document.body);
  assert.ok(await harness.open(harness.document.body));
  assert.equal(harness.document.activeElement.tagName, "INPUT");
});

test("prompt history navigation restores prior commands and returns to an empty draft", async () => {
  const harness = await createPromptHarness({ history: ["tabs", "help", "windows"] });
  await harness.open();
  const input = await harness.key("ArrowUp");
  assert.equal(input.value, "windows");
  await harness.key("ArrowUp");
  assert.equal(input.value, "help");
  await harness.key("ArrowDown");
  assert.equal(input.value, "windows");
  await harness.key("ArrowDown");
  assert.equal(input.value, "");
});

test("Tab completion is interactive, while Shift+Tab does not replace the command", async () => {
  const harness = await createPromptHarness();
  await harness.open();
  const input = harness.document.getElementById("fvc-command-panel").input;
  input.value = ":he";
  await harness.key("Tab");
  assert.equal(input.value, ":help ");
  input.value = ":ta";
  await harness.key("Tab");
  assert.equal(input.value, ":ta");
  assert.match(harness.document.getElementById("fvc-command-panel").output.children[0].textContent, /tabs/);
  input.value = ":wi";
  await harness.key("Tab", { shiftKey: true });
  assert.equal(input.value, ":wi");
});

test("Enter sends a structured command request and displays the background response", async () => {
  const harness = await createPromptHarness();
  await harness.open();
  const input = harness.document.getElementById("fvc-command-panel").input;
  input.value = ":tabs twitch";
  await harness.key("Enter");

  const request = harness.messages.find((message) => message.type === "VIM_COMMAND_REQUEST");
  assert.deepEqual(JSON.parse(JSON.stringify(request)), {
    type: "VIM_COMMAND_REQUEST",
    command: { name: "tabs", args: ["twitch"], destination: [] },
  });
  assert.ok(harness.messages.some((message) => message.type === "VIM_STATE_SET"));
  assert.ok(
    harness.document.getElementById("fvc-command-panel").output.children.some(
      (line) => line.textContent === "background accepted command",
    ),
  );
});

test("private prompt sessions do not read or write persistent command state", async () => {
  const harness = await createPromptHarness({ privateContext: true });
  await harness.open();
  const input = harness.document.getElementById("fvc-command-panel").input;
  input.value = ":tabs";
  await harness.key("Enter");
  assert.equal(harness.messages.length, 0);
});
