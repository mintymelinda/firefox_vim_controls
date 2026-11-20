import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const root = resolve(import.meta.dirname, "../..");
const project = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const extensionPath = resolve(root, "artifacts", `firefox-vim-controls-${project.version}.zip`);
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
    throw new Error(
      `WebDriver ${method} ${path} failed: ${payload.value?.message || response.statusText}`,
    );
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
  console.log(
    `Firefox ${capabilities.browserVersion || "unknown"}; geckodriver ${capabilities["moz:geckodriverVersion"] || "unknown"}`,
  );

  const addon = await readFile(extensionPath);
  const installedId = await request("POST", `/session/${sessionId}/moz/addon/install`, {
    addon: addon.toString("base64"),
    temporary: true,
    allowPrivateBrowsing: false,
  });
  assert.ok(installedId, "development extension should install temporarily");

  await request("POST", `/session/${sessionId}/url`, { url: fixtureUrl });
  await waitFor("fixture page title", async () => {
    return (await request("GET", `/session/${sessionId}/title`)) === "Firefox Vim Controls fixture";
  });

  const body = await findElement(sessionId, "body");
  assert.ok(body, "fixture body should be available");
  await sendKeys(sessionId, body, ":");
  let prompt = await waitFor("prompt activation on an ordinary page", () =>
    findElement(sessionId, "#fvc-command-panel"),
  );

  const promptInput = await findElement(sessionId, "#fvc-command-panel input");
  assert.ok(promptInput, "prompt should create and focus its input");
  const focused = await request("POST", `/session/${sessionId}/execute/sync`, {
    script: "return document.activeElement === document.querySelector('#fvc-command-panel input')",
    args: [],
  });
  assert.equal(focused, true, "opening the prompt should move focus into its input");

  await sendKeys(sessionId, promptInput, "\uE00C");
  await waitFor(
    "prompt dismissal with Escape",
    async () => (await findElement(sessionId, "#fvc-command-panel")) === null,
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
  prompt = await waitFor("Escape-then-colon activation", () =>
    findElement(sessionId, "#fvc-command-panel"),
  );
  assert.ok(prompt, "prompt should open after leaving editable focus");

  const commandInput = await findElement(sessionId, "#fvc-command-panel input");
  await sendKeys(sessionId, commandInput, ":tabs");
  await sendKeys(sessionId, commandInput, "\uE007");
  const output = await waitFor("background command response", async () => {
    const element = await findElement(sessionId, "#fvc-command-panel .fvc-output");
    if (!element) return null;
    const text = await request("GET", `/session/${sessionId}/element/${element}/text`);
    return text.includes("Firefox Vim Controls fixture") ? text : null;
  });
  assert.match(output, /Firefox Vim Controls fixture/);

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
    "Firefox browser smoke tests passed (activation, editable safety, focus, command round-trip, restricted page).",
  );
} finally {
  if (sessionId) {
    await request("DELETE", `/session/${sessionId}`).catch((error) => {
      console.error(`Could not close Firefox WebDriver session: ${error.message}`);
    });
  }
}
