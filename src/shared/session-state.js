(function (root) {
  "use strict";

  const LIMITS = Object.freeze({
    sessions: 20,
    workspaces: 10,
    windows: 20,
    tabsPerWindow: 100,
    totalTabs: 500,
    nameLength: 40,
    urlLength: 4096,
    titleLength: 512,
    storageBytes: 8 * 1024 * 1024,
  });

  function normalizeName(value) {
    const name = String(value || "").trim();
    if (name.length > LIMITS.nameLength || !/^[a-z0-9][a-z0-9_-]*$/i.test(name)) {
      throw new Error(
        "Names must start with a letter or number and contain only letters, numbers, _ or - (up to 40 characters).",
      );
    }
    return name;
  }

  function normalizeUrl(value) {
    if (typeof value !== "string" || value.length > LIMITS.urlLength) return null;
    try {
      const url = new URL(value);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        !url.hostname ||
        url.username ||
        url.password
      ) {
        return null;
      }
      return url.href;
    } catch {
      return null;
    }
  }

  function normalizeSnapshot(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    if (!Array.isArray(value.windows)) return null;
    const windows = [];
    let remaining = LIMITS.totalTabs;
    for (const source of value.windows.slice(0, LIMITS.windows)) {
      if (!source || typeof source !== "object" || !Array.isArray(source.tabs)) continue;
      const tabs = [];
      for (const tab of source.tabs.slice(0, LIMITS.tabsPerWindow)) {
        if (remaining <= 0) break;
        const url = normalizeUrl(tab?.url);
        if (!url) continue;
        tabs.push({
          url,
          title: typeof tab?.title === "string" ? tab.title.slice(0, LIMITS.titleLength) : "",
          pinned: Boolean(tab.pinned),
          active: Boolean(tab.active),
        });
        remaining -= 1;
      }
      if (!tabs.length) continue;
      const activeIndex = tabs.findIndex((tab) => tab.active);
      const normalizedTabs = tabs.map((tab, index) => ({
        ...tab,
        active: activeIndex < 0 ? index === 0 : index === activeIndex,
      }));
      const pinned = normalizedTabs.filter((tab) => tab.pinned);
      const unpinned = normalizedTabs.filter((tab) => !tab.pinned);
      windows.push({
        focused: Boolean(source.focused),
        tabs: [...pinned, ...unpinned],
      });
    }
    if (!windows.length) return null;
    const focusedIndex = windows.findIndex((window) => window.focused);
    return {
      version: 1,
      capturedAt:
        Number.isFinite(value.capturedAt) && value.capturedAt > 0
          ? Math.floor(value.capturedAt)
          : Date.now(),
      windows: windows.map((window, index) => ({
        ...window,
        focused: focusedIndex < 0 ? index === 0 : index === focusedIndex,
      })),
    };
  }

  function captureSnapshot(windows) {
    return normalizeSnapshot({
      capturedAt: Date.now(),
      windows: windows.map((window) => ({
        focused: window.focused,
        tabs: window.tabs.map((tab) => ({
          url: tab.url,
          title: tab.title,
          pinned: tab.pinned,
          active: tab.active,
        })),
      })),
    });
  }

  function normalizeCollection(value, limit) {
    const collection = Object.create(null);
    if (!value || typeof value !== "object" || Array.isArray(value)) return collection;
    for (const [rawName, record] of Object.entries(value).slice(0, limit * 2)) {
      let name;
      try {
        name = normalizeName(rawName);
      } catch {
        continue;
      }
      const snapshot = normalizeSnapshot(record?.snapshot);
      if (!snapshot) continue;
      collection[name] = {
        snapshot,
        updatedAt:
          Number.isFinite(record.updatedAt) && record.updatedAt > 0
            ? Math.floor(record.updatedAt)
            : snapshot.capturedAt,
      };
      if (Object.keys(collection).length >= limit) break;
    }
    return collection;
  }

  function saveRecord(collection, name, snapshot, limit) {
    const key = normalizeName(name);
    const normalized = normalizeSnapshot(snapshot);
    if (!normalized) throw new Error("There are no restorable HTTP(S) tabs to save.");
    const next = { ...normalizeCollection(collection, limit) };
    if (!Object.hasOwn(next, key) && Object.keys(next).length >= limit) {
      throw new Error(`The limit of ${limit} saved records has been reached.`);
    }
    next[key] = { snapshot: normalized, updatedAt: Date.now() };
    return next;
  }

  function deleteRecord(collection, name, limit) {
    const key = normalizeName(name);
    const next = { ...normalizeCollection(collection, limit) };
    if (!Object.hasOwn(next, key)) throw new Error(`No saved record named "${key}" exists.`);
    delete next[key];
    return next;
  }

  function renameRecord(collection, oldName, newName, limit) {
    const oldKey = normalizeName(oldName);
    const newKey = normalizeName(newName);
    const next = { ...normalizeCollection(collection, limit) };
    if (!Object.hasOwn(next, oldKey)) throw new Error(`No saved record named "${oldKey}" exists.`);
    if (Object.hasOwn(next, newKey))
      throw new Error(`A saved record named "${newKey}" already exists.`);
    next[newKey] = next[oldKey];
    delete next[oldKey];
    return next;
  }

  function estimateStorageBytes(sessions, workspaces) {
    return (
      JSON.stringify({
        sessions: normalizeCollection(sessions, LIMITS.sessions),
        workspaces: normalizeCollection(workspaces, LIMITS.workspaces),
      }).length * 2
    );
  }

  function assertStorageBudget(sessions, workspaces) {
    const bytes = estimateStorageBytes(sessions, workspaces);
    if (bytes > LIMITS.storageBytes) {
      throw new Error("Saved sessions and workspaces would exceed the 8 MiB local storage budget.");
    }
    return bytes;
  }

  function listRecords(collection, limit) {
    return Object.entries(normalizeCollection(collection, limit))
      .map(([name, record]) => ({
        name,
        windows: record.snapshot.windows.length,
        tabs: record.snapshot.windows.reduce((count, window) => count + window.tabs.length, 0),
        updatedAt: record.updatedAt,
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  const api = {
    LIMITS,
    assertStorageBudget,
    captureSnapshot,
    deleteRecord,
    estimateStorageBytes,
    listRecords,
    normalizeCollection,
    normalizeName,
    normalizeSnapshot,
    normalizeUrl,
    renameRecord,
    saveRecord,
  };
  root.VimSessionState = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
