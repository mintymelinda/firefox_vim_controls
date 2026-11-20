const test = require("node:test");
const assert = require("node:assert/strict");
const {
  canonicalUrl,
  duplicateTabIds,
  hostMatches,
  hostnameOf,
  selectTabs,
} = require("../src/shared/selectors.js");

const tabs = [
  { id: 1, url: "https://www.twitch.tv/streamer", windowId: 10, active: true },
  { id: 2, url: "https://clips.twitch.tv/clip", windowId: 10 },
  { id: 3, url: "https://www.youtube.com/watch?v=abc", windowId: 11 },
  { id: 4, url: "https://youtube.com/watch?v=abc#comments", windowId: 11 },
  { id: 5, url: "https://twitch.tv.evil.example/path", windowId: 11 },
  { id: 6, url: "https://www.audible.com/library", windowId: 12, audible: true },
];

test("matches exact hosts and subdomains without suffix spoofing", () => {
  assert.equal(hostMatches("clips.twitch.tv", "twitch.tv"), true);
  assert.equal(hostMatches("twitch.tv.evil.example", "twitch.tv"), false);
  assert.equal(hostMatches("not-twitch.tv", "twitch.tv"), false);
});

test("extracts hostnames and normalizes URL fragments for duplicate checks", () => {
  assert.equal(hostnameOf(tabs[0]), "twitch.tv");
  assert.equal(canonicalUrl(tabs[2]), canonicalUrl(tabs[3]));
  assert.deepEqual([...duplicateTabIds(tabs)], [3, 4]);
});

test("supports service aliases and common tab-state selectors", () => {
  assert.deepEqual(
    selectTabs(tabs, "twitch").map((tab) => tab.id),
    [1, 2],
  );
  assert.deepEqual(
    selectTabs(tabs, "youtube").map((tab) => tab.id),
    [3, 4],
  );
  assert.deepEqual(
    selectTabs(tabs, "audible").map((tab) => tab.id),
    [6],
  );
  assert.deepEqual(
    selectTabs(tabs, "pinned").map((tab) => tab.id),
    [],
  );
  assert.deepEqual(
    selectTabs(tabs, "duplicates").map((tab) => tab.id),
    [3, 4],
  );
});

test("supports domain and explicit window selectors", () => {
  assert.deepEqual(
    selectTabs(tabs, "domain:twitch.tv").map((tab) => tab.id),
    [1, 2],
  );
  assert.deepEqual(
    selectTabs(tabs, "window:2", {
      windows: [
        { id: 10, index: 1 },
        { id: 11, index: 2 },
      ],
    }).map((tab) => tab.id),
    [3, 4, 5],
  );
});

test("rejects invalid or unknown selectors", () => {
  assert.throws(() => selectTabs(tabs, "domain:"), /requires a hostname/);
  assert.throws(() => selectTabs(tabs, "window:0"), /positive window index/);
  assert.throws(() => selectTabs(tabs, "window:9", { windows: [] }), /No normal browser window/);
  assert.throws(() => selectTabs(tabs, "private"), /Unknown tab selector/);
});

test("selects tabs currently loading", () => {
  const tabs = [
    { id: 1, url: "https://example.com", status: "loading" },
    { id: 2, url: "https://twitch.tv", status: "complete" },
    { id: 3, url: "https://youtube.com", status: "loading" },
  ];
  assert.deepEqual(
    selectTabs(tabs, "loading").map((tab) => tab.id),
    [1, 3],
  );
});

test("selects other, left, and right relative to the active tab in its window", () => {
  const relativeTabs = [
    { id: 1, windowId: 10, index: 1, active: true },
    { id: 2, windowId: 10, index: 0 },
    { id: 3, windowId: 10, index: 2 },
    { id: 4, windowId: 11, index: 0 },
  ];
  assert.deepEqual(
    selectTabs(relativeTabs, "other", { currentWindowId: 10 }).map((tab) => tab.id),
    [2, 3],
  );
  assert.deepEqual(
    selectTabs(relativeTabs, "left", { currentWindowId: 10 }).map((tab) => tab.id),
    [2],
  );
  assert.deepEqual(
    selectTabs(relativeTabs, "right", { currentWindowId: 10 }).map((tab) => tab.id),
    [3],
  );
  assert.throws(
    () => selectTabs(relativeTabs, "left"),
    /Relative selectors require a focused normal browser window/,
  );
});

test("selects blank and discarded tabs without treating ordinary pages as empty", () => {
  const cleanupTabs = [
    { id: 1, url: "about:blank" },
    { id: 2, url: "about:newtab" },
    { id: 3, url: "" },
    { id: 4, url: "https://example.com", discarded: true },
    { id: 5, url: "https://example.net", discarded: false },
  ];
  assert.deepEqual(
    selectTabs(cleanupTabs, "empty").map((tab) => tab.id),
    [1, 2, 3],
  );
  assert.deepEqual(
    selectTabs(cleanupTabs, "discarded").map((tab) => tab.id),
    [4],
  );
});

test("selects one-based numeric and tab:N positions in the focused normal window", () => {
  const numericTabs = [
    { id: 3, windowId: 10, index: 0 },
    { id: 99, windowId: 10, index: 1 },
    { id: 5, windowId: 10, index: 2 },
    { id: 4, windowId: 11, index: 1 },
  ];
  assert.deepEqual(
    selectTabs(numericTabs, "2", { currentWindowId: 10 }).map((tab) => tab.id),
    [99],
  );
  assert.deepEqual(
    selectTabs(numericTabs, "tab:3", { currentWindowId: 10 }).map((tab) => tab.id),
    [5],
  );
  assert.deepEqual(selectTabs(numericTabs, "4", { currentWindowId: 10 }), []);
  assert.deepEqual(selectTabs(numericTabs, "tab:abc", { currentWindowId: 10 }), []);
  assert.throws(
    () => selectTabs(numericTabs, "0", { currentWindowId: 10 }),
    /one-based positive integers/,
  );
  assert.throws(() => selectTabs(numericTabs, "2"), /focused normal browser window/);
});
