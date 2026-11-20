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

The ZIP is an upload artifact; it is not AMO-signed by this repository's normal CI workflow.

## Mozilla-signed self-distributed release

The repository includes [the Mozilla-signed release workflow](../.github/workflows/mozilla-signed-release.yml). It submits the built extension to Mozilla Add-ons (AMO) for **unlisted signing** and publishes the returned signed `.xpi` as a GitHub Actions artifact. Unlisted signing is intended for self-distribution: it signs the add-on without creating a public AMO listing.

### One-time setup

1. Sign in to the [AMO Developer Hub](https://addons.mozilla.org/developers/).
2. Open the [API credentials page](https://addons.mozilla.org/developers/addon/api/key/). Generate personal API credentials for the account that owns the add-on.
3. In the GitHub repository, open **Settings → Secrets and variables → Actions**.
4. Add these repository secrets:
   - `AMO_API_KEY`: the AMO JWT issuer / API key.
   - `AMO_API_SECRET`: the AMO JWT secret. Treat this as a password; never commit it or print it in workflow logs.

The signing job fails early with a clear message if either secret is missing. Credentials are only exposed to the signing steps, not to pull-request CI.

### Run a signed release

A signed release can be started in either of these ways:

- Push a version tag matching the manifest, such as `v0.1.0`.
- In GitHub, open **Actions → Mozilla-signed release → Run workflow**, selecting the `main` branch.

The workflow checks that `manifest.json` and `package.json` versions match, and that a pushed tag exactly matches that version. It then runs the project's complete formatting, lint, unit-test, build, and package checks before submitting the unpacked build to AMO with the `unlisted` channel. The workflow pins Mozilla's `web-ext` signing client to version `10.8.0`.

On success, download the artifact named `firefox-vim-controls-<ref>-mozilla-signed` from the completed workflow run. It contains both the unsigned ZIP for traceability and the Mozilla-signed `.xpi`. Distribute/install the signed `.xpi`, not the unsigned ZIP. The XPI is produced by Mozilla; the workflow does not fabricate or relabel the unsigned ZIP as signed.

AMO performs its own automated validation and may require additional review. A successful workflow means Mozilla returned a signed XPI; it does not mean this add-on is publicly listed on AMO. A public AMO listing is a separate release path and requires a listed submission plus the listing metadata and review process.

### Signed release checklist

- [ ] AMO API credentials are created for the add-on owner.
- [ ] `AMO_API_KEY` and `AMO_API_SECRET` are configured as GitHub Actions repository secrets.
- [ ] Manifest and package versions match.
- [ ] The release tag matches the manifest version, if using a tag.
- [ ] Project validation and both real-Firefox smoke suites pass.
- [ ] AMO signing succeeds and the workflow produces exactly one `.xpi`.
- [ ] The signed `.xpi` is downloaded and tested in a clean Firefox profile.
- [ ] Manual compatibility, private-window, privileged-page, and accessibility checks are recorded.
- [ ] Only the signed `.xpi` is distributed.

## Versioning

For a release:
1. Update `manifest.json` `version`.
2. Update `package.json` `version` to the same value.
3. Update the README/release notes for user-visible changes.
4. Run the complete Docker/Compose check and both browser smoke suites.
5. Review the ZIP contents and confirm the manifest version and required locale/scripts are present.
6. Record any additional manual compatibility and accessibility checks performed against the release candidate.
7. Use a new version for each AMO submission. Do not reuse a previously submitted version.

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
