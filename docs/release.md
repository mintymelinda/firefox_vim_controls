# Release and AMO packaging

## Build and validate

Use the repository's Docker/Compose toolchain so local validation matches CI:

```sh
docker compose build app browser-tests browser-tests-115 fixture firefox firefox-115
docker compose run --rm app npm run check
docker compose run --rm browser-tests npm run test:browser
docker compose run --rm browser-tests-115 npm run test:browser
```

The aggregate check runs formatting, lint, all Node tests, the unpacked extension build, and deterministic ZIP packaging. The two browser-test commands run the same real-Firefox smoke suite against current Stable and the pinned Firefox 115 ESR image, each in a disposable Selenium profile. CI runs these checks for pull requests.

The CI browser versions verified on 2026-11-20 were Firefox 159.0.1 Stable and Firefox 115.45.0 ESR, both with geckodriver 0.37.1 ([run #153](https://github.com/mintymelinda/firefox_vim_controls/actions/runs/44816732952)). These are point-in-time test versions, not a claim that all Firefox releases are covered.

The browser suite covers prompt activation, editable-control safety, DOM-level accessibility semantics, focus behavior, bounded output, tab creation/pinning/undo, and a cross-window move that preserves an unrelated-domain tab. Node tests exercise private-sender message handling, including state and macro storage access, and prove private tab URLs/titles are excluded from saved snapshots. These tests do not launch a real private Firefox window. Privileged Firefox UI, the full command catalogue, installed-release private-window behavior, and real screen-reader announcements remain manual checks; see [compatibility](compatibility.md) and [accessibility](accessibility.md).

The distributable is written to:

`artifacts/firefox-vim-controls-<manifest-version>.zip`

The ZIP is an upload artifact; it is not AMO-signed by this repository.

## Versioning

For a release:
1. Update `manifest.json` `version`.
2. Update `package.json` `version` to the same value.
3. Update the README/release notes for user-visible changes.
4. Run the complete Docker/Compose check and both browser smoke suites.
5. Review the ZIP contents and confirm the manifest version and required locale/scripts are present.
6. Record any additional manual compatibility and accessibility checks performed against the release candidate.

Use a new version for each AMO submission. Do not reuse a previously submitted version.

## AMO submission and signing

1. Sign in to the Mozilla Add-ons Developer Hub.
2. Submit the generated ZIP as a new version or update to the existing add-on.
3. Follow AMO's validation and review feedback; repository package validation does not replace AMO's own checks.
4. Distribute the signed artifact provided by AMO.
5. Verify the signed version installs and runs in the supported Firefox channel.

Do not describe the locally generated ZIP as signed. AMO performs the production signing step.

## Temporary local installation

For development, load the unpacked `dist/` directory through Firefox's `about:debugging#/runtime/this-firefox` page using **Load Temporary Add-on** and select `dist/manifest.json`. Temporary installation is for testing and is not a substitute for AMO distribution.

## Release checklist

- [ ] Version numbers are synchronized.
- [ ] CI formatter, lint, unit tests, build, and package checks pass.
- [ ] CI real-browser smoke tests pass on Firefox 115 ESR and current Stable.
- [ ] Full command workflows and real private-window isolation are manually checked on the release candidate (automated coverage is representative and message-boundary focused).
- [ ] Privileged internal-page boundaries are manually checked.
- [ ] Screen-reader and keyboard accessibility checks are recorded with browser/AT versions.
- [ ] ZIP manifest, referenced scripts, and locale validate.
- [ ] AMO validation/review is complete.
- [ ] The signed AMO artifact, not the unsigned local ZIP, is distributed.
- [ ] Release notes and compatibility matrix are updated with evidence from the release candidate.
