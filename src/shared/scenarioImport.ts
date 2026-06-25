import { MASK_TOKENS, SELECTOR_CANDIDATE_TYPES } from "./scenarioConstants";
import type { ScenarioJsonlLine } from "./scenarioJsonl";
import { withDerivedSecretVariables } from "./secretVariables";
import type { RecordingSession, Scenario, ScenarioStep, SelectorCandidate, SelectorCandidateType, TargetContext, TargetSnapshot } from "./types";

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
      return parseScenarioJsonls(text);
    } catch (jsonlError) {
      if (text.split(/\r?\n/).filter((line) => line.trim()).length > 1) {
        throw jsonlError instanceof Error ? jsonlError : new Error("記録JSONLを読み込めませんでした。");
      }
      throw jsonError instanceof Error ? jsonError : new Error("記録を読み込めませんでした。");
    }
  }
}

function parseScenarioJsonls(text: string): Scenario[] {
  const groups = splitScenarioJsonlGroups(text);
  if (groups.length === 0) {
    throw new Error("scenario-recorder/jsonl/v1 の先頭meta行を含むJSONLを選択してください。");
  }
  return groups.map((group) => parseScenarioJsonl(group.join("\n")));
}

function splitScenarioJsonlGroups(text: string): string[][] {
  const groups: string[][] = [];
  let current: string[] = [];
  for (const line of text.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
    const value = JSON.parse(line) as unknown;
    if (isScenarioJsonlMeta(value)) {
      if (current.length > 0) {
        groups.push(current);
      }
      current = [line];
      continue;
    }
    if (current.length === 0) {
      throw new Error("scenario-recorder/jsonl/v1 の先頭meta行を含むJSONLを選択してください。");
    }
    current.push(line);
  }
  if (current.length > 0) {
    groups.push(current);
  }
  return groups;
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
    assertions: meta.assertions,
    metadata: meta.metadata,
  });
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
    isOptionalArray(value.assertions) &&
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
    throw new Error("scenario-recorder/v1 の記録JSONを選択してください。");
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
    (step.target === undefined || isTargetSnapshot(step.target)) &&
    (step.submitter === undefined || isTargetSnapshot(step.submitter))
  );
}

function isScenarioStepType(value: unknown): value is ScenarioStep["type"] {
  return (
    value === "click" ||
    value === "fill" ||
    value === "select" ||
    value === "selection" ||
    value === "submit" ||
    value === "navigation" ||
    value === "goto" ||
    value === "wait" ||
    value === "assert"
  );
}

function isValidStepValueForType(type: ScenarioStep["type"], value: unknown): boolean {
  if (type === "fill" || type === "selection") {
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

function isRoleValue(value: SelectorCandidate["value"]): value is { role: string; name?: string } {
  return typeof value === "object" && value !== null && "role" in value && typeof value.role === "string";
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
