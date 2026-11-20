(function (root) {
  "use strict";

  function trimOutput(container, limit = 200) {
    if (!container || !Number.isInteger(limit) || limit < 0) return;
    while (container.childElementCount > limit) {
      const first = container.firstElementChild;
      if (!first) break;
      container.removeChild(first);
    }
  }

  const api = { trimOutput };
  root.VimPromptOutput = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
