((root) => {
  const HOST_ALIASES = {
    twitch: ["twitch.tv"],
    youtube: ["youtube.com", "youtu.be"],
    audible: ["audible.com"],
  };

  function hostnameOf(tab) {
    if (typeof tab?.url !== "string") return "";
    try {
      return new URL(tab.url).hostname
        .toLowerCase()
        .replace(/\.$/, "")
        .replace(/^www\./, "");
    } catch {
      return "";
    }
  }

  function hostMatches(hostname, domain) {
    const normalizedHost = String(hostname || "")
      .toLowerCase()
      .replace(/\.$/, "");
    const normalizedDomain = String(domain || "")
      .toLowerCase()
      .replace(/^\*\./, "")
      .replace(/\.$/, "");
    return Boolean(
      normalizedHost &&
        normalizedDomain &&
        (normalizedHost === normalizedDomain || normalizedHost.endsWith(`.${normalizedDomain}`)),
    );
  }

  function canonicalUrl(tab) {
    if (typeof tab?.url !== "string") return "";
    try {
      const url = new URL(tab.url);
      url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
      url.hash = "";
      return url.href;
    } catch {
      return tab.url;
    }
  }

  function duplicateTabIds(tabs) {
    const groups = new Map();
    for (const tab of tabs) {
      const key = canonicalUrl(tab);
      if (!key) continue;
      const group = groups.get(key) || [];
      group.push(tab.id);
      groups.set(key, group);
    }
    return new Set([...groups.values()].filter((ids) => ids.length > 1).flat());
  }

  function selectTabs(tabs, selector = "all", options = {}) {
    const value = String(selector || "all")
      .trim()
      .toLowerCase();
    if (!value || value === "all") return [...tabs];
    if (value === "active") {
      return tabs.filter((tab) => tab.active && tab.windowId === options.currentWindowId);
    }
    if (value === "pinned") return tabs.filter((tab) => tab.pinned);
    if (value === "audible") return tabs.filter((tab) => tab.audible);
    if (value === "duplicates") {
      const ids = duplicateTabIds(tabs);
      return tabs.filter((tab) => ids.has(tab.id));
    }
    if (value.startsWith("domain:")) {
      const domain = value.slice("domain:".length).trim();
      if (!domain) throw new Error("A domain selector requires a hostname");
      return tabs.filter((tab) => hostMatches(hostnameOf(tab), domain));
    }
    if (Object.hasOwn(HOST_ALIASES, value)) {
      return tabs.filter((tab) =>
        HOST_ALIASES[value].some((domain) => hostMatches(hostnameOf(tab), domain)),
      );
    }
    if (value.startsWith("window:")) {
      const index = Number(value.slice("window:".length));
      if (!Number.isSafeInteger(index) || index < 1) {
        throw new Error("Window selectors use a positive window index, for example window:2");
      }
      const window = options.windows?.find((item) => item.index === index);
      if (!window) throw new Error(`No normal browser window at index ${index}`);
      return tabs.filter((tab) => tab.windowId === window.id);
    }
    throw new Error(`Unknown tab selector: ${selector}`);
  }

  const api = { canonicalUrl, duplicateTabIds, hostMatches, hostnameOf, selectTabs };
  root.VimTabSelectors = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
