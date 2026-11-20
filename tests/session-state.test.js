const test = require("node:test");
const assert = require("node:assert/strict");
const state = require("../src/shared/session-state.js");

function snapshot() {
  return {
    capturedAt: 1000,
    windows: [
      {
        focused: true,
        tabs: [
          { url: "https://example.com/a", title: "A", pinned: false, active: true },
          { url: "https://example.com/b", title: "B", pinned: true, active: false },
          { url: "javascript:alert(1)", title: "Unsafe" },
          { url: "https://user:secret@example.com/", title: "Credentials" },
          { url: "about:config", title: "Internal" },
        ],
      },
    ],
  };
}

test("normalizes snapshots to bounded restorable HTTP(S) tabs", () => {
  const normalized = state.normalizeSnapshot(snapshot());
  assert.equal(normalized.windows.length, 1);
  assert.deepEqual(
    normalized.windows[0].tabs.map((tab) => tab.url),
    ["https://example.com/b", "https://example.com/a"],
  );
  assert.equal(normalized.windows[0].tabs[0].pinned, true);
  assert.equal(normalized.windows[0].tabs[1].active, true);
  assert.equal(state.normalizeSnapshot({ windows: [] }), null);
  assert.equal(state.normalizeUrl("javascript:alert(1)"), null);
  assert.equal(state.normalizeUrl("https://user:pass@example.com"), null);
});

test("captures normal-window metadata without retaining browser identifiers", () => {
  const captured = state.captureSnapshot([
    {
      id: 10,
      focused: true,
      tabs: [
        { id: 1, url: "https://example.com", title: "Example", active: true, pinned: false },
        { id: 2, url: "https://mozilla.org", title: "Mozilla", active: false, pinned: true },
        { id: 3, url: "moz-extension://abc/page.html", title: "Extension" },
      ],
    },
  ]);
  assert.deepEqual(captured.windows[0].tabs.map((tab) => tab.url), [
    "https://mozilla.org/",
    "https://example.com/",
  ]);
  assert.equal(Object.hasOwn(captured.windows[0], "id"), false);
  assert.equal(Object.hasOwn(captured.windows[0].tabs[0], "id"), false);
});

test("normalizes malformed collections and enforces collection limits", () => {
  const collection = state.normalizeCollection(
    {
      valid: { snapshot: snapshot(), updatedAt: 2000 },
      invalid: { snapshot: { windows: [] }, updatedAt: 2000 },
      "../bad": { snapshot: snapshot(), updatedAt: 2000 },
    },
    2,
  );
  assert.deepEqual(Object.keys(collection), ["valid"]);
  let saved = state.saveRecord({}, "work", snapshot(), 1);
  assert.deepEqual(Object.keys(saved), ["work"]);
  assert.throws(() => state.saveRecord(saved, "personal", snapshot(), 1), /limit of 1/);
  assert.throws(() => state.saveRecord({}, "bad name", snapshot(), 10), /Names must start/);
});

test("deletes and renames records with collision and missing-name checks", () => {
  const first = state.saveRecord({}, "work", snapshot(), 10);
  const second = state.saveRecord(first, "personal", snapshot(), 10);
  assert.deepEqual(Object.keys(state.renameRecord(second, "work", "office", 10)), [
    "personal",
    "office",
  ]);
  assert.throws(() => state.renameRecord(second, "work", "personal", 10), /already exists/);
  assert.throws(() => state.deleteRecord(second, "missing", 10), /does not exist/);
  assert.deepEqual(Object.keys(state.deleteRecord(second, "work", 10)), ["personal"]);
});

test("lists normalized records with tab and window counts", () => {
  const collection = state.saveRecord({}, "work", snapshot(), 10);
  assert.deepEqual(state.listRecords(collection, 10).map(({ name, windows, tabs }) => ({
    name,
    windows,
    tabs,
  })), [{ name: "work", windows: 1, tabs: 2 }]);
});

test("bounds snapshots by window and tab counts", () => {
  const windows = Array.from({ length: 30 }, (_, index) => ({
    focused: index === 0,
    tabs: Array.from({ length: 120 }, (_, tabIndex) => ({
      url: `https://example.com/${index}/${tabIndex}`,
      active: tabIndex === 0,
    })),
  }));
  const normalized = state.normalizeSnapshot({ windows });
  assert.equal(normalized.windows.length, state.LIMITS.windows);
  assert.equal(
    normalized.windows.reduce((count, window) => count + window.tabs.length, 0),
    state.LIMITS.totalTabs,
  );
});
