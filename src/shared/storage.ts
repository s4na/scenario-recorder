import type { RecorderState, Scenario } from "./types";

export const STORAGE_KEYS = {
  RECORDER_STATE: "scenarioRecorder.recorderState",
  SCENARIOS: "scenarioRecorder.scenarios"
} as const;

const DEFAULT_RECORDER_STATE: RecorderState = {
  status: "idle",
  currentSteps: [],
  recordingSessions: []
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
