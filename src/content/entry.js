"use strict";

(() => {
  if (
    !globalThis.VimCommandParser ||
    !globalThis.VimCommandActivation ||
    !globalThis.VimCommandState
  ) {
    return;
  }

  const history = [];
  let aliases = Object.create(null);
  let preferences = globalThis.VimCommandState.normalizePreferences();
  let historyIndex = 0;
  let panel = null;
  let input = null;
  let output = null;
  let lastCompletion = "";

  const commandNames = globalThis.VimCommandRegistry.names();
  const privateContext = Boolean(globalThis.browser?.extension?.inIncognitoContext);

  const stateReady = (async () => {
    if (privateContext) return;
    try {
      const response = await browser.runtime.sendMessage({ type: "VIM_STATE_GET" });
      if (!response?.ok) return;
      const stored = response.state || {};
      preferences = globalThis.VimCommandState.normalizePreferences(stored.preferences);
      history.push(
        ...globalThis.VimCommandState.normalizeHistory(stored.history, preferences.historyLimit),
      );
      aliases = globalThis.VimCommandState.normalizeAliases(stored.aliases, commandNames);
      historyIndex = history.length;
    } catch {
      // The prompt remains usable if background storage is unavailable.
    }
  })();

  async function persistState() {
    if (privateContext) return;
    try {
      await browser.runtime.sendMessage({
        type: "VIM_STATE_SET",
        state: { history, aliases, preferences },
      });
    } catch {
      appendOutput("Could not save command state in extension storage.", "error");
    }
  }

  function appendOutput(message, kind = "info") {
    if (!output) return;
    const line = document.createElement("div");
    line.className = `fvc-output fvc-output-${kind}`;
    line.textContent = message;
    output.append(line);
    output.scrollTop = output.scrollHeight;
  }

  function closePanel() {
    panel?.remove();
    panel = null;
    input = null;
    output = null;
  }

  function showPanel() {
    if (panel) {
      input.focus();
      return;
    }

    panel = document.createElement("section");
    panel.id = "fvc-command-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Firefox Vim Controls command prompt");
    panel.innerHTML = `
      <style>
        #fvc-command-panel{position:fixed;z-index:2147483647;left:50%;top:12%;transform:translateX(-50%);width:min(720px,92vw);max-height:70vh;background:#17191f;color:#f4f4f5;border:1px solid #555;border-radius:10px;box-shadow:0 16px 60px #0009;font:14px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;padding:12px}
        #fvc-command-panel *{box-sizing:border-box}
        #fvc-command-panel .fvc-input-row{display:flex;gap:8px;align-items:center}
        #fvc-command-panel label{color:#9ca3af}
        #fvc-command-panel input{flex:1;min-width:0;background:#242731;color:#fff;border:1px solid #666;border-radius:5px;padding:9px;font:inherit;outline-offset:2px}
        #fvc-command-panel .fvc-output{max-height:48vh;overflow:auto;margin-top:10px;white-space:pre-wrap;overflow-wrap:anywhere;color:#d1d5db}
        #fvc-command-panel .fvc-output-error{color:#fca5a5}
        #fvc-command-panel .fvc-hint{color:#9ca3af;font-size:11px;margin-top:8px}
      </style>
      <div class="fvc-input-row"><label for="fvc-command-input">:</label><input id="fvc-command-input" autocomplete="off" spellcheck="false" aria-label="Command"></div>
      <div class="fvc-output" aria-live="polite"></div>
      <div class="fvc-hint">Enter: run · Tab: complete · ↑/↓: history · Esc: close</div>
    `;
    document.documentElement.append(panel);
    input = panel.querySelector("input");
    output = panel.querySelector(".fvc-output");
    input.addEventListener("keydown", handlePromptKeydown);
    input.addEventListener("input", () => {
      lastCompletion = "";
    });
    input.focus();
  }

  function completeInput() {
    const value = input.value;
    const tokenMatch = value.match(/\S*$/);
    const token = tokenMatch ? tokenMatch[0] : "";
    const prefix = value.slice(0, value.length - token.length);
    const matches = globalThis.VimCommandState.completionCandidates(value, commandNames, aliases);
    if (matches.length === 1) {
      input.value = `${prefix}${matches[0]} `;
    } else if (matches.length > 1) {
      if (lastCompletion !== value) {
        lastCompletion = value;
        appendOutput(matches.join("  "));
      } else {
        const common = matches.reduce((prefixValue, item) => {
          let length = 0;
          while (length < prefixValue.length && prefixValue[length] === item[length]) {
            length += 1;
          }
          return prefixValue.slice(0, length);
        });
        if (common.length > token.length) input.value = `${prefix}${common}`;
      }
    }
  }

  function showHistory(command) {
    const requested = Number(command.args[0] || 20);
    const count = Number.isInteger(requested) ? Math.max(1, Math.min(requested, 100)) : 20;
    const entries = history.slice(-count);
    appendOutput(
      entries.length
        ? entries
            .map((entry, index) => `${history.length - entries.length + index + 1}: ${entry}`)
            .join("\n")
        : "Command history is empty.",
    );
  }

  async function handleLocalCommand(command) {
    if (command.name === "alias") {
      if (command.args.length < 2) {
        appendOutput("Alias syntax: :alias name command [arguments] [, destination].", "error");
        return true;
      }
      const [name, targetName, ...args] = command.args;
      const target = globalThis.VimCommandRegistry.get(targetName);
      if (!target || target.status !== "implemented") {
        appendOutput(`Alias target is not an implemented command: ${targetName}`, "error");
        return true;
      }
      try {
        aliases[name.toLowerCase()] = globalThis.VimCommandState.createAlias(
          name,
          { name: targetName.toLowerCase(), args, destination: command.destination },
          commandNames,
        );
        await persistState();
        appendOutput(`Alias :${name.toLowerCase()} created.`);
      } catch (error) {
        appendOutput(error.message, "error");
      }
      return true;
    }

    if (command.name === "unalias") {
      const name = command.args[0]?.toLowerCase();
      if (!name || !Object.hasOwn(aliases, name)) {
        appendOutput(name ? `No alias named :${name} exists.` : "Usage: :unalias name.", "error");
      } else {
        delete aliases[name];
        await persistState();
        appendOutput(`Alias :${name} removed.`);
      }
      return true;
    }

    if (command.name === "aliases") {
      const entries = Object.entries(aliases).map(([name, alias]) => {
        const target = alias.command;
        return `:${name} → :${target.name} ${target.args.join(" ")}`.trim();
      });
      appendOutput(entries.length ? entries.join("\n") : "No command aliases are defined.");
      return true;
    }

    if (command.name === "history") {
      showHistory(command);
      return true;
    }

    if (command.name === "clear_history") {
      history.length = 0;
      historyIndex = 0;
      await persistState();
      appendOutput("Command history cleared.");
      return true;
    }

    if (command.name === "set") {
      if (command.args.length !== 2) {
        appendOutput(
          "Preference syntax: :set history_limit 100 | search_engine duckduckgo|google|bing.",
          "error",
        );
        return true;
      }
      try {
        preferences = globalThis.VimCommandState.updatePreference(
          preferences,
          command.args[0],
          command.args[1],
        );
        if (command.args[0] === "history_limit") {
          const normalized = globalThis.VimCommandState.normalizeHistory(
            history,
            preferences.historyLimit,
          );
          history.splice(0, history.length, ...normalized);
        }
        await persistState();
        appendOutput(`${command.args[0]} set to ${command.args[1]}.`);
      } catch (error) {
        appendOutput(error.message, "error");
      }
      return true;
    }

    return false;
  }

  function commandForExecution(command) {
    if (command.name !== "search") return command;
    const query = command.args.join(" ").trim();
    if (!query) return command;
    return {
      ...command,
      name: "open",
      args: [globalThis.VimCommandState.buildSearchUrl(query, preferences.searchEngine)],
    };
  }

  async function runCommand() {
    const raw = input.value.trim();
    if (!raw) return;
    await stateReady;
    try {
      const parsed = globalThis.VimCommandParser.parseCommandLine(raw);
      if (parsed.commands.length > 1) {
        appendOutput("Command chaining is recognized but execution is deferred to a later phase.");
        input.value = "";
        return;
      }
      const updatedHistory = globalThis.VimCommandState.appendHistory(
        history,
        raw,
        preferences.historyLimit,
      );
      history.splice(0, history.length, ...updatedHistory);
      historyIndex = history.length;
      await persistState();

      for (const parsedCommand of parsed.commands) {
        const command = globalThis.VimCommandState.expandAlias(parsedCommand, aliases);
        const definition = globalThis.VimCommandRegistry.get(command.name);
        if (!definition || definition.status !== "implemented") {
          const suggestions = globalThis.VimCommandSuggestions.suggestCommands(command.name, [
            ...commandNames,
            ...Object.keys(aliases),
          ]);
          const hint = suggestions.length
            ? ` Did you mean ${suggestions.map((name) => `:${name}`).join(", ")}?`
            : " Try :help.";
          appendOutput(`Unknown or not-yet-implemented command: ${command.name}.${hint}`, "error");
          continue;
        }
        if (await handleLocalCommand(command)) continue;
        if (command.name === "help") {
          const allCommands = globalThis.VimCommandRegistry.all();
          const available = allCommands
            .filter((item) => item.status === "implemented")
            .map((item) => `:${item.name}`);
          const planned = allCommands
            .filter((item) => item.status === "planned")
            .map((item) => `:${item.name}`);
          appendOutput(`Available: ${available.join(", ")}`);
          appendOutput(`Planned: ${planned.join(", ")}`);
          appendOutput(
            "Examples: :tabs twitch · :alias stream move twitch, new_window · :search cats",
          );
        } else if (command.name === "version") {
          appendOutput("Firefox Vim Controls v0.1.0");
        } else if (command.name === "clear") {
          output.replaceChildren();
        } else {
          const requestCommand = commandForExecution(command);
          const response = await browser.runtime.sendMessage({
            type: "VIM_COMMAND_REQUEST",
            command: {
              name: requestCommand.name,
              args: requestCommand.args,
              destination: requestCommand.destination,
            },
          });
          if (!response?.ok) {
            appendOutput(response?.error || "The background command failed.", "error");
          } else {
            for (const line of response.output || []) appendOutput(line);
          }
        }
      }
      input.value = "";
    } catch (error) {
      appendOutput(error.message, "error");
    }
  }

  async function handlePromptKeydown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      closePanel();
    } else if (event.key === "Enter") {
      event.preventDefault();
      runCommand();
    } else if (event.key === "Tab") {
      event.preventDefault();
      await stateReady;
      completeInput();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      await stateReady;
      if (history.length) {
        historyIndex = Math.max(0, historyIndex - 1);
        input.value = history[historyIndex];
      }
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      await stateReady;
      historyIndex = Math.min(history.length, historyIndex + 1);
      input.value = history[historyIndex] || "";
    }
  }

  document.addEventListener(
    "keydown",
    (event) => {
      if (panel) return;
      if (
        event.key === "Escape" &&
        globalThis.VimCommandActivation.isEditableTarget(event.target)
      ) {
        event.target.blur?.();
        return;
      }
      if (globalThis.VimCommandActivation.shouldOpenCommandMode(event)) {
        event.preventDefault();
        showPanel();
      }
    },
    true,
  );
})();
