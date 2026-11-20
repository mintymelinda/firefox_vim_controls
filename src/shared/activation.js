(function (root) {
  "use strict";

  function isEditableTarget(target) {
    if (!target || typeof target !== "object") return false;
    const element = target.closest?.(
      "input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox']",
    );
    return Boolean(element);
  }

  function shouldOpenCommandMode(event) {
    return (
      event.key === ":" &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !event.isComposing &&
      !isEditableTarget(event.target)
    );
  }

  const api = { isEditableTarget, shouldOpenCommandMode };
  root.VimCommandActivation = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
