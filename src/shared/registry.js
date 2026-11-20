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
    { name: "audible", status: "implemented", summary: "List tabs currently playing audio" },
    { name: "loading", status: "implemented", summary: "List tabs currently loading" },
    { name: "bookmarks", status: "implemented", summary: "Open Firefox's bookmarks manager" },
    { name: "downloads", status: "implemented", summary: "Open Firefox's downloads manager" },
    {
      name: "new_private",
      status: "implemented",
      summary: "Create a private browser window when permitted",
    },
    { name: "close", status: "implemented", summary: "Close matching tabs" },
    { name: "move", status: "implemented", summary: "Move matching tabs to a window" },
    { name: "reload", status: "implemented", summary: "Reload matching tabs" },
    { name: "mute", status: "implemented", summary: "Mute matching tabs" },
    { name: "unmute", status: "implemented", summary: "Unmute matching tabs" },
    { name: "pin", status: "implemented", summary: "Pin matching tabs" },
    { name: "unpin", status: "implemented", summary: "Unpin matching tabs" },
    { name: "discard", status: "implemented", summary: "Discard matching tabs" },
    { name: "windows", status: "implemented", summary: "List normal browser windows" },
    {
      name: "window",
      status: "implemented",
      summary: "Focus a numbered, next, or previous window",
    },
    { name: "new_window", status: "implemented", summary: "Open a new normal browser window" },
    { name: "fullscreen", status: "implemented", summary: "Fullscreen the focused window" },
    { name: "minimize", status: "implemented", summary: "Minimize the focused window" },
    { name: "maximize", status: "implemented", summary: "Maximize the focused window" },
    {
      name: "merge",
      status: "implemented",
      summary: "Merge normal windows into the focused window",
    },
    { name: "split", status: "implemented", summary: "Move matching tabs into a new window" },
    {
      name: "sort",
      status: "implemented",
      summary: "Sort matching tabs by domain, title, URL, or recent activity",
    },
    { name: "reverse", status: "implemented", summary: "Reverse matching tab order" },
    { name: "shuffle", status: "implemented", summary: "Shuffle matching tab order" },
    { name: "open", status: "implemented", summary: "Open a URL or shortcut" },
    { name: "search", status: "implemented", summary: "Search the web" },
    { name: "back", status: "implemented", summary: "Go back in matching tab history" },
    { name: "forward", status: "implemented", summary: "Go forward in matching tab history" },
    { name: "refresh", status: "implemented", summary: "Refresh matching tabs" },
    { name: "home", status: "implemented", summary: "Open Firefox's home page" },
    {
      name: "stop",
      status: "planned",
      summary: "Stop loading (not exposed by a safe WebExtensions API)",
    },
    { name: "history", status: "implemented", summary: "Show recent command history" },
    { name: "clear_history", status: "implemented", summary: "Clear saved command history" },
    { name: "alias", status: "implemented", summary: "Create a named command alias" },
    { name: "unalias", status: "implemented", summary: "Remove a command alias" },
    { name: "aliases", status: "implemented", summary: "List saved command aliases" },
    { name: "set", status: "implemented", summary: "Update local command preferences" },
    {
      name: "session",
      status: "implemented",
      summary: "Save, load, append, and manage named sessions",
    },
    { name: "workspace", status: "implemented", summary: "Create and switch named workspaces" },
    { name: "macro", status: "implemented", summary: "Define and run safe command macros" },
    { name: "undo", status: "implemented", summary: "Undo the last supported reversible command" },
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
