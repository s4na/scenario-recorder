import type { RecorderState, Scenario, ScenarioRecorderSettings } from "./types";

export const STORAGE_KEYS = {
  RECORDER_STATE: "scenarioRecorder.recorderState",
  SCENARIOS: "scenarioRecorder.scenarios",
  SETTINGS: "scenarioRecorder.settings"
} as const;

const DEFAULT_RECORDER_STATE: RecorderState = {
  status: "idle",
  currentSteps: [],
  recordingSessions: []
};

const DEFAULT_SETTINGS: ScenarioRecorderSettings = {
  allowedOrigins: []
};

function getChromeStorage(): chrome.storage.StorageArea {
  return chrome.storage.local;
}

export async function getRecorderState(): Promise<RecorderState> {
  const result = await getChromeStorage().get(STORAGE_KEYS.RECORDER_STATE);
  return {
    ...DEFAULT_RECORDER_STATE,
    ...(result[STORAGE_KEYS.RECORDER_STATE] as RecorderState | undefined)
  };
}

export async function setRecorderState(state: RecorderState): Promise<void> {
  await getChromeStorage().set({ [STORAGE_KEYS.RECORDER_STATE]: state });
}

export async function clearRecorderState(): Promise<void> {
  await setRecorderState(DEFAULT_RECORDER_STATE);
}

export async function getScenarios(): Promise<Scenario[]> {
  const result = await getChromeStorage().get(STORAGE_KEYS.SCENARIOS);
  return (result[STORAGE_KEYS.SCENARIOS] as Scenario[] | undefined) ?? [];
}

export async function saveScenario(scenario: Scenario): Promise<void> {
  const scenarios = await getScenarios();
  const index = scenarios.findIndex((item) => item.id === scenario.id);
  const nextScenarios =
    index >= 0
      ? scenarios.map((item) => (item.id === scenario.id ? scenario : item))
      : [scenario, ...scenarios];
  await getChromeStorage().set({ [STORAGE_KEYS.SCENARIOS]: nextScenarios });
}

export async function deleteScenario(scenarioId: string): Promise<void> {
  const scenarios = await getScenarios();
  await getChromeStorage().set({
    [STORAGE_KEYS.SCENARIOS]: scenarios.filter((scenario) => scenario.id !== scenarioId)
  });
}

export async function getScenario(scenarioId: string): Promise<Scenario | undefined> {
  const scenarios = await getScenarios();
  return scenarios.find((scenario) => scenario.id === scenarioId);
}

export async function importScenarios(scenarios: Scenario[]): Promise<Scenario[]> {
  const current = await getScenarios();
  const currentById = new Map(current.map((scenario) => [scenario.id, scenario]));
  const importedById = new Map<string, Scenario>();
  for (const scenario of scenarios) {
    const existing = importedById.get(scenario.id);
    if (!existing || isSameOrNewerScenario(scenario, existing)) {
      importedById.set(scenario.id, scenario);
    }
  }
  const imported = Array.from(importedById.values()).filter((scenario) => {
    const existing = currentById.get(scenario.id);
    return !existing || isNewerScenario(scenario, existing);
  });
  const importedIds = new Set(imported.map((scenario) => scenario.id));
  const next = [...imported, ...current.filter((scenario) => !importedIds.has(scenario.id))];
  await getChromeStorage().set({ [STORAGE_KEYS.SCENARIOS]: next });
  return next;
}

function isSameOrNewerScenario(candidate: Scenario, current: Scenario): boolean {
  return Date.parse(candidate.updatedAt) >= Date.parse(current.updatedAt);
}

function isNewerScenario(candidate: Scenario, current: Scenario): boolean {
  return Date.parse(candidate.updatedAt) > Date.parse(current.updatedAt);
}

export async function getSettings(): Promise<ScenarioRecorderSettings> {
  const result = await getChromeStorage().get(STORAGE_KEYS.SETTINGS);
  return {
    ...DEFAULT_SETTINGS,
    ...(result[STORAGE_KEYS.SETTINGS] as ScenarioRecorderSettings | undefined)
  };
}

export async function setSettings(settings: ScenarioRecorderSettings): Promise<void> {
  await getChromeStorage().set({ [STORAGE_KEYS.SETTINGS]: settings });
}
