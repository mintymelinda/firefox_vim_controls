(function (root) {
  "use strict";

  const commands = [
    { name: "help", status: "implemented", summary: "Show command help" },
    { name: "version", status: "implemented", summary: "Show extension version" },
    { name: "clear", status: "implemented", summary: "Clear command output" },
    { name: "tabs", status: "implemented", summary: "List matching tabs" },
    { name: "count", status: "implemented", summary: "Count matching tabs" },
    { name: "current", status: "implemented", summary: "Show the active tab" },
    { name: "domains", status: "implemented", summary: "List domains represented by open tabs" },
    { name: "duplicates", status: "implemented", summary: "Find duplicate tabs" },
    { name: "close", status: "planned", summary: "Close matching tabs" },
    { name: "move", status: "planned", summary: "Move matching tabs to a window" },
    { name: "reload", status: "planned", summary: "Reload matching tabs" },
    { name: "mute", status: "planned", summary: "Mute matching tabs" },
    { name: "unmute", status: "planned", summary: "Unmute matching tabs" },
    { name: "pin", status: "planned", summary: "Pin matching tabs" },
    { name: "unpin", status: "planned", summary: "Unpin matching tabs" },
    { name: "discard", status: "planned", summary: "Discard matching tabs" },
    { name: "windows", status: "planned", summary: "List browser windows" },
    { name: "window", status: "planned", summary: "Switch to a browser window" },
    { name: "new_window", status: "planned", summary: "Open a new browser window" },
    { name: "sort", status: "planned", summary: "Sort tabs" },
    { name: "reverse", status: "planned", summary: "Reverse tab order" },
    { name: "shuffle", status: "planned", summary: "Shuffle tab order" },
  ];

  const registry = {
    all() {
      return commands.map((command) => ({ ...command }));
    },
    get(name) {
      const command = commands.find((item) => item.name === name.toLowerCase());
      return command ? { ...command } : undefined;
    },
    names() {
      return commands.map((command) => command.name);
    },
  };

  root.VimCommandRegistry = registry;
  if (typeof module !== "undefined" && module.exports) module.exports = registry;
})(globalThis);
