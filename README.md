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

Phase 1 command mode is implemented. Phase 2 includes read-only tab inspection and tab-changing commands. Window organization remains in Phase 3.

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

Selectors include `all`, `active`, `pinned`, `audible`, `duplicates`, `twitch`, `youtube`, `audible`, `domain:example.com`, and `window:2`. Domain matching includes subdomains but does not match lookalike suffixes such as `twitch.tv.evil.example`. Private windows are excluded from these commands.

Broad close, reload, and discard operations show a preview and require `--confirm`. The extension protects the last tab in each normal window when closing multiple tabs.

See [the complete plan](https://github.com/mintymelinda/firefox_vim_controls/issues/1) and [Phase 1–3 checklist](https://github.com/mintymelinda/firefox_vim_controls/issues/2).
