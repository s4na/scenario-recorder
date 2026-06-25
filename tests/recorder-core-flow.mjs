import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import { createServer as createViteServer } from "vite";

const generatedPlaywrightDir = mkdtempSync(resolve(".tmp-recorder-core-playwright-"));
let browser;
let server;

try {
  server = await createViteServer({
    root: process.cwd(),
    logLevel: "error",
    server: {
      host: "127.0.0.1",
      port: 0,
      strictPort: false,
    },
  });
  await server.listen();
  const origin = server.resolvedUrls?.local[0]?.replace(/\/$/, "");
  assert(origin, "Vite server did not expose a local URL.");
  const harnessUrl = `${origin}/tests/recorder-core-harness.html`;

  browser = await chromium.launch({
    executablePath: findChrome(),
    headless: true,
    args: ["--disable-dev-shm-usage", "--no-sandbox"],
  });
  const page = await browser.newPage();
  await page.goto(harnessUrl, { waitUntil: "domcontentloaded" });

  await page.evaluate(() => window.__scenarioRecorderCoreHarness.start());
  await page.getByTestId("pro-plan-card").getByRole("button", { name: "Choose" }).click();
  await page.getByLabel("Traveler name").fill("Sana Tester");
  await page.getByLabel("Destination").click();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  const selectedPlan = await page.locator("#selected-plan").textContent();
  const steps = await page.evaluate(() => window.__scenarioRecorderCoreHarness.stop());

  assert(selectedPlan === "Pro plan", `Expected Playwright to choose the Pro plan, got ${selectedPlan}.`);
  assert(
    steps.some((step) => step.type === "click") &&
      steps.some((step) => step.type === "fill") &&
      steps.some((step) => step.type === "select"),
    `Expected click, fill, and select steps, got ${steps.map((step) => step.type).join(",")}.`,
  );
  const planClick = steps.find((step) => step.type === "click");
  assert(
    planClick?.target?.contextSummary?.heading === "Pro plan",
    "Core recorder did not keep the clicked card heading context.",
  );
  assert(
    planClick?.target?.contextSummary?.sameLabel?.value === "Choose" &&
      planClick.target.contextSummary.sameLabel.index === 2 &&
      planClick.target.contextSummary.sameLabel.count === 2,
    "Core recorder did not mark the clicked button among repeated controls.",
  );
  assert(
    steps.some((step) => step.type === "fill" && step.value === "Sana Tester" && step.target?.label === "Traveler name"),
    "Core recorder did not record the traveler name fill with its label.",
  );
  assert(
    steps.some((step) => step.type === "select" && step.value === "okinawa" && step.target?.label === "Destination"),
    "Core recorder did not record the destination select with its label.",
  );

  const scenario = {
    schemaVersion: "scenario-recorder/v1",
    id: "recorder_core_flow",
    name: "recorder-core-flow",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    startUrl: harnessUrl,
    baseUrl: origin,
    variables: {},
    recording: { sessions: [] },
    steps,
    assertions: [],
    metadata: {
      recordedBy: "scenario-recorder",
      extensionVersion: "0.1.0",
      userAgent: "playwright",
    },
  };
  const specText = await page.evaluate(
    (nextScenario) => window.__scenarioRecorderCoreHarness.toPlaywright(nextScenario),
    scenario,
  );
  assert(
    specText.includes("page.getByRole(\"button\", { name: \"Choose\" }).nth(1).click()"),
    "Generated Playwright did not disambiguate the repeated Choose button.",
  );
  await runGeneratedPlaywrightSpec(specText);
} finally {
  await browser?.close().catch(() => undefined);
  await server?.close().catch(() => undefined);
  rmSync(generatedPlaywrightDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

async function runGeneratedPlaywrightSpec(specText) {
  const playwrightCli = resolve("node_modules/@playwright/test/cli.js");
  assert(existsSync(playwrightCli), "Playwright CLI is not installed.");

  const specPath = resolve(generatedPlaywrightDir, "generated.spec.ts");
  const configPath = resolve(generatedPlaywrightDir, "playwright.config.mjs");
  writeFileSync(specPath, specText);
  writeFileSync(
    configPath,
    `import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: /generated\\.spec\\.ts/,
  workers: 1,
  reporter: [["line"]],
  use: {
    browserName: "chromium",
    headless: true,
    launchOptions: {
      executablePath: process.env.CHROME_BIN,
      args: ["--disable-dev-shm-usage", "--no-sandbox"],
    },
  },
});
`,
  );

  const result = await runCommand(process.execPath, [playwrightCli, "test", "--config", configPath], {
    cwd: generatedPlaywrightDir,
    env: {
      ...process.env,
      CHROME_BIN: findChrome(),
    },
    timeout: 120_000,
  });

  assert(
    result.status === 0,
    [
      "Generated recorder-core Playwright spec failed.",
      result.signal ? `Signal: ${result.signal}` : undefined,
      result.stdout ? `STDOUT:\n${result.stdout}` : undefined,
      result.stderr ? `STDERR:\n${result.stderr}` : undefined,
    ]
      .filter(Boolean)
      .join("\n\n"),
  );
}

function runCommand(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
    }, options.timeout);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (status, signal) => {
      clearTimeout(timeout);
      resolve({ status, signal, stdout, stderr });
    });
  });
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
    "/usr/bin/google-chrome",
  ].filter(Boolean);
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    fail(`Chrome executable was not found. Checked: ${candidates.join(", ")}`);
  }
  return found;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function fail(message) {
  throw new Error(message);
}
