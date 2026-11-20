# Accessibility smoke tests

The command prompt is exposed as a labelled modal dialog. The input has an accessible name, command output is a polite live log, and focus is returned to the previously active page element when the prompt closes.

## Automated regression coverage

The real-Firefox smoke suite runs in disposable profiles against Firefox 115.45.0 ESR and Firefox 159.0.1 Stable (both with geckodriver 0.37.1 in CI run [#153](https://github.com/mintymelinda/firefox_vim_controls/actions/runs/44816732952)). It checks:

- Keyboard activation and non-interference with editable controls.
- Dialog role and modal state, accessible dialog and input names, and the keyboard-hint description.
- Output log role and live-region attributes.
- Focus entering the prompt, remaining contained when page focus is moved, and returning to the previously focused element after dismissal.
- Output retention bounded to the newest 200 entries.
- A command round-trip through the background script.

These are browser-level DOM regression assertions. They do not validate the computed accessibility tree or actual screen-reader announcements, and must not be treated as a substitute for assistive-technology testing.

## Manual release checks

Before each release, perform these checks in Firefox with the intended screen reader and operating system:

- [ ] Confirm the dialog name, input label, hint text, and live output are actually announced.
- [ ] Press Enter on a command and confirm output is announced without stealing focus.
- [ ] Trigger multiple errors and confirm they are visually distinguishable and announced in the live output.
- [ ] Verify keyboard-only operation feels coherent, including repeated Tab completion and Escape dismissal.
- [ ] Confirm the prompt remains usable at the browser's supported zoom and text-size settings.

Record the Firefox version, screen reader and version, operating system, and result. Do not mark screen-reader verification complete based only on the automated DOM assertions.
