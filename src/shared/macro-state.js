(function (root) {
  "use strict";

  const LIMITS = Object.freeze({
    macros: 20,
    commands: 20,
    arguments: 32,
    argumentLength: 256,
    nameLength: 40,
    storageBytes: 64 * 1024,
  });

  function normalizeName(value) {
    const name = String(value || "")
      .trim()
      .toLowerCase();
    if (name.length > LIMITS.nameLength || !/^[a-z0-9][a-z0-9_-]*$/i.test(name)) {
      throw new Error(
        "Macro names must start with a letter or number and use only letters, numbers, _ or -.",
      );
    }
    return name;
  }

  function normalizeCommands(value, allowedNames) {
    if (!Array.isArray(value) || value.length < 1 || value.length > LIMITS.commands) {
      throw new Error(`Macros must contain between 1 and ${LIMITS.commands} commands.`);
    }
    return value.map((command) => {
      if (
        !command ||
        typeof command !== "object" ||
        Array.isArray(command) ||
        Object.keys(command).some((key) => !["name", "args", "destination"].includes(key)) ||
        typeof command.name !== "string" ||
        !allowedNames.includes(command.name) ||
        !Array.isArray(command.args) ||
        !Array.isArray(command.destination) ||
        command.args.length > LIMITS.arguments ||
        command.destination.length > LIMITS.arguments ||
        command.args.some(
          (argument) =>
            typeof argument !== "string" ||
            argument.length > LIMITS.argumentLength ||
            argument === "--confirm",
        ) ||
        command.destination.some(
          (destination) =>
            typeof destination !== "string" || destination.length > LIMITS.argumentLength,
        )
      ) {
        throw new Error("Macro contains an invalid or unsupported command.");
      }
      return {
        name: command.name,
        args: [...command.args],
        destination: [...command.destination],
      };
    });
  }

  function normalizeMacros(value, allowedNames) {
    const macros = Object.create(null);
    if (!value || typeof value !== "object" || Array.isArray(value)) return macros;
    for (const [rawName, record] of Object.entries(value).slice(0, LIMITS.macros * 2)) {
      let name;
      try {
        name = normalizeName(rawName);
        macros[name] = {
          commands: normalizeCommands(record?.commands, allowedNames),
          updatedAt:
            Number.isFinite(record.updatedAt) && record.updatedAt > 0
              ? Math.floor(record.updatedAt)
              : Date.now(),
        };
      } catch {
        continue;
      }
      if (Object.keys(macros).length >= LIMITS.macros) break;
    }
    return macros;
  }

  function saveMacro(value, name, commands, allowedNames) {
    const key = normalizeName(name);
    const macros = { ...normalizeMacros(value, allowedNames) };
    if (Object.hasOwn(macros, key)) {
      throw new Error(`Macro "${key}" already exists. Delete it before redefining it.`);
    }
    if (Object.keys(macros).length >= LIMITS.macros) {
      throw new Error(`The limit of ${LIMITS.macros} saved macros has been reached.`);
    }
    macros[key] = {
      commands: normalizeCommands(commands, allowedNames),
      updatedAt: Date.now(),
    };
    if (JSON.stringify(macros).length * 2 > LIMITS.storageBytes) {
      throw new Error("Saved macros would exceed the 64 KiB macro storage budget.");
    }
    return macros;
  }

  function deleteMacro(value, name, allowedNames) {
    const key = normalizeName(name);
    const macros = { ...normalizeMacros(value, allowedNames) };
    if (!Object.hasOwn(macros, key)) throw new Error(`No macro named "${key}" exists.`);
    delete macros[key];
    return macros;
  }

  function listMacros(value, allowedNames) {
    return Object.entries(normalizeMacros(value, allowedNames))
      .map(([name, record]) => ({ name, commands: record.commands.length }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  const api = {
    LIMITS,
    deleteMacro,
    listMacros,
    normalizeCommands,
    normalizeMacros,
    normalizeName,
    saveMacro,
  };
  root.VimMacroState = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
