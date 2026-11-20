import assert from "node:assert/strict";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const root = resolve(import.meta.dirname, "../..");
const project = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const extensionPath = resolve(root, "artifacts", `firefox-vim-controls-${project.version}.zip`);
const sharedExtensionPath = `/extension-artifacts/firefox-vim-controls-${project.version}.zip`;
await mkdir("/extension-artifacts", { recursive: true });
await copyFile(extensionPath, sharedExtensionPath);
const remoteUrl = (process.env.SELENIUM_REMOTE_URL || "http://firefox:4444").replace(/\/$/, "");
const fixtureUrl = process.env.FIXTURE_URL || "http://fixture:4173/";

function endpoint(path) {
  return `${remoteUrl}${path}`;
}

async function request(method, path, body) {
  const response = await fetch(endpoint(path), {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json();
  if (!response.ok || payload.value?.error) {
    const message = payload.value?.message || payload.message || JSON.stringify(payload);
    throw new Error(`WebDriver ${method} ${path} failed: ${message}`);
  }
  return payload.value;
}

async function findElement(sessionId, selector) {
  try {
    const result = await request("POST", `/session/${sessionId}/element`, {
      using: "css selector",
      value: selector,
    });
    return result["element-6066-11e4-a52e-4f735466cecf"];
  } catch (error) {
    if (/no such element|unable to locate element/i.test(error.message)) return null;
    throw error;
  }
}

async function sendKeys(sessionId, elementId, text) {
  await request("POST", `/session/${sessionId}/element/${elementId}/value`, {
    text,
    value: Array.from(text),
  });
}

async function executeScript(sessionId, script, args = []) {
  return request("POST", `/session/${sessionId}/execute/sync`, { script, args });
}

async function waitFor(description, callback, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await callback();
    if (value) return value;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

let sessionId;
try {
  const session = await request("POST", "/session", {
    capabilities: {
      alwaysMatch: {
        browserName: "firefox",
        "moz:firefoxOptions": { args: ["-headless"] },
      },
    },
  });
  sessionId = session.sessionId;
  assert.ok(sessionId, "Firefox WebDriver session should be created");
  const capabilities = session.capabilities || {};
  const browserVersion = capabilities.browserVersion || "unknown";
  const geckodriverVersion = capabilities["moz:geckodriverVersion"] || "unknown";
  console.log(`Firefox ${browserVersion}; geckodriver ${geckodriverVersion}`);
  const expectedMajor = process.env.EXPECTED_FIREFOX_MAJOR;
  if (expectedMajor) {
    assert.equal(
      browserVersion.split(".")[0],
      expectedMajor,
      `browser-test target must use Firefox ${expectedMajor}.x`,
    );
  }

  // The path form works with Firefox 115 ESR and current Firefox Marionette handlers.
  const installedId = await request("POST", `/session/${sessionId}/moz/addon/install`, {
    path: sharedExtensionPath,
    temporary: true,
  });
  assert.ok(installedId, "development extension should install temporarily");

  await request("POST", `/session/${sessionId}/url`, { url: fixtureUrl });
  await waitFor("fixture page title", async () => {
    return (await request("GET", `/session/${sessionId}/title`)) === "Firefox Vim Controls fixture";
  });

  const body = await findElement(sessionId, "body");
  assert.ok(body, "fixture body should be available");
  const trigger = await findElement(sessionId, "#fixture-button");
  assert.ok(trigger, "fixture should expose a focusable trigger button");
  await sendKeys(sessionId, body, "\uE004\uE004");
  assert.equal(
    await executeScript(sessionId, "return document.activeElement.id"),
    "fixture-button",
    "keyboard Tab navigation should reach the fixture button",
  );
  await sendKeys(sessionId, trigger, ":");
  assert.ok(
    await waitFor("prompt activation on an ordinary page", () =>
      findElement(sessionId, "#fvc-command-panel"),
    ),
    "prompt should activate on an ordinary page",
  );

  const promptInput = await findElement(sessionId, "#fvc-command-panel input");
  assert.ok(promptInput, "prompt should create its input");
  assert.equal(
    await executeScript(
      sessionId,
      "return document.activeElement === document.querySelector('#fvc-command-panel input')",
    ),
    true,
    "opening the prompt should move focus into its input",
  );

  const accessibility = await executeScript(
    sessionId,
    `const panel = document.querySelector("#fvc-command-panel");
     const field = panel?.querySelector("input");
     const log = panel?.querySelector('[role="log"]');
     const hint = panel?.querySelector("#fvc-command-hint");
     return {
       role: panel?.getAttribute("role"),
       modal: panel?.getAttribute("aria-modal"),
       name: panel?.getAttribute("aria-label"),
       describedBy: panel?.getAttribute("aria-describedby"),
       hintId: hint?.id,
       hintText: hint?.textContent,
       inputName: field?.getAttribute("aria-label"),
       logRole: log?.getAttribute("role"),
       live: log?.getAttribute("aria-live"),
       relevant: log?.getAttribute("aria-relevant"),
       atomic: log?.getAttribute("aria-atomic"),
     };`,
  );
  assert.deepEqual(
    accessibility,
    {
      role: "dialog",
      modal: "true",
      name: "Firefox Vim Controls command prompt",
      describedBy: "fvc-command-hint",
      hintId: "fvc-command-hint",
      hintText: "Enter: run · Tab: complete · ↑/↓: history · Esc: close",
      inputName: "Command",
      logRole: "log",
      live: "polite",
      relevant: "additions text",
      atomic: "false",
    },
    "prompt should expose its expected accessible dialog, input, hint, and live-log semantics",
  );

  await executeScript(
    sessionId,
    "document.querySelector('#fixture-button').focus(); return document.activeElement.id",
  );
  assert.equal(
    await executeScript(sessionId, "return document.activeElement.id"),
    "fvc-command-input",
    "focus leaving the modal prompt should be returned to its input",
  );

  await sendKeys(sessionId, promptInput, "\uE00C");
  await waitFor(
    "prompt dismissal with Escape",
    async () => (await findElement(sessionId, "#fvc-command-panel")) === null,
  );
  assert.equal(
    await executeScript(sessionId, "return document.activeElement.id"),
    "fixture-button",
    "closing the prompt should restore focus to the previously focused page control",
  );

  const editable = await findElement(sessionId, "#fixture-input");
  assert.ok(editable, "fixture should expose an editable input");
  await sendKeys(sessionId, editable, ":");
  await delay(250);
  assert.equal(
    await findElement(sessionId, "#fvc-command-panel"),
    null,
    "typing a colon in an editable control must not open the prompt",
  );

  await sendKeys(sessionId, editable, "\uE00C");
  await sendKeys(sessionId, body, ":");
  assert.ok(
    await waitFor("Escape-then-colon activation", () =>
      findElement(sessionId, "#fvc-command-panel"),
    ),
    "prompt should open after leaving editable focus",
  );

  const commandInput = await findElement(sessionId, "#fvc-command-panel input");

  async function runCommand(command, expectedOutput) {
    await sendKeys(sessionId, commandInput, command);
    await sendKeys(sessionId, commandInput, "\uE007");
    const output = await waitFor(`command response for ${command}`, async () => {
      const text = await executeScript(
        sessionId,
        "return document.querySelector('#fvc-command-panel .fvc-output')?.lastElementChild?.textContent || ''",
      );
      return text.includes(expectedOutput) ? text : null;
    });
    await waitFor(`command input reset after ${command}`, async () =>
      executeScript(
        sessionId,
        "return document.querySelector('#fvc-command-panel input').value === ''",
      ),
    );
    return output;
  }

  await sendKeys(sessionId, commandInput, ":tabs");
  await sendKeys(sessionId, commandInput, "\uE007");
  const output = await waitFor("background command response", async () => {
    const element = await findElement(sessionId, "#fvc-command-panel .fvc-output");
    if (!element) return null;
    const text = await request("GET", `/session/${sessionId}/element/${element}/text`);
    return text.includes("Firefox Vim Controls fixture") ? text : null;
  });
  assert.match(output, /Firefox Vim Controls fixture/);
  await waitFor(
    "command input reset after background response",
    async () =>
      await executeScript(
        sessionId,
        "return document.querySelector('#fvc-command-panel input').value === ''",
      ),
  );

  const initialOutputCount = await executeScript(
    sessionId,
    "return document.querySelector('#fvc-command-panel .fvc-output').childElementCount",
  );
  for (let index = 0; index < 201; index += 1) {
    await sendKeys(sessionId, commandInput, ":version");
    await sendKeys(sessionId, commandInput, "\uE007");
    const expectedCount = Math.min(initialOutputCount + index + 1, 200);
    await waitFor(`version output ${index + 1}`, async () => {
      const state = await executeScript(
        sessionId,
        "return { count: document.querySelector('#fvc-command-panel .fvc-output').childElementCount, value: document.querySelector('#fvc-command-panel input').value }",
      );
      return state.count === expectedCount && state.value === "" ? state : null;
    });
  }
  assert.equal(
    await executeScript(
      sessionId,
      "return document.querySelector('#fvc-command-panel .fvc-output').childElementCount",
    ),
    200,
    "prompt output should retain no more than 200 entries",
  );

  await runCommand(
    ":open http://fixture:4173/second, new_tab",
    "Opened http://fixture:4173/second in new tab",
  );
  await delay(500);
  await runCommand(":count all", "2 tab(s) matched all.");
  await runCommand(":pin all", "2 of 2 tab(s) updated.");
  const pinnedTabs = await runCommand(":tabs", "[pinned]");
  assert.match(pinnedTabs, /Firefox Vim Controls fixture — fixture:4173\/second/);
  const pinnedLines = await executeScript(
    sessionId,
    "return Array.from(document.querySelectorAll('#fvc-command-panel .fvc-output')).slice(-2).map((line) => line.textContent)",
  );
  assert.equal(pinnedLines.length, 2);
  assert.ok(pinnedLines.every((line) => line.includes("[pinned]")));
  const undonePin = await runCommand(":undo", "Undid pin.");
  assert.match(undonePin, /Undid pin\./);
  const restoredTabs = await runCommand(
    ":tabs",
    "Firefox Vim Controls fixture — fixture:4173/second",
  );
  assert.doesNotMatch(
    restoredTabs,
    /\[pinned\]/,
    "undo should restore the actual pinned state of both browser tabs",
  );
  const restoredLines = await executeScript(
    sessionId,
    "return Array.from(document.querySelectorAll('#fvc-command-panel .fvc-output')).slice(-2).map((line) => line.textContent)",
  );
  assert.equal(restoredLines.length, 2);
  assert.ok(restoredLines.every((line) => !line.includes("[pinned]")));

  await runCommand(
    ":open http://unrelated-fixture:4173/untouched, new_tab",
    "Opened http://unrelated-fixture:4173/untouched in new tab",
  );
  await delay(500);
  await runCommand(":move domain:fixture, new_window", "Moved 2 tab(s) into new window");
  await runCommand(":windows", "Window ");
  const windowLines = await executeScript(
    sessionId,
    "return Array.from(document.querySelectorAll('#fvc-command-panel .fvc-output')).slice(-2).map((line) => line.textContent)",
  );
  assert.equal(windowLines.length, 2, "the move should leave two normal browser windows");
  assert.ok(
    windowLines.some((line) => line.includes("unrelated-fixture:4173/untouched")),
    "the unrelated-domain tab should remain in its original window",
  );
  assert.ok(
    windowLines.some(
      (line) => line.includes("2 tab(s)") && line.includes("Firefox Vim Controls fixture"),
    ),
    "the two selected fixture tabs should be grouped in the new window",
  );
  await runCommand(":count all", "3 tab(s) matched all.");
  await runCommand(":count domain:fixture", "2 tab(s) matched domain:fixture");

  await sendKeys(sessionId, commandInput, "\uE00C");
  await waitFor(
    "prompt close after command",
    async () => (await findElement(sessionId, "#fvc-command-panel")) === null,
  );

  await request("POST", `/session/${sessionId}/url`, { url: "about:blank" });
  await delay(500);
  assert.equal(
    await findElement(sessionId, "#fvc-command-panel"),
    null,
    "about:blank must not receive the content-script prompt without an explicit match-about-blank opt-in",
  );

  console.log(
    "Firefox browser smoke tests passed (prompt accessibility/focus, output retention, tab creation/pinning/undo, cross-window selection isolation, command round-trip, about:blank boundary).",
  );
} finally {
  if (sessionId) {
    await request("DELETE", `/session/${sessionId}`).catch((error) => {
      console.error(`Could not close Firefox WebDriver session: ${error.message}`);
    });
  }
}
