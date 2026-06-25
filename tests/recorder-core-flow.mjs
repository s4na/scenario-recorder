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

  const scenarioDefinitions = [
    {
      id: "hono_route_deploy_flow",
      name: "Hono route deploy records repeated button, textarea, and environment select",
      async run() {
        await page.getByTestId("admin-api-route-card").getByRole("button", { name: "Deploy" }).click();
        await page.getByLabel("Release note").fill("Ship admin audit middleware");
        await chooseSelectOption(page, "Environment", 2);
      },
      async assertPageState() {
        const selectedRoute = await page.locator("#selected-route").textContent();
        assert(selectedRoute === "Admin API", `Expected Playwright to deploy Admin API, got ${selectedRoute}.`);
      },
      assertSteps(steps) {
        assertStepTypes(steps, ["click", "fill", "select"]);
        const deployClick = steps.find((step) => step.type === "click");
        assert(
          deployClick?.target?.contextSummary?.heading === "Admin API",
          "Core recorder did not keep the clicked route card heading context.",
        );
        assertSameLabel(deployClick, "Deploy", 2, 2);
        assert(
          steps.some((step) => step.type === "fill" && step.value === "Ship admin audit middleware" && step.target?.label === "Release note"),
          "Core recorder did not record the release note fill with its label.",
        );
        assert(
          steps.some((step) => step.type === "select" && step.value !== undefined),
          "Core recorder did not record a replayable environment select value.",
        );
      },
      assertSpec(specText) {
        assert(
          specText.includes("page.getByRole(\"button\", { name: \"Deploy\" }).nth(1).click()"),
          "Generated Playwright did not disambiguate the repeated Deploy button.",
        );
        assert(
          specText.includes(".fill(\"Ship admin audit middleware\")"),
          "Generated Playwright did not include the release note fill.",
        );
        assert(specText.includes(".selectOption("), "Generated Playwright did not include the environment select.");
      },
    },
    {
      id: "hono_customer_edit_flow",
      name: "Hono customer edit records repeated table button, input, and support select",
      async run() {
        await page.getByTestId("northstar-customer-row").getByRole("button", { name: "Edit" }).click();
        await page.getByLabel("Account alias").fill("northstar-enterprise");
        await chooseSelectOption(page, "Support tier", 2);
      },
      async assertPageState() {
        const selectedCustomer = await page.locator("#selected-customer").textContent();
        assert(selectedCustomer === "Northstar Labs", `Expected Playwright to edit Northstar Labs, got ${selectedCustomer}.`);
      },
      assertSteps(steps) {
        assertStepTypes(steps, ["click", "fill", "select"]);
        const editClick = steps.find((step) => step.type === "click");
        assert(
          editClick?.target?.contextSummary?.nearbyText?.some((text) => text.includes("Northstar Labs")) ||
            editClick?.target?.contextSummary?.heading === "Northstar Labs",
          "Core recorder did not keep row context for the clicked customer Edit button.",
        );
        assertSameLabel(editClick, "Edit", 2, 2);
        assert(
          steps.some((step) => step.type === "fill" && step.value === "northstar-enterprise" && step.target?.label === "Account alias"),
          "Core recorder did not record the account alias fill with its label.",
        );
        assert(
          steps.some((step) => step.type === "select" && step.value !== undefined),
          "Core recorder did not record a replayable support tier select value.",
        );
      },
      assertSpec(specText) {
        assert(
          specText.includes("page.getByRole(\"button\", { name: \"Edit\" }).nth(1).click()"),
          "Generated Playwright did not disambiguate the repeated Edit button.",
        );
        assert(
          specText.includes(".fill(\"northstar-enterprise\")"),
          "Generated Playwright did not include the account alias fill.",
        );
        assert(specText.includes(".selectOption("), "Generated Playwright did not include the support tier select.");
      },
    },
  ];

  for (const definition of scenarioDefinitions) {
    const steps = await recordScenario(page, definition);
    const scenario = createScenario(definition, origin, harnessUrl, steps);
    const specText = await page.evaluate(
      (nextScenario) => window.__scenarioRecorderCoreHarness.toPlaywright(nextScenario),
      scenario,
    );
    definition.assertSpec(specText);
    await runGeneratedPlaywrightSpec(definition.id, specText);
  }
} finally {
  await browser?.close().catch(() => undefined);
  await server?.close().catch(() => undefined);
  rmSync(generatedPlaywrightDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

async function recordScenario(page, definition) {
  await page.evaluate(() => window.__scenarioRecorderCoreHarness.start());
  await definition.run();
  await definition.assertPageState();
  const steps = await page.evaluate(() => window.__scenarioRecorderCoreHarness.stop());
  definition.assertSteps(steps);
  return steps;
}

async function chooseSelectOption(page, label, downCount) {
  await page.getByLabel(label).click();
  for (let index = 0; index < downCount; index += 1) {
    await page.keyboard.press("ArrowDown");
  }
  await page.keyboard.press("Enter");
}

function assertStepTypes(steps, requiredTypes) {
  const missingTypes = requiredTypes.filter((type) => !steps.some((step) => step.type === type));
  assert(
    missingTypes.length === 0,
    `Expected ${requiredTypes.join(", ")} steps, got ${steps.map((step) => step.type).join(",")}.`,
  );
}

function assertSameLabel(step, value, index, count) {
  assert(
    step?.target?.contextSummary?.sameLabel?.value === value &&
      step.target.contextSummary.sameLabel.index === index &&
      step.target.contextSummary.sameLabel.count === count,
    `Core recorder did not mark ${value} as item ${index} of ${count} among repeated controls.`,
  );
}

function createScenario(definition, origin, harnessUrl, steps) {
  return {
    schemaVersion: "scenario-recorder/v1",
    id: definition.id,
    name: definition.name,
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
}

async function runGeneratedPlaywrightSpec(scenarioId, specText) {
  const playwrightCli = resolve("node_modules/@playwright/test/cli.js");
  assert(existsSync(playwrightCli), "Playwright CLI is not installed.");

  const specPath = resolve(generatedPlaywrightDir, `${scenarioId}.spec.ts`);
  const configPath = resolve(generatedPlaywrightDir, `${scenarioId}.config.mjs`);
  writeFileSync(specPath, specText);
  writeFileSync(
    configPath,
    `import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: /${escapeRegExp(scenarioId)}\\.spec\\.ts/,
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
      `Generated recorder-core Playwright spec failed for ${scenarioId}.`,
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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function fail(message) {
  throw new Error(message);
}
