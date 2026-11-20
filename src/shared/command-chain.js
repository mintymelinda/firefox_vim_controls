(function (root) {
  "use strict";

  async function executeChain(commands, execute) {
    if (!Array.isArray(commands) || typeof execute !== "function") {
      throw new Error("A command list and executor are required.");
    }
    const results = [];
    for (const command of commands) {
      const result = await execute(command);
      results.push({ command, result });
      if (result?.ok === false || result?.requiresConfirmation) break;
    }
    return results;
  }

  const api = { executeChain };
  root.VimCommandChain = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
