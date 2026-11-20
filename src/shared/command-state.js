(function (root) {
  "use strict";

  const DEFAULT_PREFERENCES = Object.freeze({
    historyLimit: 100,
    searchEngine: "duckduckgo",
  });
  const SEARCH_ENGINES = {
    duckduckgo: "https://duckduckgo.com/",
    google: "https://www.google.com/search",
    bing: "https://www.bing.com/search",
  };
  const RESERVED_ALIAS_TARGETS = new Set([
    "alias",
    "aliases",
    "unalias",
    "history",
    "clear_history",
    "set",
  ]);
  const SELECTOR_COMPLETIONS = [
    "all",
    "active",
    "pinned",
    "audible",
    "duplicates",
    "twitch",
    "youtube",
    "domain:",
    "window:",
  ];
  const DESTINATION_COMPLETIONS = ["new_tab", "new_window", "current_window", "--confirm"];

  function canPersistState(privateContext, storage) {
    return !privateContext && Boolean(storage);
  }

  function normalizeHistory(value, limit = DEFAULT_PREFERENCES.historyLimit) {
    const maximum =
      Number.isInteger(limit) && limit >= 1 ? limit : DEFAULT_PREFERENCES.historyLimit;
    if (!Array.isArray(value)) return [];
    return value
      .filter((entry) => typeof entry === "string" && entry.length > 0 && entry.length <= 2000)
      .slice(-maximum);
  }

  function appendHistory(history, entry, limit = DEFAULT_PREFERENCES.historyLimit) {
    const next = normalizeHistory(history, limit);
    if (typeof entry !== "string" || !entry.trim()) return next;
    if (next.at(-1) !== entry) next.push(entry);
    return next.slice(-limit);
  }

  function isValidAliasName(name, commandNames = []) {
    const value = String(name || "").toLowerCase();
    return (
      /^[a-z][a-z0-9_-]{0,31}$/.test(value) &&
      !commandNames.includes(value) &&
      !RESERVED_ALIAS_TARGETS.has(value)
    );
  }

  function normalizeAliases(value, commandNames = []) {
    const aliases = Object.create(null);
    if (!value || typeof value !== "object" || Array.isArray(value)) return aliases;
    for (const [name, alias] of Object.entries(value)) {
      const command = alias?.command;
      if (
        !isValidAliasName(name, commandNames) ||
        !command ||
        typeof command !== "object" ||
        !commandNames.includes(command.name) ||
        RESERVED_ALIAS_TARGETS.has(command.name) ||
        !Array.isArray(command.args) ||
        !Array.isArray(command.destination) ||
        command.args.some((arg) => typeof arg !== "string" || arg.length > 256) ||
        command.destination.some((item) => typeof item !== "string" || item.length > 256)
      ) {
        continue;
      }
      aliases[name] = {
        command: {
          name: command.name,
          args: [...command.args],
          destination: [...command.destination],
        },
      };
    }
    return aliases;
  }

  function createAlias(name, command, commandNames = []) {
    const aliasName = String(name || "").toLowerCase();
    if (!isValidAliasName(aliasName, commandNames)) {
      throw new Error(
        "Alias names must be new command-like names and cannot shadow built-in commands.",
      );
    }
    if (
      !command ||
      !commandNames.includes(command.name) ||
      RESERVED_ALIAS_TARGETS.has(command.name) ||
      !Array.isArray(command.args) ||
      !Array.isArray(command.destination)
    ) {
      throw new Error("Aliases must target one implemented command with parsed arguments.");
    }
    return {
      command: {
        name: command.name,
        args: command.args.filter((arg) => typeof arg === "string").slice(0, 32),
        destination: command.destination.filter((item) => typeof item === "string").slice(0, 32),
      },
    };
  }

  function expandAlias(command, aliases = {}) {
    const alias = aliases[command.name];
    if (!alias) return command;
    return {
      ...command,
      name: alias.command.name,
      args: [...alias.command.args, ...command.args],
      destination: command.destination.length
        ? [...command.destination]
        : [...alias.command.destination],
    };
  }

  function normalizePreferences(value) {
    const preferences = value && typeof value === "object" ? value : {};
    return {
      historyLimit:
        Number.isInteger(preferences.historyLimit) &&
        preferences.historyLimit >= 10 &&
        preferences.historyLimit <= 500
          ? preferences.historyLimit
          : DEFAULT_PREFERENCES.historyLimit,
      searchEngine: Object.hasOwn(SEARCH_ENGINES, preferences.searchEngine)
        ? preferences.searchEngine
        : DEFAULT_PREFERENCES.searchEngine,
    };
  }

  function updatePreference(preferences, key, value) {
    const next = normalizePreferences(preferences);
    if (key === "history_limit") {
      const limit = Number(value);
      if (!Number.isInteger(limit) || limit < 10 || limit > 500) {
        throw new Error("history_limit must be an integer from 10 to 500.");
      }
      next.historyLimit = limit;
      return next;
    }
    if (key === "search_engine") {
      const engine = String(value || "").toLowerCase();
      if (!Object.hasOwn(SEARCH_ENGINES, engine)) {
        throw new Error("search_engine must be duckduckgo, google, or bing.");
      }
      next.searchEngine = engine;
      return next;
    }
    throw new Error("Supported preferences: history_limit and search_engine.");
  }

  function buildSearchUrl(query, engine = DEFAULT_PREFERENCES.searchEngine) {
    const base = SEARCH_ENGINES[engine];
    if (!base) throw new Error("Unsupported search engine.");
    const url = new URL(base);
    url.searchParams.set("q", String(query || ""));
    return url.href;
  }

  function completionCandidates(value, commandNames = [], aliases = {}) {
    const source = String(value || "")
      .trimStart()
      .replace(/^:/, "");
    const hasTrailingSpace = /\s$/.test(source);
    const parts = source.trim().split(/\s+/).filter(Boolean);
    const prefix = hasTrailingSpace ? "" : parts.at(-1) || "";
    let candidates;
    if (parts.length <= 1 && !hasTrailingSpace) {
      candidates = [...commandNames, ...Object.keys(aliases)];
    } else if (parts[0] === "alias" && parts.length >= 2) {
      candidates = commandNames;
    } else if (parts[0] === "set" && parts[1] === "search_engine") {
      candidates = Object.keys(SEARCH_ENGINES);
    } else if (parts[0] === "set" && parts.length <= 2) {
      candidates = ["history_limit", "search_engine"];
    } else if (["open", "search"].includes(parts[0])) {
      candidates = ["twitch", "youtube", "github", ...DESTINATION_COMPLETIONS];
    } else {
      candidates = [...SELECTOR_COMPLETIONS, ...DESTINATION_COMPLETIONS, ...Object.keys(aliases)];
    }
    return [...new Set(candidates)].filter((candidate) =>
      candidate.toLowerCase().startsWith(prefix.toLowerCase()),
    );
  }

  const api = {
    appendHistory,
    buildSearchUrl,
    canPersistState,
    completionCandidates,
    createAlias,
    expandAlias,
    isValidAliasName,
    normalizeAliases,
    normalizeHistory,
    normalizePreferences,
    updatePreference,
  };
  root.VimCommandState = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
