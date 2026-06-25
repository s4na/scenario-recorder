import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import puppeteer from "puppeteer-core";

const extensionDir = resolve(process.argv[2] ?? "dist");

if (!existsSync(extensionDir)) {
  fail(`Extension directory is missing: ${extensionDir}`);
}

const fixtureServer = await startFixtureServer();
const fixtureOrigin = `http://127.0.0.1:${fixtureServer.port}`;
const userDataDir = mkdtempSync(`${tmpdir()}/scenario-recorder-e2e-`);
const downloadDir = mkdtempSync(`${tmpdir()}/scenario-recorder-downloads-`);
let browser;

try {
  browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: false,
    ignoreDefaultArgs: ["--disable-extensions"],
    dumpio: process.env.CI === "true",
    pipe: true,
    timeout: 90_000,
    userDataDir,
    args: [
      "--disable-background-networking",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-sandbox",
      "--disable-extensions-except=" + extensionDir,
      "--load-extension=" + extensionDir,
      "--no-first-run",
      "--no-default-browser-check",
      "--window-size=1280,900",
    ],
  });
  const browserClient = await browser.target().createCDPSession();
  await browserClient.send("Browser.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: downloadDir,
  });

  const fixturePage = await browser.newPage();
  await fixturePage.goto(`${fixtureOrigin}/fixture?case=context`, { waitUntil: "domcontentloaded" });
  const extensionId = await waitForExtensionId(browser);
  const controlPage = await browser.newPage();
  await controlPage.goto(`chrome-extension://${extensionId}/index.html`, { waitUntil: "domcontentloaded" });
  await clearExtensionStorage(controlPage);

  await runContextRecording({ controlPage, fixturePage, fixtureOrigin });
  await runLoginRecording({ browser, controlPage, fixturePage, fixtureOrigin });

  const scenarios = await getScenarios(controlPage);
  assert(scenarios.length === 2, `Expected 2 saved scenarios, got ${scenarios.length}.`);
  assert(
    scenarios.some((scenario) => isDefaultScenarioName(scenario.name)),
    "Unnamed context scenario was not saved with a timestamp name.",
  );
  assert(
    scenarios.some((scenario) => scenario.name === "ログイン確認"),
    "Login scenario was not saved.",
  );

  await controlPage.reload({ waitUntil: "domcontentloaded" });
  await controlPage.waitForFunction(
    (scenarioName) => document.body.innerText.includes(scenarioName),
    { timeout: 8_000 },
    scenarios[0].name,
  );
  const popupText = await controlPage.evaluate(() => document.body.innerText);
  assert(popupText.includes("作る"), "Popup does not expose the recording workflow.");
  assert(popupText.includes("エクスポート"), "Popup does not expose the export workflow.");
  assert(popupText.includes("記録一覧"), "Popup does not expose the record list.");
  assert(popupText.includes("記録の流れ"), "Popup does not show saved record step summaries.");
  assert(popupText.includes("この記録をエクスポート"), "Popup does not expose one-record export.");
  assert(!popupText.includes("軽く記録"), "Popup still asks users to choose a lightweight recording mode.");
  assert(!popupText.includes("詳細に記録"), "Popup still asks users to choose a detailed recording mode.");
  assert(!popupText.includes("Codex用"), "Popup still exposes Codex-specific wording.");
  assert(!popupText.includes("Playwrightをダウンロード"), "Popup still exposes Playwright as a primary action.");
  assert(popupText.includes(scenarios[0].name), "Popup does not show the latest saved scenario.");
  await clickPopupButtonWithText(controlPage, "この記録をエクスポート");
  const latestJsonl = await waitForDownloadedFile(".jsonl");
  const latestJsonlLines = parseJsonl(readFileSync(latestJsonl, "utf8"));
  assert(latestJsonlLines[0]?.kind === "meta", "Downloaded JSONL does not start with metadata.");
  assert(latestJsonlLines[0]?.name === scenarios[0].name, "Downloaded JSONL does not use the latest scenario.");
  assert(
    latestJsonlLines.some((line) => line.kind === "step" && line.type === "fill"),
    "Downloaded JSONL does not include the recorded fill step.",
  );
  await openPopupDetailsWithText(controlPage, "対象と管理");
  assert(
    await controlPage.evaluate(() => document.body.innerText.includes("全記録をエクスポート")),
    "Popup does not expose all-record export.",
  );
  await clickPopupButtonWithText(controlPage, "全記録をエクスポート");
  const allRecordsZip = await waitForDownloadedFile(".zip");
  const zipEntries = readZipEntries(readFileSync(allRecordsZip));
  assert(
    zipEntries.length === 2 && zipEntries.every((entry) => entry.endsWith(".jsonl")),
    "Downloaded ZIP does not include one JSONL file per saved record.",
  );
} finally {
  await browser?.close().catch(() => undefined);
  fixtureServer.server.close();
  rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  rmSync(downloadDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

async function runContextRecording({ controlPage, fixturePage, fixtureOrigin }) {
  await fixturePage.goto(`${fixtureOrigin}/fixture?case=context`, { waitUntil: "domcontentloaded" });
  await controlPage.reload({ waitUntil: "domcontentloaded" });
  await setSettings(controlPage, {
    allowedOrigins: [fixtureOrigin],
    recordingDetailLevel: "minimal",
  });
  await controlPage.reload({ waitUntil: "domcontentloaded" });
  await fixturePage.bringToFront();
  await clickPopup(controlPage, "start-recording");
  await waitForRecorderStatus(controlPage, "recording");
  await waitForOverlay(fixturePage, "recording");
  await controlPage.reload({ waitUntil: "domcontentloaded" });
  await fixturePage.click("#choose-package");
  await selectFixtureText(fixturePage, "#selection-source");
  await fixturePage.type("#traveler-name", "Sana Tester");
  await fixturePage.click("#destination");
  await fixturePage.keyboard.press("ArrowDown");
  await fixturePage.keyboard.press("ArrowDown");
  await fixturePage.keyboard.press("Enter");
  await clickPopup(controlPage, "pause-recording");
  await waitForRecorderStatus(controlPage, "paused");
  await waitForOverlay(fixturePage, "paused");
  await fixturePage.click("#paused-action");
  await clickPopup(controlPage, "resume-recording");
  await waitForRecorderStatus(controlPage, "recording");
  await waitForOverlay(fixturePage, "recording");
  await fixturePage.click("#resume-action");
  await Promise.all([
    fixturePage.waitForNavigation({ waitUntil: "domcontentloaded" }),
    fixturePage.click("#submit-booking"),
  ]);
  await clickPopup(controlPage, "stop-recording");
  await waitForRecorderStatus(controlPage, "idle");
  await controlPage.reload({ waitUntil: "domcontentloaded" });
  await clickPopup(controlPage, "save-scenario");
  await waitForScenarioCount(controlPage, 1);

  const [scenario] = await getScenarios(controlPage);
  assert(isDefaultScenarioName(scenario.name), "Unnamed context scenario did not use the timestamp default name.");
  assert(
    scenario.startUrl === `${fixtureOrigin}/fixture?case=context`,
    "Unnamed context scenario did not keep the recording start URL.",
  );
  const stepTypes = scenario.steps.map((step) => step.type);
  for (const type of ["click", "fill", "select", "submit"]) {
    assert(stepTypes.includes(type), `Context scenario is missing ${type} step.`);
  }
  assert(stepTypes.includes("selection"), "Context scenario is missing text selection step.");
  assert(
    scenario.steps.some(
      (step) =>
        step.type === "fill" &&
        step.value === "Sana Tester" &&
        targetMatches(step.target, { id: "traveler-name", name: "travelerName", label: "Traveler name" }),
    ),
    "Context scenario did not keep the traveler name fill target and value.",
  );
  assert(
    scenario.steps.some(
      (step) =>
        step.type === "select" &&
        step.value === "okinawa" &&
        targetMatches(step.target, { id: "destination", name: "destination", label: "Destination" }),
    ),
    "Context scenario did not keep the destination select target and value.",
  );
  assert(
    scenario.steps.some(
      (step) =>
        step.type === "submit" &&
        targetMatches(step.submitter, { id: "submit-booking" }),
    ),
    "Context scenario did not keep the submitter target.",
  );
  assert(
    scenario.steps.some((step) => step.target?.context?.length > 0),
    "Context recording did not keep target context.",
  );
  assert(
    !scenario.steps.some((step) => step.target?.text === "Paused action"),
    "Paused interaction was recorded.",
  );
}

async function selectFixtureText(page, selector) {
  const rect = await page.$eval(selector, (element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const bounds = range.getBoundingClientRect();
    return {
      x: bounds.left,
      y: bounds.top,
      width: bounds.width,
      height: bounds.height,
    };
  });
  const y = rect.y + rect.height / 2;
  await page.mouse.move(rect.x + 2, y);
  await page.mouse.down();
  await page.mouse.move(rect.x + Math.min(rect.width - 2, 150), y, { steps: 8 });
  await page.mouse.up();
  await delay(220);
}

async function runLoginRecording({ browser, controlPage, fixturePage, fixtureOrigin }) {
  await fixturePage.goto(`${fixtureOrigin}/fixture?case=minimal`, { waitUntil: "domcontentloaded" });
  await setSettings(controlPage, {
    allowedOrigins: [fixtureOrigin],
    recordingDetailLevel: "minimal",
  });
  await controlPage.reload({ waitUntil: "domcontentloaded" });
  await fixturePage.bringToFront();
  await sendExtensionMessage(controlPage, { type: "START_RECORDING" });
  await waitForRecorderStatus(controlPage, "recording");
  await waitForOverlay(fixturePage, "recording");
  await fixturePage.click("#login-email");
  await fixturePage.type("#login-email", "user@example.com");
  await fixturePage.click("#login-submit");
  await waitForSteps(controlPage, (steps) =>
    steps.some((step) => step.type === "fill") &&
    steps.some((step) => step.type === "click" && targetMatches(step.target, { id: "login-submit", name: "", label: "" }))
  );
  await sendExtensionMessage(controlPage, { type: "STOP_RECORDING" });
  await sendExtensionMessage(controlPage, {
    type: "SAVE_SCENARIO",
    payload: { name: "ログイン確認" },
  });
  await waitForScenarioCount(controlPage, 2);

  const [scenario] = await getScenarios(controlPage);
  assert(scenario.name === "ログイン確認", "Latest login scenario name did not match.");
  assert(
    scenario.steps.some((step) => step.type === "fill"),
    "Login scenario did not record fill steps.",
  );
  assert(
    scenario.steps.some((step) => step.target?.context?.length > 0 || step.target?.contextSummary),
    "Standard recording did not keep target context.",
  );

  const existingPages = new Set(await browser.pages());
  await sendExtensionMessage(controlPage, {
    type: "EXECUTE_SCENARIO",
    payload: { scenarioId: scenario.id },
  });
  const executedPage = await waitForNewPage(browser, existingPages);
  await executedPage.waitForFunction(
    () => document.querySelector("#login-result")?.textContent === "Logged in as user@example.com",
    { timeout: 8_000 },
  );

  await setSettings(controlPage, {
    allowedOrigins: ["https://blocked.example.test"],
    recordingDetailLevel: "context",
  });
  const blockedRunPages = new Set(await browser.pages());
  await assertRejects(
    () =>
      sendExtensionMessage(controlPage, {
        type: "EXECUTE_SCENARIO",
        payload: { scenarioId: scenario.id },
      }),
    "Scenario URL is outside the configured target origins.",
  );
  assert(
    (await browser.pages()).every((page) => blockedRunPages.has(page)),
    "Blocked scenario execution opened a new tab.",
  );
}

async function clickPopup(controlPage, testId) {
  await controlPage.waitForFunction((selector) => {
    const button = document.querySelector(selector);
    return button instanceof HTMLButtonElement && !button.disabled;
  }, { timeout: 8_000 }, `[data-testid="${testId}"]`);
  await controlPage.evaluate((selector) => {
    const button = document.querySelector(selector);
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error(`Button was not found: ${selector}`);
    }
    button.click();
  }, `[data-testid="${testId}"]`);
}

async function clickPopupButtonWithText(controlPage, text) {
  await controlPage.bringToFront();
  await controlPage.waitForFunction((buttonText) => {
    const buttons = Array.from(document.querySelectorAll("button"));
    return buttons.some((button) => button.textContent?.trim() === buttonText && !button.disabled);
  }, { timeout: 8_000 }, text);
  await controlPage.evaluate((buttonText) => {
    const button = Array.from(document.querySelectorAll("button"))
      .find((candidate) => candidate.textContent?.trim() === buttonText);
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error(`Button was not found: ${buttonText}`);
    }
    button.click();
  }, text);
}

async function openPopupDetailsWithText(controlPage, text) {
  await controlPage.bringToFront();
  await controlPage.waitForFunction((summaryText) => {
    const summaries = Array.from(document.querySelectorAll("summary"));
    return summaries.some((summary) => summary.textContent?.trim() === summaryText);
  }, { timeout: 8_000 }, text);
  await controlPage.evaluate((summaryText) => {
    const summary = Array.from(document.querySelectorAll("summary"))
      .find((candidate) => candidate.textContent?.trim() === summaryText);
    if (!(summary instanceof HTMLElement)) {
      throw new Error(`Summary was not found: ${summaryText}`);
    }
    const details = summary.closest("details");
    if (!(details instanceof HTMLDetailsElement)) {
      throw new Error(`Details was not found: ${summaryText}`);
    }
    details.open = true;
  }, text);
}

async function waitForRecorderStatus(controlPage, status) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 8_000) {
    const state = await sendExtensionMessage(controlPage, { type: "GET_RECORDER_STATE" });
    if (state.status === status) {
      return;
    }
    await delay(100);
  }
  throw new Error(`Recorder did not reach ${status}.`);
}

async function waitForOverlay(fixturePage, status) {
  await fixturePage.waitForFunction(
    (expectedStatus) =>
      document.getElementById("scenario-recorder-status-overlay")?.dataset.status === expectedStatus,
    { timeout: 8_000 },
    status,
  );
}

async function waitForExtensionId(browser) {
  const target = await browser.waitForTarget(
    (candidate) =>
      candidate.type() === "service_worker" &&
      candidate.url().startsWith("chrome-extension://") &&
      candidate.url().endsWith("/assets/background.js"),
    { timeout: 10_000 },
  );
  return new URL(target.url()).host;
}

async function clearExtensionStorage(controlPage) {
  await controlPage.evaluate(() => new Promise((resolve) => chrome.storage.local.clear(resolve)));
}

async function setSettings(controlPage, settings) {
  await sendExtensionMessage(controlPage, {
    type: "UPDATE_SETTINGS",
    payload: settings,
  });
}

async function getScenarios(controlPage) {
  const result = await controlPage.evaluate(
    () => new Promise((resolve) => chrome.storage.local.get("scenarioRecorder.scenarios", resolve)),
  );
  return result["scenarioRecorder.scenarios"] ?? [];
}

async function waitForSteps(controlPage, predicate) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 8_000) {
    const state = await sendExtensionMessage(controlPage, { type: "GET_RECORDER_STATE" });
    if (predicate(state.currentSteps)) {
      return;
    }
    await delay(100);
  }
  throw new Error("Recorded steps did not reach the expected state.");
}

async function waitForScenarioCount(controlPage, count) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 8_000) {
    const scenarios = await getScenarios(controlPage);
    if (scenarios.length >= count) {
      return;
    }
    await delay(100);
  }
  throw new Error(`Saved scenarios did not reach ${count}.`);
}

async function waitForNewPage(browser, existingPages) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 8_000) {
    const page = (await browser.pages()).find((candidate) => !existingPages.has(candidate));
    if (page) {
      await page.waitForFunction(() => document.readyState === "complete", { timeout: 8_000 });
      return page;
    }
    await delay(100);
  }
  throw new Error("Scenario execution did not open a new page.");
}

async function waitForDownloadedFile(extension) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 8_000) {
    const files = readdirSync(downloadDir)
      .filter((file) => file.endsWith(extension) && !file.endsWith(".crdownload"))
      .sort();
    if (files.length > 0) {
      return resolve(downloadDir, files.at(-1));
    }
    await delay(100);
  }
  throw new Error(`Download with extension ${extension} was not created.`);
}

function parseJsonl(text) {
  return text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function readZipEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const names = [];
  let offset = 0;
  while (offset < bytes.length - 4) {
    if (view.getUint32(offset, true) === 0x02014b50) {
      const filenameLength = view.getUint16(offset + 28, true);
      const extraLength = view.getUint16(offset + 30, true);
      const commentLength = view.getUint16(offset + 32, true);
      names.push(decoder.decode(bytes.subarray(offset + 46, offset + 46 + filenameLength)));
      offset += 46 + filenameLength + extraLength + commentLength;
      continue;
    }
    offset += 1;
  }
  return names;
}

function targetMatches(target, expected) {
  return (
    (expected.id !== undefined && target?.id === expected.id) ||
    (expected.name !== undefined && target?.name === expected.name) ||
    (expected.label !== undefined && target?.label === expected.label) ||
    target?.selectorCandidates?.some((candidate) =>
      (expected.id !== undefined && candidate.type === "id" && candidate.value === expected.id) ||
      (expected.name !== undefined && candidate.type === "name" && candidate.value === expected.name) ||
      (expected.label !== undefined && candidate.type === "label" && candidate.value === expected.label)
    ) === true
  );
}

function isDefaultScenarioName(name) {
  return /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_127-0-0-1-\d+-fixture$/.test(name);
}

async function sendExtensionMessage(controlPage, message) {
  return controlPage.evaluate(
    (runtimeMessage) =>
      new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(runtimeMessage, (response) => {
          const error = chrome.runtime.lastError;
          if (error) {
            reject(new Error(error.message));
            return;
          }
          if (response && typeof response === "object" && "error" in response) {
            reject(new Error(String(response.error)));
            return;
          }
          resolve(response);
        });
      }),
    message,
  );
}

async function assertRejects(action, expectedMessage) {
  try {
    await action();
  } catch (error) {
    assert(
      error instanceof Error && error.message.includes(expectedMessage),
      `Expected rejection to include "${expectedMessage}", got "${error instanceof Error ? error.message : String(error)}".`,
    );
    return;
  }
  fail(`Expected action to reject with "${expectedMessage}".`);
}

async function startFixtureServer() {
  const server = createServer((request, response) => {
    if (request.url?.startsWith("/submitted")) {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end("<!doctype html><title>Submitted</title><h1>Submitted</h1>");
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(fixtureHtml());
  });

  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Fixture server did not expose a TCP port.");
  }
  return { server, port: address.port };
}

function fixtureHtml() {
  return `<!doctype html>
    <html lang="ja">
      <head>
        <meta charset="utf-8">
        <title>Scenario Recorder Fixture</title>
        <style>
          body { font-family: system-ui, sans-serif; margin: 32px; }
          main { display: grid; gap: 20px; max-width: 560px; }
          section { display: grid; gap: 12px; padding: 16px; border: 1px solid #ccd5df; }
          label { display: grid; gap: 6px; }
          button, input, select { min-height: 34px; font: inherit; }
        </style>
      </head>
      <body>
        <main>
          <section aria-label="booking">
            <h1>Booking fixture</h1>
            <button id="choose-package" data-testid="choose-package">Choose family package</button>
            <p id="selection-source">Cancellation policy applies to this package.</p>
            <label>
              Traveler name
              <input id="traveler-name" name="travelerName" placeholder="Traveler name">
            </label>
            <label>
              Destination
              <select id="destination" name="destination">
                <option value="tokyo">Tokyo</option>
                <option value="osaka">Osaka</option>
                <option value="okinawa">Okinawa</option>
              </select>
            </label>
            <form action="/submitted" method="get">
              <button id="submit-booking" type="submit">Submit booking</button>
            </form>
            <button id="paused-action">Paused action</button>
            <button id="resume-action">Resume action</button>
          </section>
          <section aria-label="login">
            <h2>Login fixture</h2>
            <label>
              Email
              <input id="login-email" name="email" type="email" placeholder="Email">
            </label>
            <button id="login-submit" type="button">Log in</button>
            <p id="login-result"></p>
          </section>
        </main>
        <script>
          document.querySelector("#login-submit").addEventListener("click", () => {
            document.querySelector("#login-result").textContent =
              "Logged in as " + document.querySelector("#login-email").value;
          });
        </script>
      </body>
    </html>`;
}

function findChrome() {
  const candidates = [
    process.env.CHROME_BIN,
    process.env.GOOGLE_CHROME_BIN,
    "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome-for-testing",
  ].filter(Boolean);

  for (const candidate of candidates) {
    const chromePath = isAbsolute(candidate) ? candidate : resolve(candidate);
    if (existsSync(chromePath)) {
      return chromePath;
    }
  }
  for (const command of ["google-chrome-for-testing", "chromium", "chromium-browser"]) {
    const result = spawnSync("which", [command], { encoding: "utf8" });
    if (result.status === 0) {
      return result.stdout.trim();
    }
  }
  fail("Chrome for Testing or Chromium was not found for extension E2E test. Install Chrome for Testing or set CHROME_BIN to its executable.");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
