(function (root) {
  "use strict";

  function distance(left, right) {
    const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
    for (let row = 1; row <= left.length; row += 1) {
      let diagonal = previous[0];
      previous[0] = row;
      for (let column = 1; column <= right.length; column += 1) {
        const above = previous[column];
        previous[column] = Math.min(
          previous[column] + 1,
          previous[column - 1] + 1,
          diagonal + (left[row - 1] === right[column - 1] ? 0 : 1),
        );
        diagonal = above;
      }
    }
    return previous[right.length];
  }

  function suggestCommands(input, commandNames, limit = 3) {
    if (typeof input !== "string" || !Array.isArray(commandNames)) return [];
    const normalized = input.trim().replace(/^:/, "").toLowerCase();
    if (!normalized || /\s/.test(normalized)) return [];

    return commandNames
      .map((name) => ({ name, score: distance(normalized, name.toLowerCase()) }))
      .filter(\n        ({ name, score }) =>\n          score <= Math.max(1, Math.ceil(normalized.length / 3)) &&\n          !name.toLowerCase().startsWith(normalized),\n      )
      .sort((left, right) => left.score - right.score || left.name.localeCompare(right.name))
      .slice(0, Math.max(0, limit))
      .map(({ name }) => name);
  }

  const api = { suggestCommands };
  root.VimCommandSuggestions = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
