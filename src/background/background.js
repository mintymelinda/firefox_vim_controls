"use strict";

(function (root) {
  const READ_COMMANDS = new Set(["tabs", "count", "current", "domains", "duplicates"]);

  function validateCommandRequest(message) {
    if (!message || typeof message !== "object" || message.type !== "VIM_COMMAND_REQUEST") {
      return "Invalid message type";
    }
    if (Object.keys(message).some((key) => !["type", "command"].includes(key))) {
      return "Unexpected message properties";
    }
    const command = message.command;
    if (!command || typeof command !== "object" || Array.isArray(command)) {
      return "Invalid command payload";
    }
    if (Object.keys(command).some((key) => !["name", "args", "destination"].includes(key))) {
      return "Unexpected command properties";
    }
    if (typeof command.name !== "string" || !/^[a-z][a-z0-9_-]*$/.test(command.name)) {
      return "Invalid command name";
    }
    if (
      !Array.isArray(command.args) ||
      command.args.length > 32 ||
      command.args.some((arg) => typeof arg !== "string" || arg.length > 256)
    ) {
      return "Invalid command arguments";
    }
    if (
      !Array.isArray(command.destination) ||
      command.destination.length > 32 ||
      command.destination.some((item) => typeof item !== "string" || item.length > 256)
    ) {
      return "Invalid command destination";
    }
    return null;
  }

  function tabSummary(tab, windowIndex) {
    const title = String(tab.title || tab.url || "Untitled tab")
      .replace(/\s+/g, " ")
      .trim();
    const url = String(tab.url || "");
    const flags = [tab.pinned ? "pinned" : "", tab.audible ? "audible" : ""].filter(Boolean);
    const metadata = flags.length ? ` [${flags.join(", ")}]` : "";
    return `#${tab.id} (window ${windowIndex})${metadata} ${title} — ${url}`;
  }

  async function getNormalWindowSnapshot(browserApi) {
    const windows = await browserApi.windows.getAll({ populate: true, windowTypes: ["normal"] });
    return windows
      .filter((window) => !window.incognito)
      .sort((left, right) => left.id - right.id)
      .map((window, index) => ({
        id: window.id,
        index: index + 1,
        focused: Boolean(window.focused),
        tabs: (window.tabs || []).filter((tab) => !tab.incognito),
      }));
  }

  async function executeReadCommand(command, browserApi, selectors) {
    const windows = await getNormalWindowSnapshot(browserApi);
    const tabs = windows.flatMap((window) =>
      window.tabs.map((tab) => ({ ...tab, windowId: window.id })),
    );
    const focusedWindow = windows.find((window) => window.focused);
    const args = command.args;
    let selected;

    if (command.name === "current") {
      const current = focusedWindow?.tabs.find((tab) => tab.active);
      if (!current) return { ok: true, output: ["No active tab in a normal browser window."] };
      const window = windows.find((item) => item.id === current.windowId);
      return { ok: true, output: [tabSummary(current, window.index)] };
    }

    const selector = args.length ? args.join(" ") : "all";
    selected = selectors.selectTabs(tabs, selector, {
      currentWindowId: focusedWindow?.id,
      windows,
    });

    if (command.name === "count") {
      return { ok: true, output: [`${selected.length} tab(s) matched ${selector}.`] };
    }
    if (command.name === "domains") {
      const domains = [...new Set(selected.map(selectors.hostnameOf).filter(Boolean))].sort();
      return { ok: true, output: domains.length ? domains : ["No domains matched."] };
    }
    if (command.name === "duplicates") {
      const groups = new Map();
      for (const tab of selected) {
        const key = selectors.canonicalUrl(tab);
        if (!key) continue;
        groups.set(key, [...(groups.get(key) || []), tab]);
      }
      const lines = [...groups.values()]
        .filter((group) => group.length > 1)
        .flatMap((group) => [
          `Duplicate group (${group.length} tabs): ${group[0].url}`,
          ...group.map((tab) => {
            const window = windows.find((item) => item.id === tab.windowId);
            return tabSummary(tab, window.index);
          }),
        ]);
      return { ok: true, output: lines.length ? lines : ["No duplicate tabs found."] };
    }
    if (command.name === "tabs") {
      const lines = selected.map((tab) => {
        const window = windows.find((item) => item.id === tab.windowId);
        return tabSummary(tab, window.index);
      });
      return { ok: true, output: lines.length ? lines : ["No tabs matched."] };
    }
    return { ok: false, error: `Command is not available: ${command.name}` };
  }

  async function handleMessage(
    message,
    browserApi = root.browser,
    selectors = root.VimTabSelectors,
  ) {
    const validationError = validateCommandRequest(message);
    if (validationError) return { ok: false, error: validationError };
    const { command } = message;
    if (!READ_COMMANDS.has(command.name)) {
      return { ok: false, error: `Command is not implemented yet: ${command.name}` };
    }
    if (!browserApi?.windows?.getAll || !selectors?.selectTabs) {
      return { ok: false, error: "Browser tab APIs are unavailable." };
    }
    try {
      return await executeReadCommand(command, browserApi, selectors);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Command failed." };
    }
  }

  if (root.browser?.runtime?.onMessage) {
    root.browser.runtime.onMessage.addListener((message) => handleMessage(message));
  }

  const api = {
    executeReadCommand,
    getNormalWindowSnapshot,
    handleMessage,
    validateCommandRequest,
  };
  root.VimBackgroundCommands = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
