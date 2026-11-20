# Release and AMO packaging

## Build and validate

Use the repository's Docker/Compose toolchain so local validation matches CI:

```sh
docker compose build app
docker compose run --rm app npm run check
```

The aggregate check runs formatting, lint, all Node tests, the unpacked extension build, and deterministic ZIP packaging. The package script validates the manifest and every referenced background/content script plus the default locale before writing the archive.

The distributable is written to:

`artifacts/firefox-vim-controls-<manifest-version>.zip`

The ZIP is an upload artifact; it is not AMO-signed by this repository.

## Versioning

For a release:
1. Update `manifest.json` `version`.
2. Update `package.json` `version` to the same value.
3. Update the README/release notes for user-visible changes.
4. Run the complete Docker/Compose check.
5. Review the ZIP contents and confirm the manifest version and required locale/scripts are present.
6. Record the Firefox Stable version used for the manual smoke test.

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
- [ ] CI formatter, lint, tests, build, and package checks pass.
- [ ] Compatibility smoke tests are recorded for the minimum baseline and current Stable.
- [ ] Accessibility smoke test is recorded.
- [ ] ZIP manifest, referenced scripts, and locale validate.
- [ ] AMO validation/review is complete.
- [ ] The signed AMO artifact, not the unsigned local ZIP, is distributed.
- [ ] Release notes and compatibility matrix are updated.
