((root) => {
  const IMPLEMENTED_COMMANDS = new Set([
    "tabs",
    "count",
    "current",
    "domains",
    "duplicates",
    "audible",
    "loading",
    "bookmarks",
    "downloads",
    "new_private",
    "close",
    "move",
    "reload",
    "mute",
    "unmute",
    "pin",
    "unpin",
    "discard",
    "windows",
    "window",
    "new_window",
    "fullscreen",
    "minimize",
    "maximize",
    "merge",
    "split",
    "sort",
    "reverse",
    "shuffle",
    "open",
    "search",
    "back",
    "forward",
    "refresh",
    "home",
    "session",
    "workspace",
    "undo",
  ]);

  const undoStack = [];
  const MAX_UNDO_ENTRIES = 20;
  const UNDO_BARRIERS = new Set([
    "open",
    "search",
    "back",
    "forward",
    "home",
    "new_window",
    "new_private",
    "bookmarks",
    "downloads",
    "window",
    "fullscreen",
    "minimize",
    "maximize",
    "session",
    "workspace",
  ]);

  function captureTabPositions(tabs) {
    return tabs.map((tab) => ({
      id: tab.id,
      windowId: tab.windowId,
      index: tab.index,
      pinned: Boolean(tab.pinned),
      muted: Boolean(tab.mutedInfo?.muted ?? tab.muted),
    }));
  }

  function pushUndo(entry) {
    if (!entry?.positions?.length && !entry?.tabs?.length) return;
    undoStack.push(entry);
    if (undoStack.length > MAX_UNDO_ENTRIES) undoStack.shift();
  }

  function clearUndoStack() {
    undoStack.length = 0;
  }

  async function restoreTabPositions(positions, browserApi) {
    const windows = await getNormalWindowSnapshot(browserApi);
    const currentWindows = new Map(windows.map((window) => [window.id, window]));
    const currentTabs = new Map(
      windows.flatMap((window) =>
        window.tabs.map((tab) => [tab.id, { ...tab, windowId: window.id }]),
      ),
    );
    const groups = new Map();
    for (const position of [...positions].sort((left, right) => {
      return left.windowId - right.windowId || left.index - right.index;
    })) {
      const group = groups.get(position.windowId) || [];
      group.push(position);
      groups.set(position.windowId, group);
    }
    const failures = [];
    let moved = 0;
    for (const [originalWindowId, group] of groups) {
      let targetWindowId = originalWindowId;
      if (!currentWindows.has(targetWindowId)) {
        const first = group.find((position) => currentTabs.has(position.id));
        if (!first) {
          failures.push(
            `Original window ${originalWindowId} no longer exists and no saved tabs remain.`,
          );
          continue;
        }
        try {
          const created = await browserApi.windows.create({
            tabId: first.id,
            focused: false,
          });
          targetWindowId = created.id;
          currentTabs.set(first.id, {
            ...currentTabs.get(first.id),
            windowId: targetWindowId,
            index: 0,
          });
          moved += 1;
        } catch (error) {
          failures.push(
            `Could not recreate window ${originalWindowId}: ${error instanceof Error ? error.message : "window creation failed"}`,
          );
          continue;
        }
      }
      for (const position of group) {
        if (!currentTabs.has(position.id)) {
          failures.push(`Tab #${position.id} is no longer open.`);
          continue;
        }
        const current = currentTabs.get(position.id);
        if (current.windowId === targetWindowId && current.index === position.index) continue;
        try {
          await browserApi.tabs.move(position.id, {
            windowId: targetWindowId,
            index: position.index,
          });
          currentTabs.set(position.id, {
            ...current,
            windowId: targetWindowId,
            index: position.index,
          });
          moved += 1;
        } catch (error) {
          failures.push(
            `Tab #${position.id}: ${error instanceof Error ? error.message : "tab move failed"}`,
          );
        }
      }
    }
    return { failures, moved };
  }

  async function undoLastCommand(browserApi) {
    const entry = undoStack.at(-1);
    if (!entry) return { ok: false, error: "There is no supported command to undo." };
    const failures = [];
    if (entry.type === "tab-state") {
      for (const tab of entry.tabs) {
        try {
          await browserApi.tabs.update(tab.id, tab.properties);
        } catch (error) {
          failures.push(
            `Tab #${tab.id}: ${error instanceof Error ? error.message : "state restore failed"}`,
          );
        }
      }
    }
    const restored = await restoreTabPositions(entry.positions, browserApi);
    failures.push(...restored.failures);
    if (!failures.length && entry.cleanupWindowIds?.length && browserApi.windows.remove) {
      const windows = await getNormalWindowSnapshot(browserApi);
      for (const id of entry.cleanupWindowIds) {
        const window = windows.find((item) => item.id === id);
        if (window && window.tabs.length === 0) {
          try {
            await browserApi.windows.remove(id);
          } catch (error) {
            failures.push(
              `Window #${id}: ${error instanceof Error ? error.message : "could not close empty window"}`,
            );
          }
        }
      }
    }
    if (failures.length) {
      return {
        ok: false,
        error: `Undo was partial (${restored.moved} tab move(s) restored): ${failures.join("; ")}`,
      };
    }
    undoStack.pop();
    return {
      ok: true,
      output: [`Undid ${entry.label || "the previous reversible command"}.`],
    };
  }

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
    const maxArgumentLength = command.name === "open" ? 8192 : 256;
    if (
      !Array.isArray(command.args) ||
      command.args.length > 32 ||
      command.args.some((arg) => typeof arg !== "string" || arg.length > maxArgumentLength)
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

  const MACRO_STORAGE_KEY = "fvcCommandMacros";

  function allowedMacroCommands() {
    return [...IMPLEMENTED_COMMANDS].filter((name) => name !== "undo");
  }

  function validateMacroMessage(message) {
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      return "Invalid macro message";
    }
    const types = {
      VIM_MACRO_GET: ["type", "name"],
      VIM_MACRO_SET: ["type", "name", "commands"],
      VIM_MACRO_DELETE: ["type", "name"],
    };
    const allowedKeys = types[message.type];
    if (!allowedKeys) return "Invalid macro message type";
    if (Object.keys(message).some((key) => !allowedKeys.includes(key))) {
      return "Unexpected macro message properties";
    }
    if (message.type !== "VIM_MACRO_GET" || Object.hasOwn(message, "name")) {
      try {
        root.VimMacroState.normalizeName(message.name);
      } catch (error) {
        return error instanceof Error ? error.message : "Invalid macro name";
      }
    }
    if (message.type === "VIM_MACRO_SET") {
      try {
        root.VimMacroState.normalizeCommands(message.commands, allowedMacroCommands());
      } catch (error) {
        return error instanceof Error ? error.message : "Invalid macro commands";
      }
    }
    return null;
  }

  async function handleMacroMessage(message, browserApi, sender = {}) {
    const validationError = validateMacroMessage(message);
    if (validationError) return { ok: false, error: validationError };
    if (sender.tab?.incognito) {
      return { ok: false, error: "Macros are disabled in private browsing." };
    }
    if (!browserApi?.storage?.local || !root.VimMacroState) {
      return { ok: false, error: "Local macro storage is unavailable." };
    }
    const stored = await browserApi.storage.local.get([MACRO_STORAGE_KEY]);
    const macros = root.VimMacroState.normalizeMacros(
      stored[MACRO_STORAGE_KEY],
      allowedMacroCommands(),
    );
    if (message.type === "VIM_MACRO_GET") {
      if (!Object.hasOwn(message, "name")) {
        return { ok: true, macros: root.VimMacroState.listMacros(macros, allowedMacroCommands()) };
      }
      const name = root.VimMacroState.normalizeName(message.name);
      const record = macros[name];
      if (!record) return { ok: false, error: `No macro named "${name}" exists.` };
      return { ok: true, name, commands: record.commands };
    }
    if (message.type === "VIM_MACRO_SET") {
      const updated = root.VimMacroState.saveMacro(
        macros,
        message.name,
        message.commands,
        allowedMacroCommands(),
      );
      await browserApi.storage.local.set({ [MACRO_STORAGE_KEY]: updated });
      return { ok: true, output: [`Macro "${message.name}" saved.`] };
    }
    const updated = root.VimMacroState.deleteMacro(macros, message.name, allowedMacroCommands());
    await browserApi.storage.local.set({ [MACRO_STORAGE_KEY]: updated });
    return { ok: true, output: [`Macro "${message.name}" deleted.`] };
  }

  const SESSION_STORAGE_KEYS = ["fvcSessions", "fvcLastSessionName", "fvcWorkspaces"];

  async function readSessionCollections(browserApi) {
    const stored = await browserApi.storage.local.get(SESSION_STORAGE_KEYS);
    return {
      sessions: root.VimSessionState.normalizeCollection(
        stored.fvcSessions,
        root.VimSessionState.LIMITS.sessions,
      ),
      lastSessionName:
        typeof stored.fvcLastSessionName === "string" ? stored.fvcLastSessionName : "",
      workspaces: root.VimSessionState.normalizeCollection(
        stored.fvcWorkspaces,
        root.VimSessionState.LIMITS.workspaces,
      ),
    };
  }

  function snapshotSummary(snapshot) {
    const tabs = snapshot.windows.reduce((count, window) => count + window.tabs.length, 0);
    return `${snapshot.windows.length} window(s), ${tabs} tab(s)`;
  }

  async function restoreSnapshot(snapshot, browserApi) {
    const normalized = root.VimSessionState.normalizeSnapshot(snapshot);
    if (!normalized) throw new Error("The saved snapshot contains no restorable tabs.");
    const createdWindows = [];
    try {
      for (const savedWindow of normalized.windows) {
        const [firstTab, ...remainingTabs] = savedWindow.tabs;
        const createdWindow = await browserApi.windows.create({
          url: firstTab.url,
          focused: false,
        });
        createdWindows.push(createdWindow.id);
        const windowTabs = await browserApi.tabs.query({ windowId: createdWindow.id });
        const restoredTabs = windowTabs.slice(0, 1);
        if (!restoredTabs[0]) throw new Error("Firefox did not return the first restored tab.");
        if (firstTab.pinned) {
          await browserApi.tabs.update(restoredTabs[0].id, { pinned: true });
        }
        for (const savedTab of remainingTabs) {
          const createdTab = await browserApi.tabs.create({
            windowId: createdWindow.id,
            url: savedTab.url,
            active: false,
            pinned: savedTab.pinned,
          });
          restoredTabs.push(createdTab);
        }
        const activeIndex = savedWindow.tabs.findIndex((tab) => tab.active);
        if (activeIndex > 0 && restoredTabs[activeIndex]) {
          await browserApi.tabs.update(restoredTabs[activeIndex].id, { active: true });
        }
        if (savedWindow.focused) {
          await browserApi.windows.update(createdWindow.id, { focused: true });
        }
      }
    } catch (error) {
      if (createdWindows.length && browserApi.windows.remove) {
        await Promise.all(
          createdWindows.map(async (id) => {
            try {
              await browserApi.windows.remove(id);
            } catch {
              // Keep reporting the original restore failure if rollback is unavailable.
            }
          }),
        );
      }
      throw new Error(
        `Session restore failed after creating ${createdWindows.length} window(s): ${error instanceof Error ? error.message : "browser API failure"}`,
      );
    }
    return createdWindows.map((id) => ({ id }));
  }

  async function appendSnapshot(snapshot, focusedWindow, browserApi) {
    if (!focusedWindow)
      throw new Error("There is no focused normal browser window to append into.");
    const normalized = root.VimSessionState.normalizeSnapshot(snapshot);
    if (!normalized) throw new Error("The saved snapshot contains no restorable tabs.");
    const createdTabs = [];
    let activeIndex = -1;
    try {
      for (const savedWindow of normalized.windows) {
        for (const savedTab of savedWindow.tabs) {
          const createdTab = await browserApi.tabs.create({
            windowId: focusedWindow.id,
            url: savedTab.url,
            active: false,
            pinned: savedTab.pinned,
          });
          createdTabs.push(createdTab);
          if (savedTab.active && (savedWindow.focused || activeIndex < 0)) {
            activeIndex = createdTabs.length - 1;
          }
        }
      }
      if (activeIndex >= 0 && createdTabs[activeIndex]) {
        await browserApi.tabs.update(createdTabs[activeIndex].id, { active: true });
      }
    } catch (error) {
      if (createdTabs.length && browserApi.tabs.remove) {
        try {
          await browserApi.tabs.remove(createdTabs.map((tab) => tab.id));
        } catch {
          // Preserve the original append failure if cleanup is unavailable.
        }
      }
      throw new Error(
        `Session append failed after creating ${createdTabs.length} tab(s): ${error instanceof Error ? error.message : "browser API failure"}`,
      );
    }
    return createdTabs.length;
  }

  async function executeSessionCommand(command, windows, focusedWindow, browserApi) {
    if (!browserApi?.storage?.local || !root.VimSessionState) {
      throw new Error("Local session storage is unavailable.");
    }
    const [action, ...nameParts] = command.args;
    const name = nameParts.join(" ").trim();
    if ((action === "list" || action === "restore") && nameParts.length > 0) {
      throw new Error("This session action does not accept a name.");
    }
    if (["save", "load", "append", "delete"].includes(action) && nameParts.length !== 1) {
      throw new Error("This session action requires exactly one name.");
    }
    const { sessions, lastSessionName, workspaces } = await readSessionCollections(browserApi);
    if (action === "list") {
      const entries = root.VimSessionState.listRecords(
        sessions,
        root.VimSessionState.LIMITS.sessions,
      );
      return {
        ok: true,
        output: entries.length
          ? entries.map((item) => `${item.name} — ${item.windows} window(s), ${item.tabs} tab(s)`)
          : ["No saved sessions."],
      };
    }
    if (action === "save") {
      const key = root.VimSessionState.normalizeName(name);
      const snapshot = root.VimSessionState.captureSnapshot(windows);
      const updated = root.VimSessionState.saveRecord(
        sessions,
        key,
        snapshot,
        root.VimSessionState.LIMITS.sessions,
      );
      root.VimSessionState.assertStorageBudget(updated, workspaces);
      await browserApi.storage.local.set({ fvcSessions: updated, fvcLastSessionName: key });
      return { ok: true, output: [`Saved session "${key}" — ${snapshotSummary(snapshot)}.`] };
    }
    if (action === "delete") {
      const updated = root.VimSessionState.deleteRecord(
        sessions,
        name,
        root.VimSessionState.LIMITS.sessions,
      );
      await browserApi.storage.local.set({
        fvcSessions: updated,
        ...(lastSessionName === name ? { fvcLastSessionName: "" } : {}),
      });
      return { ok: true, output: [`Deleted session "${name}".`] };
    }
    if (action === "load" || action === "restore" || action === "append") {
      const key = action === "restore" ? lastSessionName : name;
      if (!key) throw new Error("No last-saved session is available to restore.");
      const record = sessions[key];
      if (!record) throw new Error(`No saved session named "${key}" exists.`);
      if (action === "append") {
        const count = await appendSnapshot(record.snapshot, focusedWindow, browserApi);
        return { ok: true, output: [`Appended ${count} tab(s) from session "${key}".`] };
      }
      const created = await restoreSnapshot(record.snapshot, browserApi);
      return {
        ok: true,
        output: [`Loaded session "${key}" into ${created.length} new window(s).`],
      };
    }
    throw new Error(
      "Session syntax: :session save|load|append|list|delete name, or :session restore.",
    );
  }

  async function executeWorkspaceCommand(command, windows, _focusedWindow, browserApi) {
    if (!browserApi?.storage?.local || !root.VimSessionState) {
      throw new Error("Local workspace storage is unavailable.");
    }
    const [action, ...nameParts] = command.args;
    const name = nameParts.join(" ").trim();
    if (action === "list" && nameParts.length > 0) {
      throw new Error("Workspace list does not accept a name.");
    }
    if (["create", "switch"].includes(action) && nameParts.length !== 1) {
      throw new Error("This workspace action requires exactly one name.");
    }
    if (action === "rename" && nameParts.length !== 2) {
      throw new Error("Workspace rename syntax: :workspace rename old new.");
    }
    const { sessions, workspaces } = await readSessionCollections(browserApi);
    if (action === "list") {
      const entries = root.VimSessionState.listRecords(
        workspaces,
        root.VimSessionState.LIMITS.workspaces,
      );
      return {
        ok: true,
        output: entries.length
          ? entries.map((item) => `${item.name} — ${item.windows} window(s), ${item.tabs} tab(s)`)
          : ["No workspaces have been created."],
      };
    }
    if (action === "create") {
      const key = root.VimSessionState.normalizeName(name);
      if (Object.hasOwn(workspaces, key)) {
        throw new Error(`Workspace "${key}" already exists.`);
      }
      const snapshot = root.VimSessionState.captureSnapshot(windows);
      const updated = root.VimSessionState.saveRecord(
        workspaces,
        key,
        snapshot,
        root.VimSessionState.LIMITS.workspaces,
      );
      root.VimSessionState.assertStorageBudget(sessions, updated);
      await browserApi.storage.local.set({ fvcWorkspaces: updated });
      return { ok: true, output: [`Created workspace "${key}" — ${snapshotSummary(snapshot)}.`] };
    }
    if (action === "switch") {
      const record = workspaces[name];
      if (!record) throw new Error(`No workspace named "${name}" exists.`);
      const created = await restoreSnapshot(record.snapshot, browserApi);
      return {
        ok: true,
        output: [`Opened workspace "${name}" in ${created.length} new window(s).`],
      };
    }
    if (action === "rename") {
      const [oldName, newName] = nameParts;
      const updated = root.VimSessionState.renameRecord(
        workspaces,
        oldName,
        newName,
        root.VimSessionState.LIMITS.workspaces,
      );
      await browserApi.storage.local.set({ fvcWorkspaces: updated });
      return { ok: true, output: [`Renamed workspace "${oldName}" to "${newName}".`] };
    }
    throw new Error(
      "Workspace syntax: :workspace create|switch name, :workspace list, or :workspace rename old new.",
    );
  }

  const STATE_STORAGE_KEYS = ["fvcCommandHistory", "fvcCommandAliases", "fvcCommandPreferences"];

  function validateStateMessage(message) {
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      return "Invalid state message";
    }
    if (!["VIM_STATE_GET", "VIM_STATE_SET"].includes(message.type)) {
      return "Invalid state message type";
    }
    if (Object.keys(message).some((key) => !["type", "state"].includes(key))) {
      return "Unexpected state message properties";
    }
    if (message.type === "VIM_STATE_GET") {
      return Object.hasOwn(message, "state") ? "Unexpected state payload" : null;
    }
    const state = message.state;
    if (!state || typeof state !== "object" || Array.isArray(state)) {
      return "Invalid state payload";
    }
    if (Object.keys(state).some((key) => !["history", "aliases", "preferences"].includes(key))) {
      return "Unexpected state properties";
    }
    if (
      !Array.isArray(state.history) ||
      !state.aliases ||
      typeof state.aliases !== "object" ||
      Array.isArray(state.aliases) ||
      !state.preferences ||
      typeof state.preferences !== "object" ||
      Array.isArray(state.preferences)
    ) {
      return "Invalid state values";
    }
    return null;
  }

  function emptyStoredState() {
    return {
      history: [],
      aliases: {},
      preferences: root.VimCommandState.normalizePreferences(),
    };
  }

  function normalizeStoredState(state) {
    const preferences = root.VimCommandState.normalizePreferences(state.fvcCommandPreferences);
    return {
      history: root.VimCommandState.normalizeHistory(
        state.fvcCommandHistory,
        preferences.historyLimit,
      ),
      aliases: {
        ...root.VimCommandState.normalizeAliases(
          state.fvcCommandAliases,
          root.VimCommandRegistry.names(),
        ),
      },
      preferences,
    };
  }

  async function handleStateMessage(message, browserApi, sender = {}) {
    const validationError = validateStateMessage(message);
    if (validationError) return { ok: false, error: validationError };
    const privateContext = Boolean(sender.tab?.incognito);
    if (privateContext) {
      return {
        ok: true,
        persisted: false,
        ...(message.type === "VIM_STATE_GET" ? { state: emptyStoredState() } : {}),
      };
    }
    const storage = browserApi?.storage?.local;
    if (
      !root.VimCommandState ||
      !root.VimCommandRegistry ||
      !root.VimCommandState.canPersistState(privateContext, storage)
    ) {
      return { ok: false, error: "Extension storage is unavailable." };
    }
    if (message.type === "VIM_STATE_GET") {
      const stored = await storage.get(STATE_STORAGE_KEYS);
      return { ok: true, state: normalizeStoredState(stored) };
    }
    const preferences = root.VimCommandState.normalizePreferences(message.state.preferences);
    const history = root.VimCommandState.normalizeHistory(
      message.state.history,
      preferences.historyLimit,
    );
    const aliases = {
      ...root.VimCommandState.normalizeAliases(
        message.state.aliases,
        root.VimCommandRegistry.names(),
      ),
    };
    const updatedState = { history, aliases, preferences };
    await storage.set({
      fvcCommandHistory: history,
      fvcCommandAliases: aliases,
      fvcCommandPreferences: preferences,
    });
    if (browserApi.tabs?.query && browserApi.tabs?.sendMessage && sender.tab?.id !== undefined) {
      try {
        const tabs = await browserApi.tabs.query({});
        await Promise.all(
          tabs
            .filter((tab) => !tab.incognito && tab.id !== sender.tab.id)
            .map(async (tab) => {
              try {
                await browserApi.tabs.sendMessage(tab.id, {
                  type: "VIM_STATE_UPDATED",
                  state: updatedState,
                });
              } catch {
                // Tabs without the content script can be ignored.
              }
            }),
        );
      } catch {
        // Persisted state remains available when each tab next loads the prompt.
      }
    }
    return { ok: true, persisted: true };
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
        state: window.state || "normal",
        tabs: (window.tabs || [])
          .filter((tab) => !tab.incognito)
          .sort((left, right) => (left.index ?? 0) - (right.index ?? 0)),
      }));
  }

  function commandOptions(command) {
    const confirmed = command.args.includes("--confirm");
    const selectorArgs = command.args.filter((arg) => arg !== "--confirm");
    const selector =
      selectorArgs[0] === "domain" && selectorArgs.length === 2
        ? `domain:${selectorArgs[1]}`
        : selectorArgs.join(" ");
    return {
      confirmed,
      selector: selector || "all",
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
    return { ok: failures.length === 0, output };
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

  function windowSummary(window) {
    const active = window.tabs.find((tab) => tab.active);
    const label = active?.title || active?.url || "No active tab";
    const state = window.focused ? "focused" : window.state;
    return `Window ${window.index} (#${window.id}) — ${window.tabs.length} tab(s), ${state}: ${String(label).replace(/\s+/g, " ").trim()}`;
  }

  function resolveWindowSelection(value, windows, focusedWindow) {
    const selector = String(value || "")
      .trim()
      .toLowerCase();
    if (!selector) {
      if (!focusedWindow) throw new Error("There is no focused normal browser window.");
      return focusedWindow;
    }
    if (selector === "next" || selector === "previous") {
      if (!focusedWindow) throw new Error("There is no focused normal browser window.");
      const offset = selector === "next" ? 1 : -1;
      const index = (focusedWindow.index - 1 + offset + windows.length) % windows.length;
      return windows[index];
    }
    const index = Number(selector);
    if (!Number.isSafeInteger(index) || index < 1) {
      throw new Error("Use :window 2, :window next, or :window previous.");
    }
    const window = windows.find((item) => item.index === index);
    if (!window) throw new Error(`No normal browser window at index ${index}`);
    return window;
  }

  function compareTabs(left, right, key, selectors) {
    if (key === "recent") {
      return (right.lastAccessed || 0) - (left.lastAccessed || 0);
    }
    if (key === "domain") {
      return selectors.hostnameOf(left).localeCompare(selectors.hostnameOf(right));
    }
    const leftValue = key === "title" ? left.title || "" : left.url || "";
    const rightValue = key === "title" ? right.title || "" : right.url || "";
    return String(leftValue).localeCompare(String(rightValue), undefined, {
      numeric: true,
      sensitivity: "base",
    });
  }

  function orderedSelection(tabs, mode, key, selectors, random = Math.random) {
    const selected = [...tabs];
    if (mode === "sort") {
      return selected
        .map((tab, index) => ({ tab, index }))
        .sort((left, right) => {
          const comparison = compareTabs(left.tab, right.tab, key, selectors);
          return comparison || left.index - right.index;
        })
        .map(({ tab }) => tab);
    }
    if (mode === "reverse") return selected.reverse();
    for (let index = selected.length - 1; index > 0; index -= 1) {
      const target = Math.floor(random() * (index + 1));
      [selected[index], selected[target]] = [selected[target], selected[index]];
    }
    return selected;
  }

  async function reorderWindow(window, selected, mode, key, browserApi, selectors, random) {
    const selectedIds = new Set(selected.map((tab) => tab.id));
    const current = [...window.tabs];
    let changed = 0;
    for (const pinned of [true, false]) {
      const slots = current
        .map((tab, index) => ({ tab, index }))
        .filter(({ tab }) => selectedIds.has(tab.id) && Boolean(tab.pinned) === pinned)
        .map(({ index }) => index);
      if (slots.length < 2) continue;
      const group = slots.map((index) => current[index]);
      const ordered = orderedSelection(group, mode, key, selectors, random);
      for (let offset = 0; offset < slots.length; offset += 1) {
        const targetIndex = slots[offset];
        const desired = ordered[offset];
        const currentIndex = current.findIndex((tab) => tab.id === desired.id);
        if (currentIndex === targetIndex) continue;
        await browserApi.tabs.move(desired.id, {
          windowId: window.id,
          index: targetIndex,
        });
        const [moved] = current.splice(currentIndex, 1);
        current.splice(targetIndex, 0, moved);
        changed += 1;
      }
    }
    return changed;
  }

  async function moveTabsToWindow(tabs, targetWindowId, browserApi) {
    const groups = new Map();
    for (const tab of tabs) {
      if (tab.windowId === targetWindowId) continue;
      const group = groups.get(tab.windowId) || [];
      group.push(tab);
      groups.set(tab.windowId, group);
    }
    let moved = 0;
    for (const group of groups.values()) {
      await browserApi.tabs.move(
        group.map((tab) => tab.id),
        { windowId: targetWindowId, index: -1 },
      );
      moved += group.length;
    }
    return moved;
  }

  async function executeWindowCommand(command, windows, focusedWindow, browserApi) {
    const name = command.name;
    if (name === "windows") {
      return {
        ok: true,
        output: windows.length ? windows.map(windowSummary) : ["No normal browser windows."],
      };
    }
    if (name === "new_window") {
      const created = await browserApi.windows.create({});
      return { ok: true, output: [`Created normal window #${created.id}.`] };
    }
    if (name === "window") {
      const target = resolveWindowSelection(command.args[0], windows, focusedWindow);
      await browserApi.windows.update(target.id, { focused: true });
      return { ok: true, output: [`Focused window ${target.index} (#${target.id}).`] };
    }
    if (["fullscreen", "minimize", "maximize"].includes(name)) {
      if (!focusedWindow) {
        return { ok: false, error: "There is no focused normal browser window." };
      }
      const state = {
        fullscreen: "fullscreen",
        minimize: "minimized",
        maximize: "maximized",
      }[name];
      await browserApi.windows.update(focusedWindow.id, { state });
      return { ok: true, output: [`Window ${focusedWindow.index} is now ${state}.`] };
    }
    if (name === "merge") {
      if (!focusedWindow) {
        return { ok: false, error: "There is no focused normal browser window." };
      }
      const target = focusedWindow;
      const sources = command.args.length
        ? [resolveWindowSelection(command.args[0], windows, focusedWindow)].filter(
            (window) => window.id !== target.id,
          )
        : windows.filter((window) => window.id !== target.id);
      if (!sources.length) {
        return { ok: true, output: ["No other normal windows to merge."] };
      }
      let moved = 0;
      const failures = [];
      const movedPositions = [];
      for (const source of sources) {
        const ids = source.tabs.map((tab) => tab.id);
        if (!ids.length) continue;
        try {
          await browserApi.tabs.move(ids, { windowId: target.id, index: -1 });
          moved += ids.length;
          movedPositions.push(
            ...captureTabPositions(source.tabs.map((tab) => ({ ...tab, windowId: source.id }))),
          );
        } catch (error) {
          failures.push(
            `Window ${source.index}: ${error instanceof Error ? error.message : "move failed"}`,
          );
        }
      }
      if (movedPositions.length) {
        pushUndo({ type: "positions", positions: movedPositions, label: "merge" });
      }
      const output = [`Moved ${moved} tab(s) into window ${target.index}.`, ...failures];
      return {
        ok: failures.length === 0,
        output,
        ...(failures.length ? { error: "Some windows could not be merged." } : {}),
      };
    }
    return null;
  }

  async function executeMutation(
    command,
    selected,
    windows,
    focusedWindow,
    browserApi,
    selector,
    confirmed,
    selectors,
  ) {
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
        return {
          ok: true,
          requiresConfirmation: true,
          output: previewLines(name, selector, removable, windows),
        };
      }
      clearUndoStack();
      const result = await performPerTab(removable, (id) => browserApi.tabs.remove(id));
      if (protectedCount) result.output.push(`Kept one tab open in ${protectedCount} window(s).`);
      return result;
    }

    if (name === "reload") {
      if (!selected.length) return { ok: true, output: ["No tabs matched."] };
      if (selected.length > 1 && !confirmed) {
        return {
          ok: true,
          requiresConfirmation: true,
          output: previewLines(name, selector, selected, windows),
        };
      }
      clearUndoStack();
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
        return {
          ok: true,
          requiresConfirmation: true,
          output: previewLines(name, selector, eligible, windows),
        };
      }
      clearUndoStack();
      const result = await performPerTab(eligible, (id) => browserApi.tabs.discard(id));
      if (skipped) result.output.push(`Skipped ${skipped} active or already-discarded tab(s).`);
      return result;
    }

    if (name === "split") {
      if (!selected.length) return { ok: true, output: ["No tabs matched."] };
      return executeMutation(
        { ...command, name: "move", destination: ["new_window"] },
        selected,
        windows,
        focusedWindow,
        browserApi,
        selector,
        true,
        selectors,
      );
    }

    if (name === "sort" || name === "reverse" || name === "shuffle") {
      const key = name === "sort" ? command.args[0] : null;
      if (name === "sort" && !["domain", "title", "url", "recent"].includes(key)) {
        return { ok: false, error: "Sort key must be domain, title, url, or recent." };
      }
      const affected = windows.filter((window) =>
        selected.some((tab) => tab.windowId === window.id),
      );
      const positions = captureTabPositions(
        affected.flatMap((window) => window.tabs.map((tab) => ({ ...tab, windowId: window.id }))),
      );
      let changed = 0;
      try {
        for (const window of affected) {
          const inWindow = selected.filter((tab) => tab.windowId === window.id);
          changed += await reorderWindow(window, inWindow, name, key, browserApi, selectors);
        }
      } catch (error) {
        const rollback = await restoreTabPositions(positions, browserApi);
        if (rollback.failures.length) pushUndo({ type: "positions", positions, label: name });
        return {
          ok: false,
          error: `Could not complete ${name}: ${error instanceof Error ? error.message : "tab reorder failed"}`,
        };
      }
      if (changed) pushUndo({ type: "positions", positions, label: name });
      return {
        ok: true,
        output: [
          `${name === "sort" ? `Sorted by ${key}` : name} selection; ${changed} tab move(s) applied.`,
        ],
      };
    }

    if (name === "move") {
      if (!selected.length) return { ok: true, output: ["No tabs matched."] };
      const target = resolveMoveTarget(command.destination, windows, focusedWindow);
      if (target.type === "new") {
        const positions = captureTabPositions(selected);
        const [first, ...remaining] = selected;
        const created = await browserApi.windows.create({ tabId: first.id });
        if (remaining.length) {
          try {
            await moveTabsToWindow(remaining, created.id, browserApi);
          } catch (error) {
            const rollback = await restoreTabPositions(positions, browserApi);
            if (rollback.failures.length) {
              pushUndo({
                type: "positions",
                positions,
                label: "move",
                cleanupWindowIds: [created.id],
              });
            } else if (browserApi.windows.remove) {
              await browserApi.windows.remove(created.id).catch(() => {});
            }
            const message = error instanceof Error ? error.message : "move failed";
            return {
              ok: false,
              error: `Could not move all tabs to new window ${created.id}: ${message}`,
            };
          }
        }
        pushUndo({
          type: "positions",
          positions,
          label: "move",
          cleanupWindowIds: [created.id],
        });
        return {
          ok: true,
          output: [`Moved ${selected.length} tab(s) into new window ${created.id}.`],
        };
      }
      const moving = selected.filter((tab) => tab.windowId !== target.window.id);
      if (!moving.length) {
        return { ok: true, output: ["All selected tabs are already in the destination window."] };
      }
      const positions = captureTabPositions(moving);
      try {
        await moveTabsToWindow(moving, target.window.id, browserApi);
      } catch (error) {
        const rollback = await restoreTabPositions(positions, browserApi);
        if (rollback.failures.length) pushUndo({ type: "positions", positions, label: "move" });
        return {
          ok: false,
          error: `Could not move all selected tabs: ${error instanceof Error ? error.message : "tab move failed"}`,
        };
      }
      pushUndo({ type: "positions", positions, label: "move" });
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
      const previous = selected.map((tab) => ({
        id: tab.id,
        properties:
          name === "pin" || name === "unpin"
            ? { pinned: Boolean(tab.pinned) }
            : { muted: Boolean(tab.mutedInfo?.muted ?? tab.muted) },
      }));
      const results = await Promise.all(
        selected.map(async (tab) => {
          try {
            await browserApi.tabs.update(tab.id, updateProperties);
            return null;
          } catch (error) {
            return `#${tab.id}: ${error instanceof Error ? error.message : "update failed"}`;
          }
        }),
      );
      const failures = results.filter(Boolean);
      const succeededIds = new Set(
        selected.filter((_tab, index) => !results[index]).map((tab) => tab.id),
      );
      const succeeded = previous.filter((tab) => succeededIds.has(tab.id));
      if (succeeded.length) {
        pushUndo({
          type: "tab-state",
          tabs: succeeded,
          positions: captureTabPositions(selected.filter((tab) => succeededIds.has(tab.id))),
          label: name,
        });
      }
      return {
        ok: failures.length === 0,
        output: [`${succeeded.length} of ${selected.length} tab(s) updated.`, ...failures],
      };
    }

    return { ok: false, error: `Command is not available: ${name}` };
  }

  const URL_ALIASES = {
    twitch: "https://www.twitch.tv/",
    youtube: "https://www.youtube.com/",
    github: "https://github.com/",
  };

  function resolveNavigationUrl(value) {
    const input = String(value || "").trim();
    if (!input) throw new Error("A URL or shortcut is required.");
    if (Object.hasOwn(URL_ALIASES, input.toLowerCase())) {
      return URL_ALIASES[input.toLowerCase()];
    }
    const candidate = /^[a-z][a-z0-9+.-]*:/i.test(input) ? input : `https://${input}`;
    let url;
    try {
      url = new URL(candidate);
    } catch {
      throw new Error("Enter a valid HTTP(S) URL or a supported shortcut.");
    }
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname) {
      throw new Error("Only HTTP and HTTPS destinations are allowed.");
    }
    if (url.username || url.password) {
      throw new Error("URLs containing embedded credentials are not allowed.");
    }
    return url.href;
  }

  async function executeOpenCommand(command, focusedWindow, browserApi) {
    const value = command.args.join(" ").trim();
    if (!value) {
      return {
        ok: false,
        error:
          command.name === "search"
            ? "Search syntax: :search search terms."
            : "Open syntax: :open URL or shortcut.",
      };
    }
    let url;
    if (command.name === "search") {
      const searchUrl = new URL("https://duckduckgo.com/");
      searchUrl.searchParams.set("q", value);
      url = searchUrl.href;
    } else {
      url = resolveNavigationUrl(value);
    }
    const destination = command.destination.join(" ").trim().toLowerCase();
    if (destination && !["new_tab", "new_window"].includes(destination)) {
      return { ok: false, error: "Open destination must be new_tab or new_window." };
    }
    if (destination === "new_window" || !focusedWindow) {
      const created = await browserApi.windows.create({ url });
      return { ok: true, output: [`Opened ${url} in new window #${created.id}.`] };
    }
    if (destination === "new_tab") {
      const created = await browserApi.tabs.create({
        windowId: focusedWindow.id,
        url,
        active: true,
      });
      return { ok: true, output: [`Opened ${url} in new tab #${created.id}.`] };
    }
    const active = focusedWindow.tabs.find((tab) => tab.active);
    if (active) {
      await browserApi.tabs.update(active.id, { url });
      return { ok: true, output: [`Navigating tab #${active.id} to ${url}.`] };
    }
    const created = await browserApi.tabs.create({
      windowId: focusedWindow.id,
      url,
      active: true,
    });
    return { ok: true, output: [`Opened ${url} in new tab #${created.id}.`] };
  }

  async function executeNavigationCommand(
    command,
    tabs,
    windows,
    focusedWindow,
    browserApi,
    selectors,
  ) {
    const confirmed = command.args.includes("--confirm");
    const args = command.args.filter((arg) => arg !== "--confirm");
    if (command.name === "home" && args.length) {
      return { ok: false, error: "Home syntax: :home." };
    }
    const selector = args.join(" ").trim() || "active";
    const selected = selectors.selectTabs(tabs, selector, {
      currentWindowId: focusedWindow?.id,
      windows,
    });
    if (!selected.length) return { ok: true, output: [`No tabs matched ${selector}.`] };
    if (command.name === "refresh" && selected.length > 1 && !confirmed) {
      return {
        ok: true,
        requiresConfirmation: true,
        output: previewLines("refresh", selector, selected, windows),
      };
    }
    const operations = {
      back: (id) => browserApi.tabs.goBack(id),
      forward: (id) => browserApi.tabs.goForward(id),
      refresh: (id) => browserApi.tabs.reload(id),
      home: (id) => browserApi.tabs.update(id, { url: "about:home" }),
    };
    const operation = operations[command.name];
    if (command.name === "refresh") clearUndoStack();
    if (!operation) {
      return { ok: false, error: `Navigation command is unavailable: ${command.name}` };
    }
    if (
      (command.name === "back" && typeof browserApi.tabs.goBack !== "function") ||
      (command.name === "forward" && typeof browserApi.tabs.goForward !== "function")
    ) {
      return {
        ok: false,
        error: "This Firefox version does not expose the requested history navigation API.",
      };
    }
    const result = await performPerTab(selected, operation);
    const failures = result.output.slice(1);
    const verb = {
      back: "Navigated back",
      forward: "Navigated forward",
      refresh: "Refreshed",
      home: "Sent to the home page",
    }[command.name];
    return {
      ok: result.ok,
      output: [
        `${verb} ${selected.length - failures.length} of ${selected.length} tab(s).`,
        ...failures,
      ],
    };
  }

  async function executePrivateWindowCommand(browserApi) {
    if (typeof browserApi.extension?.isAllowedIncognitoAccess !== "function") {
      return {
        ok: false,
        error:
          "Firefox did not expose private-window permission status; refusing to create a private window.",
      };
    }
    const allowed = await browserApi.extension.isAllowedIncognitoAccess();
    if (!allowed) {
      return {
        ok: false,
        error:
          "Private windows are disabled for this extension. Enable “Run in Private Windows” in Firefox's Add-ons settings, then try again.",
      };
    }
    const created = await browserApi.windows.create({ incognito: true, focused: true });
    return {
      ok: true,
      output: [`Created private window ${created.id}.`],
    };
  }

  async function executeBuiltinPageCommand(name, focusedWindow, browserApi) {
    const url = name === "bookmarks" ? "about:bookmarks" : "about:downloads";
    if (focusedWindow) {
      await browserApi.tabs.create({
        windowId: focusedWindow.id,
        url,
        active: true,
      });
    } else {
      await browserApi.windows.create({ url, focused: true });
    }
    return {
      ok: true,
      output: [`Opened Firefox's ${name} manager in a new tab.`],
    };
  }

  async function executeCommand(command, browserApi, selectors) {
    if (command.name === "undo") {
      if (command.args.length || command.destination.length) {
        return { ok: false, error: "Undo syntax: :undo." };
      }
      return undoLastCommand(browserApi);
    }
    if (UNDO_BARRIERS.has(command.name)) clearUndoStack();
    const windows = await getNormalWindowSnapshot(browserApi);
    const focusedWindow = windows.find((window) => window.focused);
    if (command.name === "new_private") {
      if (command.args.length || command.destination.length) {
        return { ok: false, error: "Private window syntax: :new_private." };
      }
      return executePrivateWindowCommand(browserApi);
    }
    if (["bookmarks", "downloads"].includes(command.name)) {
      if (command.args.length || command.destination.length) {
        return { ok: false, error: `:${command.name} does not accept arguments.` };
      }
      return executeBuiltinPageCommand(command.name, focusedWindow, browserApi);
    }
    if (command.name === "session") {
      return executeSessionCommand(command, windows, focusedWindow, browserApi);
    }
    if (command.name === "workspace") {
      return executeWorkspaceCommand(command, windows, focusedWindow, browserApi);
    }
    if (command.name === "open" || command.name === "search") {
      return executeOpenCommand(command, focusedWindow, browserApi);
    }
    if (["back", "forward", "refresh", "home"].includes(command.name)) {
      const tabs = windows.flatMap((window) =>
        window.tabs.map((tab) => ({ ...tab, windowId: window.id })),
      );
      return executeNavigationCommand(command, tabs, windows, focusedWindow, browserApi, selectors);
    }
    if (
      ["windows", "window", "new_window", "fullscreen", "minimize", "maximize", "merge"].includes(
        command.name,
      )
    ) {
      return executeWindowCommand(command, windows, focusedWindow, browserApi);
    }
    const tabs = windows.flatMap((window) =>
      window.tabs.map((tab) => ({ ...tab, windowId: window.id })),
    );
    const { confirmed, selector: defaultSelector } = commandOptions(command);
    const selector =
      command.name === "sort"
        ? command.args.slice(1).join(" ") || "all"
        : command.name === "split"
          ? command.args.join(" ") || "all"
          : defaultSelector;

    if (command.name === "current") {
      const current = focusedWindow?.tabs.find((tab) => tab.active);
      if (!current) return { ok: true, output: ["No active tab in a normal browser window."] };
      return { ok: true, output: [tabSummary(current, focusedWindow.index)] };
    }

    if (
      command.name === "sort" &&
      !["domain", "title", "url", "recent"].includes(command.args[0])
    ) {
      return { ok: false, error: "Sort syntax: :sort domain|title|url|recent [selector]." };
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

    if (command.name === "audible" || command.name === "loading") {
      if (command.destination.length) {
        return { ok: false, error: `:${command.name} does not accept a destination.` };
      }
      const statusMatched = selectors.selectTabs(tabs, command.name, {
        currentWindowId: focusedWindow?.id,
        windows,
      });
      const selectedStatusTabs =
        selector !== "all"
          ? selectors.selectTabs(statusMatched, selector, {
              currentWindowId: focusedWindow?.id,
              windows,
            })
          : statusMatched;
      const lines = selectedStatusTabs.map((tab) => {
        const window = windows.find((item) => item.id === tab.windowId);
        return tabSummary(tab, window.index);
      });
      return {
        ok: true,
        output: lines.length ? lines : [`No ${command.name} tabs matched.`],
      };
    }
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
    return executeMutation(
      command,
      selected,
      windows,
      focusedWindow,
      browserApi,
      selector,
      confirmed,
      selectors,
    );
  }

  async function handleMessage(
    message,
    browserApi = root.browser,
    selectors = root.VimTabSelectors,
    sender = {},
  ) {
    if (["VIM_MACRO_GET", "VIM_MACRO_SET", "VIM_MACRO_DELETE"].includes(message?.type)) {
      try {
        return await handleMacroMessage(message, browserApi, sender);
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : "Could not access macro storage.",
        };
      }
    }
    if (message?.type === "VIM_STATE_GET" || message?.type === "VIM_STATE_SET") {
      try {
        return await handleStateMessage(message, browserApi, sender);
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : "Could not access extension storage.",
        };
      }
    }
    const validationError = validateCommandRequest(message);
    if (validationError) return { ok: false, error: validationError };
    const { command } = message;
    if (sender.tab?.incognito && ["session", "workspace", "undo"].includes(command.name)) {
      return {
        ok: false,
        error: "Session, workspace, and undo commands are disabled in private browsing.",
      };
    }
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
    root.browser.runtime.onMessage.addListener((message, sender) =>
      handleMessage(message, root.browser, root.VimTabSelectors, sender),
    );
  }

  const api = {
    commandOptions,
    executeCommand,
    executeNavigationCommand,
    executeOpenCommand,
    executeSessionCommand,
    executeWorkspaceCommand,
    restoreSnapshot,
    appendSnapshot,
    resolveNavigationUrl,
    executeMutation,
    executeWindowCommand,
    moveTabsToWindow,
    getNormalWindowSnapshot,
    handleMessage,
    handleStateMessage,
    handleMacroMessage,
    validateMacroMessage,
    clearUndoStack,
    undoLastCommand,
    restoreTabPositions,
    validateStateMessage,
    orderedSelection,
    previewLines,
    removableTabs,
    reorderWindow,
    resolveWindowSelection,
    windowSummary,
    resolveMoveTarget,
    validateCommandRequest,
  };
  root.VimBackgroundCommands = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
