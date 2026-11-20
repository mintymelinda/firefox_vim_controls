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
    if (
      browserApi.tabs?.query &&
      browserApi.tabs?.sendMessage &&
      sender.tab?.id !== undefined
    ) {
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
      for (const source of sources) {
        const ids = source.tabs.map((tab) => tab.id);
        if (!ids.length) continue;
        try {
          await browserApi.tabs.move(ids, { windowId: target.id, index: -1 });
          moved += ids.length;
        } catch (error) {
          failures.push(
            `Window ${source.index}: ${error instanceof Error ? error.message : "move failed"}`,
          );
        }
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
      let changed = 0;
      for (const window of affected) {
        const inWindow = selected.filter((tab) => tab.windowId === window.id);
        changed += await reorderWindow(window, inWindow, name, key, browserApi, selectors);
      }
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
        const [first, ...remaining] = selected;
        const created = await browserApi.windows.create({ tabId: first.id });
        if (remaining.length) {
          try {
            await moveTabsToWindow(remaining, created.id, browserApi);
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
      await moveTabsToWindow(moving, target.window.id, browserApi);
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
      return { ok: true, output: previewLines("refresh", selector, selected, windows) };
    }
    const operations = {
      back: (id) => browserApi.tabs.goBack(id),
      forward: (id) => browserApi.tabs.goForward(id),
      refresh: (id) => browserApi.tabs.reload(id),
      home: (id) => browserApi.tabs.update(id, { url: "about:home" }),
    };
    const operation = operations[command.name];
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

  async function executeCommand(command, browserApi, selectors) {
    const windows = await getNormalWindowSnapshot(browserApi);
    const focusedWindow = windows.find((window) => window.focused);
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
    resolveNavigationUrl,
    executeMutation,
    executeWindowCommand,
    moveTabsToWindow,
    getNormalWindowSnapshot,
    handleMessage,
    handleStateMessage,
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
