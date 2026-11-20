# Firefox Vim Controls

A keyboard-driven command interface for Firefox tab and window management.

## Development

The project uses Node.js 22 and a Dockerized toolchain. The same Compose service runs local validation and GitHub Actions.

```sh
docker compose build
docker compose run --rm app npm run check
docker compose run --rm app npm run format
```

The image pins Node and Biome versions. `npm ci` uses the committed lockfile. Do not install project dependencies on the host.

## Current status

Phases 1–5 are implemented on the current feature line: command mode, tab/window management, navigation, search, persistent command history, aliases, and preferences. Phase 6 adds local sessions and named workspaces.

## Keyboard behaviour

- Press `:` outside editable page controls to open the command prompt.
- Press `Escape` while editing to leave the editable control, then press `:`.
- Press `Enter` to run a command, `Tab` to complete, `↑/↓` to browse history, and `Escape` to close the prompt.

Content scripts cannot run on Firefox internal pages or capture browser-chrome keystrokes. This extension operates on ordinary web pages.

## Commands currently available

- `:help` — show implemented commands and planned command examples.
- `:version` — show extension version.
- `:clear` — clear the prompt output.
- `:tabs [selector]` — list matching tabs.
- `:count [selector]` — count matching tabs.
- `:current` — show the active tab in the focused normal window.
- `:domains [selector]` — list hostnames represented by matching tabs.
- `:duplicates` — list tabs sharing the same URL (ignoring URL fragments and leading `www.`).
- `:close [selector] [--confirm]` — close matching tabs; closing multiple tabs requires a preview and explicit confirmation.
- `:move [selector], new_window|current_window|window 2` — move matching tabs to another window.
- `:reload [selector] [--confirm]` — reload matching tabs; reloading multiple tabs requires confirmation.
- `:mute [selector]` / `:unmute [selector]` — change tab audio state.
- `:pin [selector]` / `:unpin [selector]` — pin or unpin matching tabs.
- `:discard [selector] [--confirm]` — unload inactive matching tabs; active tabs are skipped.
- `:open URL|shortcut [, new_tab|new_window]` — navigate the focused tab or open a destination in a new tab/window. Supports `twitch`, `youtube`, and `github` shortcuts.
- `:search terms [, new_tab|new_window]` — search using the selected engine (DuckDuckGo by default) from the focused tab or a new tab/window.
- `:back [selector]` / `:forward [selector]` — navigate matching tabs through their history; defaults to the active tab.
- `:refresh [selector] [--confirm]` — refresh matching tabs; defaults to the active tab and previews multi-tab refreshes.
- `:home` — navigate the active tab to Firefox's `about:home` page.
- `:history [count]` / `:clear_history` — inspect or clear saved command history.
- `:alias name command [arguments] [, destination]` — save a structured alias, for example `:alias stream move twitch, new_window`.
- `:aliases` / `:unalias name` — list or remove aliases.
- `:set history_limit 100` — retain 10–500 commands (default 100).
- `:set search_engine duckduckgo|google|bing` — choose the engine used by `:search` (default DuckDuckGo).
- `:session save name` — save the current normal-window layout as a named session.
- `:session load name` — restore a saved session into new normal windows without closing current tabs.
- `:session append name` — append a saved session's tabs to the focused normal window.
- `:session list` / `:session delete name` — list or delete saved sessions.
- `:session restore` — restore the most recently saved session.
- `:workspace create name` — save the current normal-window layout as a workspace.
- `:workspace switch name` — open a workspace in new normal window(s), leaving existing windows untouched.
- `:workspace list` / `:workspace rename old new` — list or rename saved workspaces.

- `:macro define name && command [&& command ...]` — save a bounded sequence of parsed commands.
- `:macro run name` — expand and execute a saved macro through the normal command pipeline.
- `:macro list` / `:macro delete name` — list or remove macros.
- `:undo` — reverse the last supported move, merge/split, ordering, pin, unpin, mute, or unmute operation.

Command chains separated by `&&` execute sequentially and stop at the first error. Confirmation previews stop a chain; rerun the previewed operation separately with `--confirm`. Macros contain parsed, registered commands only (no arbitrary code, nested macros, or undo commands). Macros are stored in the normal browser profile and are unavailable in private browsing. Undo is bounded to the most recent 20 reversible operations in the current background session and is cleared by irreversible navigation, close, reload, discard, session/workspace, and window-state operations. Closing tabs and reloading pages cannot be undone.

Sessions and workspaces are local snapshots of HTTP(S) tabs only. They preserve window grouping, tab order, pinned state, and the active tab. Firefox internal pages, extension pages, blank tabs, and URLs with embedded credentials are excluded. Each collection is bounded (20 sessions, 10 workspaces, up to 20 windows and 300 tabs per snapshot), with an 8 MiB aggregate storage budget. Private-window commands are rejected and private tabs are never saved.

Command history, aliases, and preferences are stored locally with Firefox extension storage. They are kept in memory only in private browsing contexts and are never written to persistent storage there. Tab completion includes command names, aliases, selectors, destinations, and preference values.
- `:stop` remains planned: Firefox WebExtensions does not expose a reliable stop-loading method without injecting page script.
- `:windows` — list normal browser windows and their active tabs.
- `:window 2|next|previous` — focus a numbered or adjacent normal window.
- `:new_window` — create a new normal browser window.
- `:fullscreen`, `:minimize`, `:maximize` — change the focused window state.
- `:merge [window-number]` — merge all other normal windows, or one numbered window, into the focused window.
- `:split [selector]` — move matching tabs into a new window.
- `:sort domain|title|url|recent [selector]` — sort matching tabs within each window.
- `:reverse [selector]` / `:shuffle [selector]` — reorder matching tabs within each window. Pinned and unpinned tabs are reordered separately.

Selectors include `all`, `active`, `pinned`, `audible`, `duplicates`, `twitch`, `youtube`, `audible`, `domain:example.com`, and `window:2`. Domain matching includes subdomains but does not match lookalike suffixes such as `twitch.tv.evil.example`. Private windows are excluded from these commands.

Broad close, reload, and discard operations show a preview and require `--confirm`. The extension protects the last tab in each normal window when closing multiple tabs.

See [the complete plan](https://github.com/mintymelinda/firefox_vim_controls/issues/1) and [Phase 1–3 checklist](https://github.com/mintymelinda/firefox_vim_controls/issues/2).
