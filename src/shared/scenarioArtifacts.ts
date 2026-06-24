import type { Scenario, ScenarioStep, SelectorCandidate, TargetSnapshot } from "./types";

const MASK_VARIABLES: Record<string, { name: string; secret: boolean }> = {
  "{{PASSWORD}}": { name: "password", secret: true },
  "{{SECRET}}": { name: "secret", secret: true },
  "{{CREDIT_CARD}}": { name: "creditCard", secret: true }
};

export const SCENARIO_JSON_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://s4na.github.io/scenario-recorder/schema/scenario-recorder-v1.json",
  title: "Scenario Recorder Scenario",
  type: "object",
  required: ["schemaVersion", "id", "name", "createdAt", "updatedAt", "recording", "steps", "metadata"],
  properties: {
    schemaVersion: { const: "scenario-recorder/v1" },
    id: { type: "string" },
    name: { type: "string" },
    description: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
    startUrl: { type: "string" },
    baseUrl: { type: "string" },
    variables: { type: "object" },
    recording: {
      type: "object",
      required: ["sessions"],
      properties: {
        sessions: { type: "array" }
      }
    },
    steps: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "type", "timestamp", "url"],
        properties: {
          id: { type: "string" },
          type: { enum: ["click", "fill", "select", "submit", "navigation", "goto", "wait", "assert"] },
          timestamp: { type: "number" },
          url: { type: "string" },
          title: { type: "string" },
          value: {},
          fromUrl: { type: "string" },
          toUrl: { type: "string" },
          target: { type: "object" },
          assertion: { type: "object" }
        },
        additionalProperties: true
      }
    },
    assertions: { type: "array" },
    metadata: {
      type: "object",
      required: ["userAgent", "extensionVersion", "recordedBy"],
      properties: {
        userAgent: { type: "string" },
        extensionVersion: { type: "string" },
        recordedBy: { const: "scenario-recorder" }
      }
    }
  },
  additionalProperties: false
} as const;

export function scenarioToJsonl(scenario: Scenario): string {
  return scenario.steps.map((step) => JSON.stringify(step)).join("\n");
}

export function scenarioToPlaywright(scenario: Scenario): string {
  const lines = [
    "import { test, expect } from '@playwright/test';",
    "",
    `test(${JSON.stringify(scenario.name)}, async ({ page }) => {`
  ];
  if (scenario.startUrl) {
    lines.push(`  await page.goto(${JSON.stringify(scenario.startUrl)});`);
  }
  for (const step of scenario.steps) {
    lines.push(...stepToPlaywright(step));
  }
  lines.push("});", "");
  return lines.join("\n");
}

export function withDerivedSecretVariables(scenario: Scenario): Scenario {
  const variables = { ...scenario.variables };
  for (const step of scenario.steps) {
    const values = Array.isArray(step.value) ? step.value : [step.value];
    for (const value of values) {
      if (typeof value !== "string") {
        continue;
      }
      for (const [mask, variable] of Object.entries(MASK_VARIABLES)) {
        if (value.includes(mask) && !variables[variable.name]) {
          variables[variable.name] = {
            type: "string",
            defaultValue: mask,
            secret: variable.secret
          };
        }
      }
    }
  }
  return { ...scenario, variables };
}

export function parseScenarioImport(value: unknown): Scenario[] {
  if (isScenarioExport(value)) {
    return value.scenarios.map(normalizeScenario);
  }
  if (Array.isArray(value)) {
    return value.map(normalizeScenario);
  }
  return [normalizeScenario(value)];
}

function stepToPlaywright(step: ScenarioStep): string[] {
  if (step.type === "navigation") {
    const url = step.toUrl ?? step.url;
    return [`  await page.waitForURL(${JSON.stringify(url)});`];
  }
  if (step.type === "assert") {
    if (step.assertion?.kind === "url") {
      return [`  await expect(page).toHaveURL(${JSON.stringify(step.assertion.expected)});`];
    }
    if (step.assertion?.kind === "title") {
      return [`  await expect(page).toHaveTitle(${JSON.stringify(step.assertion.expected)});`];
    }
    return ["  // Unsupported assertion step"];
  }
  const selector = targetToLocator(step.target);
  if (!selector) {
    return [`  // Skipped ${step.type}: no selector candidate`];
  }
  if (step.type === "click") {
    return [`  await ${selector}.click();`];
  }
  if (step.type === "fill") {
    return [`  await ${selector}.fill(${JSON.stringify(String(step.value ?? ""))});`];
  }
  if (step.type === "select") {
    return [`  await ${selector}.selectOption(${JSON.stringify(step.value ?? "")});`];
  }
  if (step.type === "submit") {
    return [`  await ${selector}.evaluate((element) => element instanceof HTMLFormElement ? element.requestSubmit() : element.closest('form')?.requestSubmit());`];
  }
  return [`  // Unsupported ${step.type} step`];
}

function targetToLocator(target: TargetSnapshot | undefined): string | undefined {
  if (!target || !Array.isArray(target.selectorCandidates)) {
    return undefined;
  }
  for (const candidate of target.selectorCandidates) {
    const locator = candidateToLocator(candidate);
    if (locator) {
      return locator;
    }
  }
  return undefined;
}

function candidateToLocator(candidate: SelectorCandidate): string | undefined {
  if (candidate.type === "role" && isRoleValue(candidate.value)) {
    const options = candidate.value.name ? `, { name: ${JSON.stringify(candidate.value.name)} }` : "";
    return `page.getByRole(${JSON.stringify(candidate.value.role)}${options})`;
  }
  if (candidate.type === "aria-label") {
    return `page.getByLabel(${JSON.stringify(String(candidate.value))})`;
  }
  if (candidate.type === "label") {
    return `page.getByLabel(${JSON.stringify(String(candidate.value))})`;
  }
  if (candidate.type === "placeholder") {
    return `page.getByPlaceholder(${JSON.stringify(String(candidate.value))})`;
  }
  if (candidate.type === "text") {
    return `page.getByText(${JSON.stringify(String(candidate.value))})`;
  }
  if (candidate.type === "data-testid") {
    return `page.getByTestId(${JSON.stringify(String(candidate.value))})`;
  }
  if (candidate.type === "data-test" || candidate.type === "data-cy") {
    return `page.locator(${JSON.stringify(`[${candidate.type}="${cssEscape(String(candidate.value))}"]`)})`;
  }
  if (candidate.type === "id") {
    return `page.locator(${JSON.stringify(`[id="${cssEscape(String(candidate.value))}"]`)})`;
  }
  if (candidate.type === "name") {
    return `page.locator(${JSON.stringify(`[name="${cssEscape(String(candidate.value))}"]`)})`;
  }
  if (candidate.type === "css" || candidate.type === "xpath") {
    return `page.locator(${JSON.stringify(String(candidate.value))})`;
  }
  return undefined;
}

function cssEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function isRoleValue(value: SelectorCandidate["value"]): value is { role: string; name?: string } {
  return typeof value === "object" && value !== null && "role" in value && typeof value.role === "string";
}

function isScenarioExport(value: unknown): value is { schemaVersion: "scenario-recorder/export/v1"; scenarios: unknown[] } {
  return (
    typeof value === "object" &&
    value !== null &&
    "schemaVersion" in value &&
    value.schemaVersion === "scenario-recorder/export/v1" &&
    "scenarios" in value &&
    Array.isArray(value.scenarios)
  );
}

function normalizeScenario(value: unknown): Scenario {
  if (!isScenario(value)) {
    throw new Error("scenario-recorder/v1 のJSONを選択してください。");
  }
  return withDerivedSecretVariables({
    ...value,
    variables: value.variables ?? {},
    assertions: value.assertions ?? [],
    tags: value.tags ?? [],
    description: value.description ?? ""
  });
}

function isScenario(value: unknown): value is Scenario {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const scenario = value as Record<string, unknown>;
  return (
    "schemaVersion" in value &&
    value.schemaVersion === "scenario-recorder/v1" &&
    "id" in value &&
    typeof value.id === "string" &&
    "name" in value &&
    typeof value.name === "string" &&
    "createdAt" in value &&
    isIsoDateString(value.createdAt) &&
    "updatedAt" in value &&
    isIsoDateString(value.updatedAt) &&
    "recording" in value &&
    isRecording(value.recording) &&
    "metadata" in value &&
    isMetadata(value.metadata) &&
    "steps" in value &&
    Array.isArray(value.steps) &&
    value.steps.every(isScenarioStep) &&
    isOptionalString(scenario.description) &&
    isOptionalString(scenario.startUrl) &&
    isOptionalString(scenario.baseUrl) &&
    isOptionalStringArray(scenario.tags) &&
    isOptionalPlainObject(scenario.variables) &&
    isOptionalArray(scenario.assertions)
  );
}

function isScenarioStep(value: unknown): value is ScenarioStep {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const step = value as Partial<ScenarioStep>;
  return (
    typeof step.id === "string" &&
    isScenarioStepType(step.type) &&
    typeof step.timestamp === "number" &&
    typeof step.url === "string" &&
    isValidStepValue(step.value) &&
    (step.assertion === undefined || isStepAssertion(step.assertion)) &&
    (step.target === undefined || isTargetSnapshot(step.target))
  );
}

function isScenarioStepType(value: unknown): value is ScenarioStep["type"] {
  return (
    value === "click" ||
    value === "fill" ||
    value === "select" ||
    value === "submit" ||
    value === "navigation" ||
    value === "goto" ||
    value === "wait" ||
    value === "assert"
  );
}

function isValidStepValue(value: unknown): boolean {
  return (
    value === undefined ||
    typeof value === "string" ||
    (Array.isArray(value) && value.every((item) => typeof item === "string"))
  );
}

function isStepAssertion(value: unknown): value is NonNullable<ScenarioStep["assertion"]> {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const assertion = value as Partial<NonNullable<ScenarioStep["assertion"]>>;
  return (
    (assertion.kind === "url" || assertion.kind === "title") &&
    typeof assertion.expected === "string"
  );
}

function isTargetSnapshot(value: unknown): value is TargetSnapshot {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const target = value as Partial<TargetSnapshot>;
  return (
    typeof target.tagName === "string" &&
    Array.isArray(target.selectorCandidates) &&
    target.selectorCandidates.every(isSelectorCandidate)
  );
}

function isSelectorCandidate(value: unknown): value is SelectorCandidate {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<SelectorCandidate>;
  return (
    typeof candidate.type === "string" &&
    (typeof candidate.value === "string" ||
      (typeof candidate.value === "object" && candidate.value !== null)) &&
    typeof candidate.confidence === "number"
  );
}

function isRecording(value: unknown): value is Scenario["recording"] {
  return (
    typeof value === "object" &&
    value !== null &&
    "sessions" in value &&
    Array.isArray(value.sessions)
  );
}

function isMetadata(value: unknown): value is Scenario["metadata"] {
  return (
    typeof value === "object" &&
    value !== null &&
    "userAgent" in value &&
    typeof value.userAgent === "string" &&
    "extensionVersion" in value &&
    typeof value.extensionVersion === "string" &&
    "recordedBy" in value &&
    value.recordedBy === "scenario-recorder"
  );
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function isOptionalStringArray(value: unknown): value is string[] | undefined {
  return value === undefined || (Array.isArray(value) && value.every((item) => typeof item === "string"));
}

function isOptionalArray(value: unknown): value is unknown[] | undefined {
  return value === undefined || Array.isArray(value);
}

function isOptionalPlainObject(value: unknown): value is Record<string, unknown> | undefined {
  return value === undefined || (typeof value === "object" && value !== null && !Array.isArray(value));
}

function isIsoDateString(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}
