((root) => {
  const IMPLEMENTED_COMMANDS = new Set([
    "tabs",
    "count",
    "current",
    "domains",
    "duplicates",
    "close",
    "move",
    "reload",
    "mute",
    "unmute",
    "pin",
    "unpin",
    "discard",
  ]);

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

  function commandOptions(command) {
    const confirmed = command.args.includes("--confirm");
    const selectorArgs = command.args.filter((arg) => arg !== "--confirm");
    return {
      confirmed,
      selector: selectorArgs.length ? selectorArgs.join(" ") : "all",
    };
  }

  function removableTabs(selected, windows) {
    const removable = [];
    let protectedCount = 0;
    for (const window of windows) {
      const inWindow = selected.filter((tab) => tab.windowId === window.id);
      if (!inWindow.length) continue;
      const selectedIds = new Set(inWindow.map((tab) => tab.id));
      const unselected = window.tabs.filter((tab) => !selectedIds.has(tab.id));
      if (unselected.length) {
        removable.push(...inWindow);
      } else {
        const keep = inWindow.find((tab) => tab.active) || inWindow[0];
        removable.push(...inWindow.filter((tab) => tab.id !== keep.id));
        protectedCount += 1;
      }
    }
    return { removable, protectedCount };
  }

  function previewLines(commandName, selector, tabs, windows) {
    const lines = [
      `Preview: ${commandName} would affect ${tabs.length} tab(s) matching "${selector}".`,
      ...tabs.slice(0, 8).map((tab) => {
        const window = windows.find((item) => item.id === tab.windowId);
        return tabSummary(tab, window.index);
      }),
    ];
    if (tabs.length > 8) lines.push(`…and ${tabs.length - 8} more.`);
    lines.push(`Rerun as :${commandName} ${selector} --confirm to proceed.`);
    return lines;
  }

  async function performPerTab(tabs, operation) {
    const results = await Promise.all(
      tabs.map(async (tab) => {
        try {
          await operation(tab.id);
          return null;
        } catch (error) {
          const message = error instanceof Error ? error.message : "operation failed";
          return `#${tab.id}: ${message}`;
        }
      }),
    );
    const failures = results.filter(Boolean);
    const succeeded = tabs.length - failures.length;
    const output = [`${succeeded} of ${tabs.length} tab(s) updated.`];
    output.push(...failures);
    return { ok: true, output };
  }

  function resolveMoveTarget(destination, windows, focusedWindow) {
    const value = destination.join(" ").trim().toLowerCase();
    if (value === "new_window") return { type: "new" };
    if (value === "current_window") {
      if (!focusedWindow) throw new Error("There is no focused normal browser window.");
      return { type: "existing", window: focusedWindow };
    }
    const match = value.match(/^window(?::|\s+)(\d+)$/);
    if (match) {
      const index = Number(match[1]);
      const window = windows.find((item) => item.index === index);
      if (!window) throw new Error(`No normal browser window at index ${index}`);
      return { type: "existing", window };
    }
    throw new Error("Move destination must be new_window, current_window, or window 2.");
  }

  async function executeMutation(command, selected, windows, focusedWindow, browserApi, selector, confirmed) {
    const name = command.name;
    if (name === "close") {
      const { removable, protectedCount } = removableTabs(selected, windows);
      if (!removable.length) {
        const message = selected.length
          ? "The selected tabs are the last tabs in their windows; nothing was closed."
          : "No tabs matched.";
        return { ok: true, output: [message] };
      }
      if (removable.length > 1 && !confirmed) {
        return { ok: true, output: previewLines(name, selector, removable, windows) };
      }
      const result = await performPerTab(removable, (id) => browserApi.tabs.remove(id));
      if (protectedCount) result.output.push(`Kept one tab open in ${protectedCount} window(s).`);
      return result;
    }

    if (name === "reload") {
      if (!selected.length) return { ok: true, output: ["No tabs matched."] };
      if (selected.length > 1 && !confirmed) {
        return { ok: true, output: previewLines(name, selector, selected, windows) };
      }
      return performPerTab(selected, (id) => browserApi.tabs.reload(id));
    }

    if (name === "discard") {
      const eligible = selected.filter((tab) => !tab.active && !tab.discarded);
      const skipped = selected.length - eligible.length;
      if (!eligible.length) {
        const message = selected.length
          ? "No inactive, undiscarded tabs matched."
          : "No tabs matched.";
        return { ok: true, output: [message] };
      }
      if (eligible.length > 1 && !confirmed) {
        return { ok: true, output: previewLines(name, selector, eligible, windows) };
      }
      const result = await performPerTab(eligible, (id) => browserApi.tabs.discard(id));
      if (skipped) result.output.push(`Skipped ${skipped} active or already-discarded tab(s).`);
      return result;
    }

    if (name === "move") {
      if (!selected.length) return { ok: true, output: ["No tabs matched."] };
      const target = resolveMoveTarget(command.destination, windows, focusedWindow);
      if (target.type === "new") {
        const [first, ...remaining] = selected;
        const created = await browserApi.windows.create({ tabId: first.id });
        if (remaining.length) {
          try {
            await browserApi.tabs.move(
              remaining.map((tab) => tab.id),
              { windowId: created.id, index: -1 },
            );
          } catch (error) {
            const message = error instanceof Error ? error.message : "move failed";
            return {
              ok: false,
              error: `Created window ${created.id} with tab ${first.id}, but remaining tabs could not be moved: ${message}`,
            };
          }
        }
        return {
          ok: true,
          output: [`Moved ${selected.length} tab(s) into new window ${created.id}.`],
        };
      }
      const moving = selected.filter((tab) => tab.windowId !== target.window.id);
      if (!moving.length) {
        return { ok: true, output: ["All selected tabs are already in the destination window."] };
      }
      await browserApi.tabs.move(
        moving.map((tab) => tab.id),
        { windowId: target.window.id, index: -1 },
      );
      return {
        ok: true,
        output: [`Moved ${moving.length} tab(s) into window ${target.window.index}.`],
      };
    }

    const updateProperties = {
      mute: { muted: true },
      unmute: { muted: false },
      pin: { pinned: true },
      unpin: { pinned: false },
    }[name];
    if (updateProperties) {
      if (!selected.length) return { ok: true, output: ["No tabs matched."] };
      return performPerTab(selected, (id) => browserApi.tabs.update(id, updateProperties));
    }

    return { ok: false, error: `Command is not available: ${name}` };
  }

  async function executeCommand(command, browserApi, selectors) {
    const windows = await getNormalWindowSnapshot(browserApi);
    const tabs = windows.flatMap((window) =>
      window.tabs.map((tab) => ({ ...tab, windowId: window.id })),
    );
    const focusedWindow = windows.find((window) => window.focused);
    const { confirmed, selector } = commandOptions(command);

    if (command.name === "current") {
      const current = focusedWindow?.tabs.find((tab) => tab.active);
      if (!current) return { ok: true, output: ["No active tab in a normal browser window."] };
      return { ok: true, output: [tabSummary(current, focusedWindow.index)] };
    }

    if (command.name === "move" && !command.destination.length) {
      return {
        ok: false,
        error: "Move requires a destination, for example :move twitch, new_window.",
      };
    }
    const selected = selectors.selectTabs(tabs, selector, {
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
    return executeMutation(command, selected, windows, focusedWindow, browserApi, selector, confirmed);
  }

  async function handleMessage(message, browserApi = root.browser, selectors = root.VimTabSelectors) {
    const validationError = validateCommandRequest(message);
    if (validationError) return { ok: false, error: validationError };
    const { command } = message;
    if (!IMPLEMENTED_COMMANDS.has(command.name)) {
      return { ok: false, error: `Command is not implemented yet: ${command.name}` };
    }
    if (!browserApi?.windows?.getAll || !selectors?.selectTabs) {
      return { ok: false, error: "Browser tab APIs are unavailable." };
    }
    try {
      return await executeCommand(command, browserApi, selectors);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Command failed." };
    }
  }

  if (root.browser?.runtime?.onMessage) {
    root.browser.runtime.onMessage.addListener((message) => handleMessage(message));
  }

  const api = {
    commandOptions,
    executeCommand,
    executeMutation,
    getNormalWindowSnapshot,
    handleMessage,
    previewLines,
    removableTabs,
    resolveMoveTarget,
    validateCommandRequest,
  };
  root.VimBackgroundCommands = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
