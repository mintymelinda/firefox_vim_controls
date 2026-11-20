"use strict";

(() => {
  if (!globalThis.VimCommandParser || !globalThis.VimCommandActivation) return;

  const HISTORY_LIMIT = 100;
  const history = [];
  let historyIndex = 0;
  let panel = null;
  let input = null;
  let output = null;
  let lastCompletion = "";

  const commandNames = globalThis.VimCommandRegistry.names();

  function appendOutput(message, kind = "info") {
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
    input.focus();
  }

  function completeInput() {
    const value = input.value.trim().replace(/^:/, "");
    if (/\s/.test(value)) return;
    const prefix = value.toLowerCase();
    const matches = commandNames.filter((name) => name.startsWith(prefix));
    if (matches.length === 1) input.value = `:${matches[0]} `;
    else if (matches.length > 1) {
      if (lastCompletion !== value) {
        lastCompletion = value;
        appendOutput(matches.join("  "));
      } else {
        const common = matches.reduce((prefixValue, item) => {
          let length = 0;
          while (length < prefixValue.length && prefixValue[length] === item[length]) length += 1;
          return prefixValue.slice(0, length);
        });
        if (common.length > prefix.length) input.value = `:${common}`;
      }
    }
  }

  function runCommand() {
    const raw = input.value.trim();
    if (!raw) return;
    try {
      const parsed = globalThis.VimCommandParser.parseCommandLine(raw);
      if (parsed.commands.length > 1) {
        appendOutput("Command chaining is recognized but execution is deferred to a later phase.");
        input.value = "";
        return;
      }
      if (history.at(-1) !== raw) history.push(raw);
      if (history.length > HISTORY_LIMIT) history.shift();
      historyIndex = history.length;
      for (const command of parsed.commands) {
        const definition = globalThis.VimCommandRegistry.get(command.name);
        if (!definition || definition.status !== "implemented") {
          const suggestions = globalThis.VimCommandSuggestions.suggestCommands(command.name, commandNames);\n          const hint = suggestions.length ? ` Did you mean ${suggestions.map((name) => `:${name}`).join(", ")}?` : " Try :help.";\n          appendOutput(`Unknown or not-yet-implemented command: ${command.name}.${hint}`, "error");
          continue;
        }
        if (command.name === "help") {
          const allCommands = globalThis.VimCommandRegistry.all();
          const available = allCommands.filter((item) => item.status === "implemented").map((item) => `:${item.name}`);
          const planned = allCommands.filter((item) => item.status === "planned").map((item) => `:${item.name}`);
          appendOutput(`Available: ${available.join(", ")}`);
          appendOutput(`Planned: ${planned.join(", ")}`);
          appendOutput("Examples: :move twitch, new_window · :close duplicates · :sort domain");
        } else if (command.name === "version") {
          appendOutput("Firefox Vim Controls v0.1.0");
        } else if (command.name === "clear") {
          output.replaceChildren();
        }
      }
      input.value = "";
    } catch (error) {
      appendOutput(error.message, "error");
    }
  }

  function handlePromptKeydown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      closePanel();
    } else if (event.key === "Enter") {
      event.preventDefault();
      runCommand();
    } else if (event.key === "Tab") {
      event.preventDefault();
      completeInput();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (history.length) {
        historyIndex = Math.max(0, historyIndex - 1);
        input.value = history[historyIndex];
      }
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      historyIndex = Math.min(history.length, historyIndex + 1);
      input.value = history[historyIndex] || "";
    }
  }

  document.addEventListener("keydown", (event) => {
    if (panel) return;
    if (event.key === "Escape" && globalThis.VimCommandActivation.isEditableTarget(event.target)) {
      event.target.blur?.();
      return;
    }
    if (globalThis.VimCommandActivation.shouldOpenCommandMode(event)) {
      event.preventDefault();
      showPanel();
    }
  }, true);
})();
