const test = require("node:test");
const assert = require("node:assert/strict");
const {
  canonicalUrl,
  duplicateTabIds,
  hostMatches,
  hostnameOf,
  hostnamePrefixMatches,
  selectTabs,
} = require("../src/shared/selectors.js");

const tabs = [
  { id: 1, url: "https://www.twitch.tv/streamer", windowId: 10, active: true },
  { id: 2, url: "https://clips.twitch.tv/clip", windowId: 10 },
  { id: 3, url: "https://www.youtube.com/watch?v=abc", windowId: 11 },
  { id: 4, url: "https://youtube.com/watch?v=abc#comments", windowId: 11 },
  { id: 5, url: "https://twitch.tv.evil.example/path", windowId: 11 },
  { id: 6, url: "https://www.audible.com/library", windowId: 12, audible: true },
  { id: 7, url: "https://mail.google.com/mail/u/0/#inbox", windowId: 12 },
  { id: 8, url: "https://mail.apple.com/", windowId: 12 },
  { id: 9, url: "https://gmail.com/", windowId: 12 },
  { id: 10, url: "https://synth.bigstorageparty.synology.me/", windowId: 12 },
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

test("matches hostname selectors from the leftmost label without domain-specific rules", () => {
  assert.equal(hostnamePrefixMatches("mail.google.com", "mail"), true);
  assert.equal(hostnamePrefixMatches("mail.apple.com", "mail"), true);
  assert.equal(hostnamePrefixMatches("mail.google.com", "mail.google"), true);
  assert.equal(hostnamePrefixMatches("mail.google.co.uk", "mail.google"), true);
  assert.equal(hostnamePrefixMatches("mail.google.com", "google"), false);
  assert.equal(hostnamePrefixMatches("mail.google.com", "google.com"), false);
  assert.equal(hostnamePrefixMatches("google.com", "google.com"), true);
  assert.equal(hostnamePrefixMatches("synth.bigstorageparty.synology.me", "synth"), true);
  assert.equal(
    hostnamePrefixMatches("synth.bigstorageparty.synology.me", "synth.big"),
    true,
  );
  assert.equal(hostnamePrefixMatches("gmail.com", "mail"), false);
  assert.equal(hostnamePrefixMatches("mail.google.com", "ma"), true);
});

test("selects every tab matching a left-to-right hostname prefix", () => {
  assert.deepEqual(
    selectTabs(tabs, "mail").map((tab) => tab.id),
    [7, 8],
  );
  assert.deepEqual(
    selectTabs(tabs, "mail.google").map((tab) => tab.id),
    [7],
  );
  assert.deepEqual(
    selectTabs(tabs, "google.com").map((tab) => tab.id),
    [],
  );
  assert.deepEqual(
    selectTabs(tabs, "synth").map((tab) => tab.id),
    [10],
  );
  assert.deepEqual(
    selectTabs(tabs, "twitch").map((tab) => tab.id),
    [1],
  );
});

test("supports common tab-state selectors and explicit window selectors", () => {
  assert.deepEqual(
    selectTabs(tabs, "active", { currentWindowId: 10 }).map((tab) => tab.id),
    [1],
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

test("rejects invalid window selectors and returns no tabs for unmatched hostname prefixes", () => {
  assert.throws(() => selectTabs(tabs, "window:0"), /positive window index/);
  assert.throws(() => selectTabs(tabs, "window:9", { windows: [] }), /No normal browser window/);
  assert.deepEqual(selectTabs(tabs, "private"), []);
});
