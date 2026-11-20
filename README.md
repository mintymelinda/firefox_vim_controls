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

Phase 1 is in progress. The initial release implements command-mode activation, prompt UI, command parsing, help/version, command history, and basic completion. Browser-wide tab operations are planned for Phase 2.

## Keyboard behaviour

- Press `:` outside editable page controls to open the command prompt.
- Press `Escape` while editing to leave the editable control, then press `:`.
- Press `Enter` to run a command, `Tab` to complete, `↑/↓` to browse history, and `Escape` to close the prompt.

Content scripts cannot run on Firefox internal pages or capture browser-chrome keystrokes. This extension operates on ordinary web pages.

## Commands currently available

- `:help` — show implemented commands and planned command examples.
- `:version` — show extension version.
- `:clear` — clear the prompt output.
- `:close` — recognized by the parser but not executed until Phase 2.

See [the complete plan](https://github.com/mintymelinda/firefox_vim_controls/issues/1) and [Phase 1–3 checklist](https://github.com/mintymelinda/firefox_vim_controls/issues/2).
