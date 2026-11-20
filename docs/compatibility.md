# Firefox compatibility

## Declared support

| Item | Declaration |
|---|---|
| Browser | Mozilla Firefox desktop |
| Minimum version | Firefox 115.0 |
| Manifest | Manifest V2 |
| Background model | Persistent background scripts |
| APIs used | `browser.tabs`, `browser.windows`, `browser.storage.local`, `browser.runtime`, `browser.i18n` |
| Other browsers | Not supported or tested |

The minimum version is declared in `manifest.json` under `browser_specific_settings.gecko.strict_min_version`. The extension intentionally uses Firefox's WebExtension API model and does not assume Chromium service-worker behavior.

## Automated verification matrix

The Docker/Compose CI workflow runs formatting, lint, unit tests, build, deterministic ZIP packaging, and the same real-Firefox smoke suite against two pinned browser targets. Each browser runs with a disposable Selenium profile. In addition to prompt activation/accessibility/focus/output checks, the browser suite exercises tab creation, pinning and undo, then moves a selected domain into a new window while verifying a different-domain tab remains in its original window. Node tests separately verify that private sender contexts cannot read or mutate persisted state and that private tabs are excluded from session/workspace snapshots.

The following exact versions passed CI run [#153](https://github.com/mintymelinda/firefox_vim_controls/actions/runs/44816732952) on 2026-11-20:

| Browser target | Support intent | Verified browser version | WebDriver version | Verification |
|---|---|---:|---:|---|
| Firefox ESR | Minimum supported baseline | 115.45.0 | geckodriver 0.37.1 | Automated smoke suite passed |
| Firefox Stable | Primary target | 159.0.1 | geckodriver 0.37.1 | Automated smoke suite passed |
| Firefox Beta | Early compatibility signal | — | — | Not currently automated; optional manual check |
| Firefox Android | Not in scope | — | — | Not tested |
| Chromium-based browsers | Not supported | — | — | Not tested |

These are pinned, point-in-time CI results. They verify the tested Firefox 115.45.0 ESR and 159.0.1 Stable builds; they do not establish that every intervening or future Firefox release has been tested. The minimum manifest declaration remains Firefox 115.0.

The browser fixture is a representative regression suite, not a full end-to-end certification of every command or browser surface. Private-context tests exercise the extension's background message boundary with incognito sender metadata; they do not launch a real private Firefox window or verify the user's private-browsing permission setting. The release checklist still requires manual verification of privileged Firefox pages, the complete command catalogue, private-window behavior in the installed release, and real screen-reader behavior. DOM assertions do not prove what assistive technology announces.

## Known platform boundaries

- Content scripts do not run on Firefox internal pages, extension pages, or other restricted browser surfaces.
- A content script cannot intercept browser-chrome keystrokes; command activation works only while an eligible web page has focus.
- The extension uses Manifest V2 background scripts, not Chromium Manifest V3 service workers.
- Private browsing requires the user to permit the extension to run in private windows. Private windows are excluded from normal-window operations; sessions, workspaces, macros, and undo are disabled in private contexts.
- The `tabs` and `storage` permissions are required for tab metadata/actions and local persistence. No network, account, analytics, or telemetry permission is requested.

## Remaining manual release checks

- [ ] Verify Firefox internal pages (for example `about:addons`) are not modified. WebDriver cannot directly navigate to these privileged pages.
- [ ] Run the full tab, window, navigation, session, macro, and undo workflows in the release build; automation covers representative paths only.
- [ ] Verify a real private window remains isolated and behaves according to the user's private-browsing permission.
- [ ] Verify keyboard-only use and actual announcements with a screen reader.
- [ ] Repeat the focused smoke checks on the AMO-signed artifact in the release channel when preparing a production release.
