"use strict";

browser.runtime.onMessage.addListener((message) => {
  if (!message || message.type !== "VIM_COMMAND_REQUEST") return undefined;
  if (typeof message.command !== "string" || message.command.length > 2000) {
    return Promise.resolve({ ok: false, error: "Invalid command request" });
  }

  return Promise.resolve({
    ok: false,
    error: "This command is parsed but its browser action is not available until a later phase.",
  });
});
