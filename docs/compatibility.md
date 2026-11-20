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

## Verification matrix

The default Docker/Compose workflow validates JavaScript formatting, lint, unit tests, build, and ZIP packaging. A separate Docker/Compose browser-test service launches real Firefox through Selenium WebDriver and exercises the extension on a local fixture page, including the `about:blank` injection boundary. WebDriver blocks direct navigation to Firefox internal pages such as `about:addons`, so that internal-page check remains a manual release check. The automated suite currently covers the pinned current Firefox image; it does not replace the Firefox 115 ESR release smoke test or screen-reader testing.

| Browser target | Support intent | Verification status |
|---|---|---|
| Firefox 115 ESR | Minimum supported baseline | Manual smoke test required before release |
| Latest Firefox Stable | Primary target | Automated smoke tests in Docker/Compose; manual release smoke test still required |
| Latest Firefox Beta | Early compatibility signal | Optional manual smoke test |
| Firefox Android | Not in scope | Not tested |
| Chromium-based browsers | Not supported | Not tested |

Record the exact browser version, operating system, test date, and result when completing a manual test. Update this matrix only with actual evidence.

## Known platform boundaries

- Content scripts do not run on Firefox internal pages, extension pages, or other restricted browser surfaces.
- A content script cannot intercept browser-chrome keystrokes; command activation works only while an eligible web page has focus.
- The extension uses Manifest V2 background scripts, not Chromium Manifest V3 service workers.
- Private browsing requires the user to permit the extension to run in private windows. Private windows are excluded from normal-window operations; sessions, workspaces, macros, and undo are disabled in private contexts.
- The `tabs` and `storage` permissions are required for tab metadata/actions and local persistence. No network, account, analytics, or telemetry permission is requested.

## Manual smoke-test checklist

- [ ] Install the unpacked build in Firefox 115 ESR and the current Stable release.
- [ ] Open/close the command prompt on an ordinary HTTP(S) page.
- [ ] Verify editable controls retain normal typing and Escape-then-colon activation works.
- [ ] Run tab listing, move, pin/mute, navigation, session, macro, and undo commands.
- [ ] Verify internal pages are not modified and private-window operations remain isolated.
- [ ] Verify the command prompt remains usable with keyboard-only navigation and a screen reader.
