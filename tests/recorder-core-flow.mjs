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
      id: "survey_workspace_signup_and_publish_flow",
      name: "Survey workspace signup records repeated signup button, form fields, and publish flow",
      async run() {
        await page.getByTestId("research-workspace-card").getByRole("button", { name: "Create account" }).click();
        await page.getByLabel("User name").fill("Sana Researcher");
        await page.getByLabel("Work email").fill("sana@example.test");
        await chooseSelectOption(page, "Primary goal", 1);
        await page.getByRole("button", { name: "Continue" }).click();
        await page.getByLabel("Survey title").fill("Onboarding interview");
        await page.getByLabel("Question prompt").fill("What made setup feel easier or harder?");
        await chooseSelectOption(page, "Answer type", 2);
        await page.getByRole("button", { name: "Publish form" }).click();
      },
      async assertPageState() {
        const selectedWorkspace = await page.locator("#selected-workspace").textContent();
        const workspaceOwner = await page.locator("#workspace-owner").textContent();
        const publishedStatus = await page.locator("#published-status").textContent();
        assert(
          selectedWorkspace === "Research workspace",
          `Expected Playwright to select Research workspace, got ${selectedWorkspace}.`,
        );
        assert(
          workspaceOwner === "Sana Researcher's research workspace",
          `Expected workspace owner to be set from signup, got ${workspaceOwner}.`,
        );
        assert(
          publishedStatus === "Onboarding interview is live",
          `Expected survey to be published, got ${publishedStatus}.`,
        );
      },
      assertSteps(steps) {
        assertStepTypes(steps, ["click", "fill", "select"]);
        const createAccountClick = steps.find(
          (step) => step.type === "click" && step.target?.contextSummary?.sameLabel?.value === "Create account",
        );
        assert(
          createAccountClick?.target?.contextSummary?.heading === "Research workspace",
          "Core recorder did not keep the clicked workspace card heading context.",
        );
        assertSameLabel(createAccountClick, "Create account", 2, 2);
        assert(
          steps.some((step) => step.type === "fill" && step.value === "Sana Researcher" && step.target?.label === "User name"),
          "Core recorder did not record the user name fill with its label.",
        );
        assert(
          steps.some(
            (step) =>
              step.type === "fill" &&
              step.value === "What made setup feel easier or harder?" &&
              step.target?.label === "Question prompt",
          ),
          "Core recorder did not record the question prompt textarea fill with its label.",
        );
        assert(
          steps.some((step) => step.type === "select" && step.value === "product-research" && step.target?.label === "Primary goal"),
          "Core recorder did not record a replayable primary goal select value.",
        );
        assert(
          steps.some((step) => step.type === "select" && step.value === "long-text" && step.target?.label === "Answer type"),
          "Core recorder did not record a replayable answer type select value.",
        );
      },
      assertSpec(specText) {
        assert(
          specText.includes("page.getByRole(\"button\", { name: \"Create account\" }).nth(1).click()"),
          "Generated Playwright did not disambiguate the repeated Create account button.",
        );
        assert(
          specText.includes("page.getByLabel(\"User name\").fill(\"Sana Researcher\")"),
          "Generated Playwright did not include the user name fill.",
        );
        assert(
          specText.includes("page.getByLabel(\"Work email\").fill(\"sana@example.test\")"),
          "Generated Playwright did not include the work email fill.",
        );
        assert(
          specText.includes("page.getByLabel(\"Primary goal\").selectOption(\"product-research\")"),
          "Generated Playwright did not include the primary goal select.",
        );
        assert(
          specText.includes("page.getByLabel(\"Survey title\").fill(\"Onboarding interview\")"),
          "Generated Playwright did not include the survey title fill.",
        );
        assert(
          specText.includes("page.getByLabel(\"Question prompt\").fill(\"What made setup feel easier or harder?\")"),
          "Generated Playwright did not include the question prompt textarea fill.",
        );
        assert(
          specText.includes("page.getByLabel(\"Answer type\").selectOption(\"long-text\")"),
          "Generated Playwright did not include the answer type select.",
        );
      },
    },
    {
      id: "survey_response_and_results_flow",
      name: "Survey response records repeated answer button, response fields, and results update",
      async run() {
        await page.getByTestId("product-feedback-form-card").getByRole("button", { name: "Answer" }).click();
        await page.getByLabel("Respondent name").fill("Mina Park");
        await chooseSelectOption(page, "Satisfaction", 2);
        await page.getByLabel("Feedback").fill("The guided setup made the first survey easy to launch.");
        await page.getByRole("button", { name: "Submit answer" }).click();
      },
      async assertPageState() {
        const selectedForm = await page.locator("#selected-form").textContent();
        const responseCount = await page.locator("#response-count").textContent();
        const lastResponse = await page.locator("#last-response").textContent();
        assert(selectedForm === "Product feedback", `Expected Playwright to answer Product feedback, got ${selectedForm}.`);
        assert(responseCount === "1 response", `Expected one recorded response, got ${responseCount}.`);
        assert(lastResponse === "Mina Park submitted very-happy", `Expected last response summary, got ${lastResponse}.`);
      },
      assertSteps(steps) {
        assertStepTypes(steps, ["click", "fill", "select"]);
        const answerClick = steps.find(
          (step) => step.type === "click" && step.target?.contextSummary?.sameLabel?.value === "Answer",
        );
        assert(
          answerClick?.target?.contextSummary?.heading === "Product feedback",
          "Core recorder did not keep the clicked product feedback card heading context.",
        );
        assertSameLabel(answerClick, "Answer", 2, 2);
        assert(
          steps.some((step) => step.type === "fill" && step.value === "Mina Park" && step.target?.label === "Respondent name"),
          "Core recorder did not record the respondent name fill with its label.",
        );
        assert(
          steps.some(
            (step) =>
              step.type === "fill" &&
              step.value === "The guided setup made the first survey easy to launch." &&
              step.target?.label === "Feedback",
          ),
          "Core recorder did not record the feedback textarea fill with its label.",
        );
        assert(
          steps.some((step) => step.type === "select" && step.value === "very-happy" && step.target?.label === "Satisfaction"),
          "Core recorder did not record a replayable satisfaction select value.",
        );
      },
      assertSpec(specText) {
        assert(
          specText.includes("page.getByRole(\"button\", { name: \"Answer\" }).nth(1).click()"),
          "Generated Playwright did not disambiguate the repeated Answer button.",
        );
        assert(
          specText.includes("page.getByLabel(\"Respondent name\").fill(\"Mina Park\")"),
          "Generated Playwright did not include the respondent name fill.",
        );
        assert(
          specText.includes("page.getByLabel(\"Satisfaction\").selectOption(\"very-happy\")"),
          "Generated Playwright did not include the satisfaction select.",
        );
        assert(
          specText.includes("page.getByLabel(\"Feedback\").fill(\"The guided setup made the first survey easy to launch.\")"),
          "Generated Playwright did not include the feedback textarea fill.",
        );
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
