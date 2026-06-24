import type { RecordingSession, Scenario, ScenarioStep, SelectorCandidate, SelectorCandidateType, TargetContext, TargetSnapshot } from "./types";

const MASK_VARIABLES: Record<string, { name: string; secret: boolean }> = {
  "{{PASSWORD}}": { name: "password", secret: true },
  "{{SECRET}}": { name: "secret", secret: true },
  "{{CREDIT_CARD}}": { name: "creditCard", secret: true }
};
const MASK_TOKENS = Object.keys(MASK_VARIABLES);
const MASK_PATTERNS = MASK_TOKENS.flatMap((mask) => [mask, encodeURIComponent(mask)]);
const RESERVED_IDENTIFIERS = new Set([
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "import",
  "implements",
  "in",
  "interface",
  "instanceof",
  "let",
  "new",
  "null",
  "package",
  "private",
  "protected",
  "public",
  "return",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "undefined",
  "var",
  "void",
  "while",
  "with",
  "yield"
]);

const SELECTOR_CANDIDATE_TYPES: SelectorCandidateType[] = [
  "data-testid",
  "data-test",
  "data-cy",
  "aria-label",
  "role",
  "label",
  "name",
  "id",
  "placeholder",
  "text",
  "css",
  "xpath"
];

/* oxlint-disable unicorn/no-thenable -- JSON Schema uses the `then` keyword. */
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
    variables: {
      type: "object",
      additionalProperties: {
        type: "object",
        required: ["type"],
        properties: {
          type: { enum: ["string", "number", "boolean"] },
          defaultValue: { oneOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }] },
          secret: { type: "boolean" }
        },
        allOf: [{
          if: { properties: { secret: { const: true } }, required: ["secret", "defaultValue"] },
          then: { properties: { defaultValue: { enum: MASK_TOKENS } } }
        }],
        additionalProperties: true
      }
    },
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
          value: { oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] },
          fromUrl: { type: "string" },
          toUrl: { type: "string" },
          target: {
            type: "object",
            required: ["selectorCandidates", "tagName"],
            properties: {
              selectorCandidates: {
                type: "array",
                items: {
                  type: "object",
                  required: ["type", "value", "confidence"],
                  properties: {
                    type: { enum: SELECTOR_CANDIDATE_TYPES },
                    value: { oneOf: [{ type: "string" }, { type: "object" }] },
                    confidence: { type: "number" }
                  },
                  allOf: [
                    {
                      if: { properties: { type: { const: "role" } } },
                      then: {
                        properties: {
                          value: {
                            type: "object",
                            required: ["role"],
                            properties: {
                              role: { type: "string" },
                              name: { type: "string" }
                            },
                            additionalProperties: true
                          }
                        }
                      }
                    },
                    {
                      if: { properties: { type: { enum: SELECTOR_CANDIDATE_TYPES.filter((type) => type !== "role") } } },
                      then: { properties: { value: { type: "string" } } }
                    }
                  ],
                  additionalProperties: true
                }
              },
              tagName: { type: "string" },
              text: { type: "string" },
              ariaLabel: { type: "string" },
              role: { type: "string" },
              name: { type: "string" },
              id: { type: "string" },
              className: { type: "string" },
              dataTestId: { type: "string" },
              label: { type: "string" },
              placeholder: { type: "string" },
              inputType: { type: "string" },
              rect: {
                type: "object",
                required: ["x", "y", "width", "height"],
                properties: {
                  x: { type: "number" },
                  y: { type: "number" },
                  width: { type: "number" },
                  height: { type: "number" }
                }
              },
              context: {
                type: "array",
                items: {
                  type: "object",
                  required: ["tagName", "relation", "depth"],
                  properties: {
                    tagName: { type: "string" },
                    role: { type: "string" },
                    text: { type: "string" },
                    ariaLabel: { type: "string" },
                    id: { type: "string" },
                    className: { type: "string" },
                    dataTestId: { type: "string" },
                    label: { type: "string" },
                    relation: { enum: ["self", "ancestor"] },
                    depth: { type: "number" }
                  },
                  additionalProperties: true
                }
              },
            },
            additionalProperties: true
          },
          assertion: {
            type: "object",
            required: ["kind", "expected"],
            properties: {
              kind: { enum: ["url", "title"] },
              expected: { type: "string" }
            },
            additionalProperties: true
          }
        },
        allOf: [
          {
            if: { properties: { type: { const: "fill" } } },
            then: { required: ["value"], properties: { value: { type: "string" } } }
          },
          {
            if: { properties: { type: { const: "select" } } },
            then: {
              required: ["value"],
              properties: { value: { oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] } }
            }
          },
          {
            if: { properties: { type: { enum: ["click", "submit", "navigation", "goto", "wait", "assert"] } } },
            then: { not: { required: ["value"] } }
          },
          {
            if: { properties: { type: { const: "assert" } } },
            then: { required: ["assertion"] }
          },
          {
            if: { properties: { type: { enum: ["click", "fill", "select", "submit", "navigation", "goto", "wait"] } } },
            then: { not: { required: ["assertion"] } }
          }
        ],
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
/* oxlint-enable unicorn/no-thenable */

export function scenarioToJsonl(scenario: Scenario): string {
  return scenarioToJsonlLines(scenario).map((line) => JSON.stringify(line)).join("\n");
}

type ScenarioJsonlLine =
  | {
      kind: "meta";
      schemaVersion: "scenario-recorder/jsonl/v1";
      scenarioSchemaVersion: Scenario["schemaVersion"];
      id: string;
      name: string;
      description?: string;
      tags?: string[];
      createdAt: string;
      updatedAt: string;
      startUrl?: string;
      baseUrl?: string;
      variables?: Scenario["variables"];
      metadata: Scenario["metadata"];
    }
  | ({ kind: "session"; index: number } & RecordingSession)
  | ({ kind: "step"; index: number } & Exclude<ScenarioStep, { type: "assert" }>)
  | ({ kind: "assertion"; index: number } & Extract<ScenarioStep, { type: "assert" }>);

function scenarioToJsonlLines(scenario: Scenario): ScenarioJsonlLine[] {
  return [
    {
      kind: "meta",
      schemaVersion: "scenario-recorder/jsonl/v1",
      scenarioSchemaVersion: scenario.schemaVersion,
      id: scenario.id,
      name: scenario.name,
      description: scenario.description,
      tags: scenario.tags,
      createdAt: scenario.createdAt,
      updatedAt: scenario.updatedAt,
      startUrl: scenario.startUrl,
      baseUrl: scenario.baseUrl,
      variables: scenario.variables,
      metadata: scenario.metadata,
    },
    ...scenario.recording.sessions.map((session, index) => ({
      kind: "session" as const,
      index,
      ...session,
    })),
    ...scenario.steps.map((step, index): ScenarioJsonlLine => {
      if (step.type === "assert") {
        return { kind: "assertion", index, ...step };
      }
      return { kind: "step", index, ...step };
    }),
  ];
}

export type PlaywrightGenerationOptions = {
  allowedOrigins?: string[];
};

export function scenarioToPlaywright(scenario: Scenario, options: PlaywrightGenerationOptions = {}): string {
  const allowedOrigins = options.allowedOrigins ?? [];
  const context = createPlaywrightContext(scenario, allowedOrigins);
  assertAllowedSecretPlayback(scenario, context, allowedOrigins);
  const lines = [
    "import { test, expect } from '@playwright/test';",
    ""
  ];
  if (context.variableDeclarations.length > 0) {
    lines.push(
      "function getRequiredEnv(name: string): string {",
      "  const value = process.env[name];",
      "  if (!value) {",
      "    throw new Error(`Missing required environment variable: ${name}`);",
      "  }",
      "  return value;",
      "}",
      ""
    );
  }
  if (context.maskExpressions.size > 0) {
    lines.push(
      `const allowedOrigins = new Set(${JSON.stringify(context.allowedOrigins)});`,
      "",
      "async function assertAllowedOrigin(page: import('@playwright/test').Page): Promise<void> {",
      "  const origin = new URL(page.url()).origin;",
      "  expect(allowedOrigins.has(origin), `Current origin is outside target domains: ${origin}`).toBe(true);",
      "}",
      ""
    );
  }
  lines.push(
    `test(${JSON.stringify(scenario.name)}, async ({ page }) => {`
  );
  lines.push(...context.variableDeclarations.map((declaration) => `  ${declaration}`));
  if (scenario.startUrl) {
    lines.push(`  await page.goto(${JSON.stringify(scenario.startUrl)});`);
  }
  for (const [index, step] of scenario.steps.entries()) {
    lines.push(...stepToPlaywright(step, scenario.steps[index - 1], context));
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
        const existing = variables[variable.name];
        if (value.includes(mask) && (!existing || (existing.secret && existing.defaultValue === undefined))) {
          variables[variable.name] = {
            ...existing,
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

export function parseScenarioImportText(text: string): Scenario[] {
  try {
    return parseScenarioImport(JSON.parse(text) as unknown);
  } catch (jsonError) {
    try {
      return [parseScenarioJsonl(text)];
    } catch (jsonlError) {
      if (text.split(/\r?\n/).filter((line) => line.trim()).length > 1) {
        throw jsonlError instanceof Error ? jsonlError : new Error("シナリオJSONLを読み込めませんでした。");
      }
      throw jsonError instanceof Error ? jsonError : new Error("シナリオを読み込めませんでした。");
    }
  }
}

function parseScenarioJsonl(text: string): Scenario {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as unknown);
  const [meta, ...events] = lines;
  if (!isScenarioJsonlMeta(meta)) {
    throw new Error("scenario-recorder/jsonl/v1 の先頭meta行を含むJSONLを選択してください。");
  }
  const sessions: RecordingSession[] = [];
  const steps: ScenarioStep[] = [];
  for (const [offset, event] of events.entries()) {
    const lineNumber = offset + 2;
    if (isScenarioJsonlSession(event)) {
      const { kind: _kind, index: _index, ...session } = event;
      sessions.push(session);
      continue;
    }
    if (isScenarioJsonlStep(event)) {
      const { kind: _kind, index: _index, ...step } = event;
      steps.push(step);
      continue;
    }
    throw new Error(`scenario-recorder/jsonl/v1 の${lineNumber}行目が不正です。`);
  }
  return normalizeScenario({
    schemaVersion: "scenario-recorder/v1",
    id: meta.id,
    name: meta.name,
    description: meta.description,
    tags: meta.tags,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    startUrl: meta.startUrl,
    baseUrl: meta.baseUrl,
    variables: meta.variables,
    recording: { sessions },
    steps,
    assertions: [],
    metadata: meta.metadata,
  });
}

type PlaywrightContext = {
  allowedOrigins: string[];
  maskExpressions: Map<string, string>;
  secretExpressions: Set<string>;
  variableDeclarations: string[];
};

function createPlaywrightContext(scenario: Scenario, allowedOrigins: string[]): PlaywrightContext {
  const maskExpressions = new Map<string, string>();
  const secretExpressions = new Set<string>();
  const variableDeclarations: string[] = [];
  const usedIdentifiers = new Set<string>();
  const usedEnvNames = new Set<string>();
  for (const [name, variable] of Object.entries(scenario.variables ?? {})) {
    if (typeof variable.defaultValue !== "string" || !variable.secret) {
      continue;
    }
    if (!(variable.defaultValue in MASK_VARIABLES)) {
      continue;
    }
    const identifier = toUniqueIdentifier(name, usedIdentifiers);
    const envName = toUniqueEnvName(name, usedEnvNames);
    maskExpressions.set(variable.defaultValue, identifier);
    secretExpressions.add(identifier);
    variableDeclarations.push(`const ${identifier} = getRequiredEnv(${JSON.stringify(envName)});`);
  }
  return { allowedOrigins, maskExpressions, secretExpressions, variableDeclarations };
}

function assertAllowedSecretPlayback(
  scenario: Scenario,
  context: PlaywrightContext,
  allowedOrigins: string[],
): void {
  if (context.maskExpressions.size === 0) {
    return;
  }
  if (allowedOrigins.length === 0) {
    throw new Error("Set target domains before generating Playwright with secret variables.");
  }
  const blockedUrl = scenarioUrls(scenario).find((url) => !isAllowedOrigin(url, allowedOrigins));
  if (blockedUrl) {
    throw new Error(`Cannot generate Playwright with secret variables for an outside target domain: ${blockedUrl}`);
  }
}

function scenarioUrls(scenario: Scenario): string[] {
  return [
    scenario.startUrl,
    scenario.baseUrl,
    ...scenario.steps.flatMap((step) => [
      step.url,
      step.fromUrl,
      step.toUrl,
      step.assertion?.kind === "url" ? step.assertion.expected : undefined,
    ]),
  ].filter((url): url is string => typeof url === "string" && url.length > 0);
}

function isAllowedOrigin(url: string, allowedOrigins: string[]): boolean {
  try {
    return allowedOrigins.includes(new URL(url).origin);
  } catch {
    return false;
  }
}

function stepToPlaywright(step: ScenarioStep, previousStep: ScenarioStep | undefined, context: PlaywrightContext): string[] {
  if (step.type === "navigation") {
    const url = step.toUrl ?? step.url;
    if (previousStep && isNavigationTrigger(previousStep)) {
      return [`  await page.waitForURL(${JSON.stringify(url)});`];
    }
    return [`  await page.goto(${JSON.stringify(url)});`];
  }
  if (step.type === "goto") {
    return [`  await page.goto(${JSON.stringify(step.toUrl ?? step.url)});`];
  }
  if (step.type === "wait") {
    return ['  await page.waitForLoadState("networkidle");'];
  }
  if (step.type === "assert") {
    if (step.assertion?.kind === "url") {
      return [`  await expect(page).toHaveURL(${urlAssertionExpression(step.assertion.expected)});`];
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
    const expression = valueToPlaywrightExpression(step.value ?? "", context);
    return [
      ...originGuardForExpression(expression, context),
      `  await ${selector}.fill(${expression});`
    ];
  }
  if (step.type === "select") {
    const expression = valueToPlaywrightExpression(step.value ?? "", context);
    return [
      ...originGuardForExpression(expression, context),
      `  await ${selector}.selectOption(${expression});`
    ];
  }
  if (step.type === "submit") {
    return [`  await ${selector}.evaluate((element) => element instanceof HTMLFormElement ? element.requestSubmit() : element.closest('form')?.requestSubmit());`];
  }
  return [`  // Unsupported ${step.type} step`];
}

function isNavigationTrigger(step: ScenarioStep): boolean {
  return step.type === "click" || step.type === "submit";
}

function originGuardForExpression(expression: string, context: PlaywrightContext): string[] {
  return [...context.secretExpressions].some((secretExpression) => expression.includes(secretExpression))
    ? ["  await assertAllowedOrigin(page);"]
    : [];
}

function urlAssertionExpression(expected: string): string {
  if (!MASK_PATTERNS.some((mask) => expected.includes(mask))) {
    return JSON.stringify(expected);
  }
  let source = escapeRegExp(expected);
  for (const mask of MASK_PATTERNS) {
    source = source.replaceAll(escapeRegExp(mask), "[^/?#&]+");
  }
  return `new RegExp(${JSON.stringify(`^${source}$`)})`;
}

function valueToPlaywrightExpression(value: string | string[], context: PlaywrightContext): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stringToPlaywrightExpression(item, context)).join(", ")}]`;
  }
  return stringToPlaywrightExpression(value, context);
}

function stringToPlaywrightExpression(value: string, context: PlaywrightContext): string {
  const exactExpression = context.maskExpressions.get(value);
  if (exactExpression) {
    return exactExpression;
  }
  if (![...context.maskExpressions.keys()].some((mask) => value.includes(mask))) {
    return JSON.stringify(value);
  }
  const parts: string[] = [];
  let rest = value;
  while (rest.length > 0) {
    const nextMask = [...context.maskExpressions.keys()]
      .map((mask) => ({ mask, index: rest.indexOf(mask) }))
      .filter((item) => item.index >= 0)
      .sort((first, second) => first.index - second.index)[0];
    if (!nextMask) {
      parts.push(escapeTemplateLiteral(rest));
      break;
    }
    parts.push(escapeTemplateLiteral(rest.slice(0, nextMask.index)));
    parts.push(`\${${context.maskExpressions.get(nextMask.mask)}}`);
    rest = rest.slice(nextMask.index + nextMask.mask.length);
  }
  return `\`${parts.join("")}\``;
}

function toUniqueIdentifier(name: string, usedIdentifiers: Set<string>): string {
  const identifier = name.replace(/[^A-Za-z0-9_$]/g, "_").replace(/^[^A-Za-z_$]/, "_");
  const base = identifier && !RESERVED_IDENTIFIERS.has(identifier) ? identifier : `${identifier || "secretValue"}Value`;
  let candidate = base;
  let suffix = 2;
  while (usedIdentifiers.has(candidate) || RESERVED_IDENTIFIERS.has(candidate)) {
    candidate = `${base}_${suffix}`;
    suffix += 1;
  }
  usedIdentifiers.add(candidate);
  return candidate;
}

function toEnvName(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/[^A-Za-z0-9]+/g, "_").toUpperCase();
}

function toUniqueEnvName(name: string, usedEnvNames: Set<string>): string {
  const base = toEnvName(name) || "SECRET_VALUE";
  let candidate = base;
  let suffix = 2;
  while (usedEnvNames.has(candidate)) {
    candidate = `${base}_${suffix}`;
    suffix += 1;
  }
  usedEnvNames.add(candidate);
  return candidate;
}

function escapeTemplateLiteral(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

function isScenarioJsonlMeta(value: unknown): value is Extract<ScenarioJsonlLine, { kind: "meta" }> {
  if (!isPlainObject(value)) {
    return false;
  }
  return (
    value.kind === "meta" &&
    value.schemaVersion === "scenario-recorder/jsonl/v1" &&
    value.scenarioSchemaVersion === "scenario-recorder/v1" &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    isIsoDateString(value.createdAt) &&
    isIsoDateString(value.updatedAt) &&
    isOptionalString(value.description) &&
    isOptionalString(value.startUrl) &&
    isOptionalString(value.baseUrl) &&
    isOptionalStringArray(value.tags) &&
    isOptionalVariables(value.variables) &&
    isMetadata(value.metadata)
  );
}

function isScenarioJsonlSession(value: unknown): value is Extract<ScenarioJsonlLine, { kind: "session" }> {
  return (
    isPlainObject(value) &&
    value.kind === "session" &&
    typeof value.index === "number" &&
    isOptionalIsoDateString(value.startedAt) &&
    isOptionalIsoDateString(value.pausedAt) &&
    isOptionalIsoDateString(value.resumedAt) &&
    isOptionalIsoDateString(value.stoppedAt)
  );
}

function isScenarioJsonlStep(value: unknown): value is Extract<ScenarioJsonlLine, { kind: "step" | "assertion" }> {
  if (!isPlainObject(value) || (value.kind !== "step" && value.kind !== "assertion") || typeof value.index !== "number") {
    return false;
  }
  const { kind: _kind, index: _index, ...step } = value;
  if (_kind === "assertion" && step.type !== "assert") {
    return false;
  }
  if (_kind === "step" && step.type === "assert") {
    return false;
  }
  return isScenarioStep(step);
}

function normalizeScenario(value: unknown): Scenario {
  if (!isScenario(value)) {
    throw new Error("scenario-recorder/v1 のJSONを選択してください。");
  }
  return withDerivedSecretVariables({
    schemaVersion: value.schemaVersion,
    id: value.id,
    name: value.name,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    startUrl: value.startUrl,
    baseUrl: value.baseUrl,
    variables: value.variables ?? {},
    recording: value.recording,
    steps: value.steps,
    assertions: value.assertions ?? [],
    tags: value.tags ?? [],
    description: value.description ?? "",
    metadata: value.metadata
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
    isOptionalVariables(scenario.variables) &&
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
    isValidStepValueForType(step.type, step.value) &&
    isValidStepAssertionForType(step.type, step.assertion) &&
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

function isValidStepValueForType(type: ScenarioStep["type"], value: unknown): boolean {
  if (type === "fill") {
    return typeof value === "string";
  }
  if (type === "select") {
    return typeof value === "string" || (Array.isArray(value) && value.every((item) => typeof item === "string"));
  }
  return value === undefined;
}

function isValidStepAssertionForType(type: ScenarioStep["type"], value: unknown): boolean {
  if (type === "assert") {
    return isStepAssertion(value);
  }
  return value === undefined;
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
    target.selectorCandidates.every(isSelectorCandidate) &&
    (target.context === undefined ||
      (Array.isArray(target.context) && target.context.every(isTargetContext)))
  );
}

function isTargetContext(value: unknown): value is TargetContext {
  if (!isPlainObject(value)) {
    return false;
  }
  return (
    typeof value.tagName === "string" &&
    (value.relation === "self" || value.relation === "ancestor") &&
    typeof value.depth === "number" &&
    isOptionalString(value.role) &&
    isOptionalString(value.text) &&
    isOptionalString(value.ariaLabel) &&
    isOptionalString(value.id) &&
    isOptionalString(value.className) &&
    isOptionalString(value.dataTestId) &&
    isOptionalString(value.label)
  );
}

function isSelectorCandidate(value: unknown): value is SelectorCandidate {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<SelectorCandidate>;
  if (!isSelectorCandidateType(candidate.type) || typeof candidate.confidence !== "number") {
    return false;
  }
  if (candidate.type === "role") {
    return candidate.value !== undefined && isRoleValue(candidate.value);
  }
  return typeof candidate.value === "string";
}

function isSelectorCandidateType(value: unknown): value is SelectorCandidateType {
  return typeof value === "string" && SELECTOR_CANDIDATE_TYPES.includes(value as SelectorCandidateType);
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

function isOptionalVariables(value: unknown): value is Scenario["variables"] | undefined {
  return value === undefined || (isPlainObject(value) && Object.values(value).every(isScenarioVariable));
}

function isScenarioVariable(value: unknown): boolean {
  if (!isPlainObject(value)) {
    return false;
  }
  if (value.secret === true && value.defaultValue !== undefined && !MASK_TOKENS.includes(String(value.defaultValue))) {
    return false;
  }
  return (
    (value.type === "string" || value.type === "number" || value.type === "boolean") &&
    (value.defaultValue === undefined ||
      typeof value.defaultValue === "string" ||
      typeof value.defaultValue === "number" ||
      typeof value.defaultValue === "boolean") &&
    (value.secret === undefined || typeof value.secret === "boolean")
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIsoDateString(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isOptionalIsoDateString(value: unknown): value is string | undefined {
  return value === undefined || isIsoDateString(value);
}
