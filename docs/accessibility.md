# Accessibility smoke tests

The command prompt is exposed as a labelled modal dialog. The input has an accessible name, command output is a polite live log, and focus is returned to the previously active page element when the prompt closes.

Before each release, perform these manual checks in Firefox:

- [ ] Open the prompt while focus is on a normal page element; confirm focus moves to the command input.
- [ ] Use a screen reader to confirm the dialog name, input label, hint text, and live output are announced.
- [ ] Press Tab repeatedly; Tab should complete commands without moving focus behind the dialog.
- [ ] Press Enter on a command and confirm output is announced without stealing focus.
- [ ] Press Escape and confirm the prompt closes and focus returns to the element that was active before opening.
- [ ] Trigger multiple errors and confirm they are visually distinguishable and announced in the live output.
- [ ] Confirm output remains bounded to the newest 200 lines.
- [ ] Verify the prompt does not intercept ordinary typing in inputs, textareas, or contenteditable regions.

The real-Firefox smoke suite also asserts the prompt's dialog role and modal state, accessible
dialog/input names, the keyboard-hint description, and the output log's live-region semantics. It
exercises keyboard activation, focus entry, focus containment, focus restoration, and the 200-entry
output bound in the browser. These are DOM-level regression checks; they do not validate the
computed accessibility tree or actual screen-reader announcements. Manual browser and screen-reader
testing remains required before release.
