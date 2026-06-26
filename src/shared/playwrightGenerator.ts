import { MASK_ENV_NAMES, MASK_PATTERNS, RESERVED_IDENTIFIERS } from "./scenarioConstants";
import type { Scenario, ScenarioStep, SelectorCandidate, TargetSnapshot } from "./types";

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
      "  expect(allowedOrigins.has(origin), `Current origin is outside target origins: ${origin}`).toBe(true);",
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
  for (const [name, variable] of Object.entries(scenario.variables ?? {})) {
    if (typeof variable.defaultValue !== "string" || !variable.secret) {
      continue;
    }
    const envName = MASK_ENV_NAMES[variable.defaultValue];
    if (!envName || maskExpressions.has(variable.defaultValue)) {
      continue;
    }
    const identifier = toUniqueIdentifier(name, usedIdentifiers);
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
    throw new Error("Set target origins before generating Playwright with secret variables.");
  }
  const blockedUrl = scenarioUrls(scenario).find((url) => !isAllowedOrigin(url, allowedOrigins));
  if (blockedUrl) {
    throw new Error(`Cannot generate Playwright with secret variables for an outside target origin: ${blockedUrl}`);
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
  if (step.type === "selection") {
    return [
      `  await expect(page.getByText(${textAssertionExpression(step.value)})).toBeVisible();`
    ];
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
    const submitterSelector = targetToLocator(step.submitter);
    if (submitterSelector) {
      return [`  await ${submitterSelector}.click();`];
    }
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

function textAssertionExpression(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  const snippet = normalized.length > 80 ? normalized.slice(0, 80).trim() : normalized;
  if (!snippet) {
    return JSON.stringify(value);
  }
  const source = escapeRegExp(snippet).replace(/\s+/g, "\\s+");
  return `new RegExp(${JSON.stringify(source)})`;
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
  for (const candidate of sortLocatorCandidates(target.selectorCandidates, target.tagName)) {
    const locator = candidateToLocator(candidate);
    if (locator) {
      return disambiguateLocator(locator, candidate, target);
    }
  }
  return undefined;
}

function sortLocatorCandidates(candidates: SelectorCandidate[], tagName: string): SelectorCandidate[] {
  if (!["input", "select", "textarea"].includes(tagName.toLowerCase())) {
    return candidates;
  }
  const priority = new Map<SelectorCandidate["type"], number>([
    ["label", 0],
    ["aria-label", 1],
    ["data-testid", 2],
    ["data-test", 3],
    ["data-cy", 4],
    ["placeholder", 5],
    ["role", 6],
    ["id", 7],
    ["name", 8],
    ["css", 9],
    ["xpath", 10],
    ["text", 11],
  ]);
  return [...candidates].sort(
    (first, second) =>
      (priority.get(first.type) ?? Number.MAX_SAFE_INTEGER) -
      (priority.get(second.type) ?? Number.MAX_SAFE_INTEGER)
  );
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

function disambiguateLocator(
  locator: string,
  candidate: SelectorCandidate,
  target: TargetSnapshot,
): string {
  const sameLabel = target.contextSummary?.sameLabel;
  if (!sameLabel || sameLabel.count <= 1 || sameLabel.index <= 0) {
    return locator;
  }
  if (!candidateMatchesSameLabel(candidate, sameLabel.value)) {
    return locator;
  }
  return `${locator}.nth(${sameLabel.index - 1})`;
}

function candidateMatchesSameLabel(candidate: SelectorCandidate, value: string): boolean {
  if (["aria-label", "label"].includes(candidate.type) && typeof candidate.value === "string") {
    return candidate.value === value;
  }
  return (
    candidate.type === "role" &&
    isRoleValue(candidate.value) &&
    candidate.value.name === value
  );
}

function cssEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function isRoleValue(value: SelectorCandidate["value"]): value is { role: string; name?: string } {
  return typeof value === "object" && value !== null && "role" in value && typeof value.role === "string";
}
