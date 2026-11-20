(function (root) {
  "use strict";

  function splitOutsideQuotes(input, delimiter) {
    const parts = [];
    let start = 0;
    let quote = null;
    let escaped = false;

    for (let index = 0; index < input.length; index += 1) {
      const character = input[index];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === "\\") {
        escaped = true;
        continue;
      }
      if (quote) {
        if (character === quote) quote = null;
        continue;
      }
      if (character === "'" || character === '"') {
        quote = character;
        continue;
      }
      if (input.startsWith(delimiter, index)) {
        parts.push(input.slice(start, index).trim());
        start = index + delimiter.length;
        index += delimiter.length - 1;
      }
    }
    if (quote) throw new Error("Unclosed quote");
    parts.push(input.slice(start).trim());
    return parts;
  }

  function tokenize(input) {
    const tokens = [];
    let token = "";
    let quote = null;
    let escaped = false;

    for (const character of input) {
      if (escaped) {
        token += character;
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (quote) {
        if (character === quote) quote = null;
        else token += character;
      } else if (character === "'" || character === '"') {
        quote = character;
      } else if (/\s/.test(character)) {
        if (token) tokens.push(token);
        token = "";
      } else {
        token += character;
      }
    }
    if (escaped) token += "\\";
    if (quote) throw new Error("Unclosed quote");
    if (token) tokens.push(token);
    return tokens;
  }

  function parseSegment(segment) {
    const sections = splitOutsideQuotes(segment, ",");
    const words = tokenize(sections.shift() || "");
    if (words.length === 0) throw new Error("Expected a command after ':'");

    const name = words.shift().toLowerCase();
    if (!/^[a-z][a-z0-9_-]*$/.test(name)) {
      throw new Error(`Invalid command name: ${name}`);
    }
    const destination = sections.flatMap((part) => tokenize(part));
    return {
      name,
      args: words,
      destination,
      raw: segment.trim(),
    };
  }

  function parseCommandLine(input) {
    if (typeof input !== "string") throw new TypeError("Command must be text");
    if (input.length > 2000) throw new Error("Command is too long (maximum 2000 characters)");
    const source = input.trim().replace(/^:/, "");
    if (!source) throw new Error("Enter a command");
    const segments = splitOutsideQuotes(source, "&&");
    if (segments.some((segment) => !segment)) {
      throw new Error("Empty command in command chain");
    }
    return { commands: segments.map(parseSegment) };
  }

  const api = { parseCommandLine, splitOutsideQuotes, tokenize };
  root.VimCommandParser = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
