import type { RuntimeMessage } from "../shared/messages";
import {
  clearRecorderState,
  deleteScenario,
  getRecorderState,
  getScenarios,
  saveScenario,
  setRecorderState,
} from "../shared/storage";
import type {
  RecorderState,
  Scenario,
  ScenarioExport,
  ScenarioStep,
} from "../shared/types";
import {
  createId,
  createStepId,
  sanitizeUrl,
  shouldReplaceFillStep,
  toIsoNow,
} from "../shared/utils";

const EXTENSION_VERSION = chrome.runtime.getManifest().version;
const TAB_URLS_STORAGE_KEY = "scenarioRecorder.tabUrls";
let stateMutationQueue: Promise<unknown> = Promise.resolve();
const tabUrls = new Map<number, string>();
const tabUrlsReady = initializeTabUrls();

function enqueueStateMutation<T>(mutation: () => Promise<T>): Promise<T> {
  const next = stateMutationQueue.catch(() => undefined).then(mutation);
  stateMutationQueue = next.catch(() => undefined);
  return next;
}

function withUpdatedStep(
  state: RecorderState,
  step: ScenarioStep,
): RecorderState {
  const currentSteps = [...state.currentSteps];
  const lastStep = currentSteps[currentSteps.length - 1];

  if (isDuplicateNavigationStep(lastStep, step)) {
    return state;
  }

  if (lastStep && shouldReplaceFillStep(lastStep, step)) {
    currentSteps[currentSteps.length - 1] = step;
  } else {
    currentSteps.push(step);
  }

  return { ...state, currentSteps };
}

function isDuplicateNavigationStep(
  previous: ScenarioStep | undefined,
  next: ScenarioStep,
): boolean {
  return (
    previous?.type === "navigation" &&
    next.type === "navigation" &&
    previous.fromUrl === next.fromUrl &&
    previous.toUrl === next.toUrl &&
    Math.abs(previous.timestamp - next.timestamp) < 1000
  );
}

async function startRecording(): Promise<RecorderState> {
  return enqueueStateMutation(async () => {
    const currentState = await getRecorderState();
    if (currentState.status !== "idle") {
      return currentState;
    }
    if (currentState.currentSteps.length > 0) {
      throw new Error(
        "Save or clear the current recording before starting a new one.",
      );
    }
    const now = toIsoNow();
    const state: RecorderState = {
      status: "recording",
      currentSteps: [],
      recordingSessions: [{ startedAt: now }],
      startedAt: now,
    };
    await setRecorderState(state);
    return state;
  });
}

async function pauseRecording(): Promise<RecorderState> {
  return enqueueStateMutation(async () => {
    const now = toIsoNow();
    const state = await getRecorderState();
    if (state.status !== "recording") {
      return state;
    }
    const sessions = [...state.recordingSessions];
    const lastSession = sessions[sessions.length - 1] ?? {};
    sessions[sessions.length - 1] = { ...lastSession, pausedAt: now };
    const nextState = {
      ...state,
      status: "paused" as const,
      pausedAt: now,
      recordingSessions: sessions,
    };
    await setRecorderState(nextState);
    return nextState;
  });
}

async function resumeRecording(): Promise<RecorderState> {
  return enqueueStateMutation(async () => {
    const now = toIsoNow();
    const state = await getRecorderState();
    if (state.status !== "paused") {
      return state;
    }
    const nextState = {
      ...state,
      status: "recording" as const,
      resumedAt: now,
      recordingSessions: [...state.recordingSessions, { resumedAt: now }],
    };
    await setRecorderState(nextState);
    return nextState;
  });
}

async function stopRecording(): Promise<RecorderState> {
  return enqueueStateMutation(async () => {
    const now = toIsoNow();
    const state = await getRecorderState();
    if (state.status === "idle") {
      return state;
    }
    const sessions = [...state.recordingSessions];
    const lastSession = sessions[sessions.length - 1] ?? {};
    sessions[sessions.length - 1] = { ...lastSession, stoppedAt: now };
    const nextState = {
      ...state,
      status: "idle" as const,
      stoppedAt: now,
      recordingSessions: sessions,
    };
    await setRecorderState(nextState);
    return nextState;
  });
}

async function recordStep(
  step: ScenarioStep,
  senderTabId?: number,
): Promise<RecorderState> {
  if (senderTabId !== undefined) {
    await tabUrlsReady;
    await setTabUrl(senderTabId, step.type === "navigation" && step.toUrl ? step.toUrl : step.url);
  }
  return enqueueStateMutation(async () => {
    const state = await getRecorderState();
    if (state.status !== "recording") {
      return state;
    }
    const nextState = withUpdatedStep(state, sanitizeStepUrls(step));
    await setRecorderState(nextState);
    return nextState;
  });
}

async function recordTabNavigation(
  tabId: number,
  toUrl: string,
  title?: string,
): Promise<void> {
  await tabUrlsReady;
  const fromUrl = tabUrls.get(tabId);
  await setTabUrl(tabId, toUrl);
  if (!isHttpUrl(toUrl) || fromUrl === toUrl) {
    return;
  }
  await recordStep({
    id: createStepId(),
    type: "navigation",
    timestamp: Date.now(),
    url: sanitizeUrl(toUrl),
    title,
    fromUrl: sanitizeOptionalUrl(fromUrl),
    toUrl: sanitizeUrl(toUrl),
  });
}

function isHttpUrl(url: string): boolean {
  return url.startsWith("http://") || url.startsWith("https://");
}

async function setTabUrl(tabId: number, url: string): Promise<void> {
  tabUrls.set(tabId, url);
  await saveTabUrls();
}

async function deleteTabUrl(tabId: number): Promise<void> {
  tabUrls.delete(tabId);
  await saveTabUrls();
}

async function saveTabUrls(): Promise<void> {
  const entries = Array.from(tabUrls.entries()).map(([tabId, url]) => [
    String(tabId),
    url,
  ]);
  await chrome.storage.session.set({
    [TAB_URLS_STORAGE_KEY]: Object.fromEntries(entries),
  });
}

async function loadTabUrls(): Promise<void> {
  const stored = await chrome.storage.session.get(TAB_URLS_STORAGE_KEY);
  const value = stored[TAB_URLS_STORAGE_KEY];
  if (!value || typeof value !== "object") {
    return;
  }
  for (const [tabId, url] of Object.entries(value)) {
    if (typeof url === "string") {
      tabUrls.set(Number(tabId), url);
    }
  }
}

function createScenario(name: string, state: RecorderState): Scenario {
  const now = toIsoNow();
  const firstStep = state.currentSteps[0];
  const startUrl = sanitizeOptionalUrl(
    firstStep?.type === "navigation" ? firstStep.toUrl : firstStep?.url,
  );
  const baseUrl = getBaseUrl(startUrl);

  return {
    schemaVersion: "scenario-recorder/v1",
    id: createId("scenario"),
    name,
    description: "",
    tags: [],
    createdAt: now,
    updatedAt: now,
    startUrl,
    baseUrl,
    variables: {},
    recording: {
      sessions: state.recordingSessions,
    },
    steps: state.currentSteps,
    assertions: [],
    metadata: {
      userAgent: navigator.userAgent,
      extensionVersion: EXTENSION_VERSION,
      recordedBy: "scenario-recorder",
    },
  };
}

function getBaseUrl(url: string | undefined): string | undefined {
  if (!url || url.startsWith("about:")) {
    return undefined;
  }
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

async function saveCurrentScenario(
  name: string,
): Promise<{ scenario: Scenario; state: RecorderState }> {
  return enqueueStateMutation(async () => {
    const state = await getRecorderState();
    if (state.status !== "idle") {
      throw new Error("Recording must be stopped before saving a scenario.");
    }
    if (state.currentSteps.length === 0) {
      throw new Error("Cannot save a scenario without recorded steps.");
    }
    const scenario = createScenario(name, state);
    await saveScenario(scenario);
    await clearRecorderState();
    return { scenario, state: await getRecorderState() };
  });
}

async function clearCurrentRecording(): Promise<RecorderState> {
  return enqueueStateMutation(async () => {
    await clearRecorderState();
    return getRecorderState();
  });
}

async function getCurrentRecorderState(): Promise<RecorderState> {
  return enqueueStateMutation(() => getRecorderState());
}

async function deleteStoredScenario(
  scenarioId: string,
): Promise<{ scenarios: Scenario[] }> {
  return enqueueStateMutation(async () => {
    await deleteScenario(scenarioId);
    return { scenarios: await getScenarios() };
  });
}

async function getStoredScenarios(): Promise<{ scenarios: Scenario[] }> {
  return enqueueStateMutation(async () => ({
    scenarios: await getScenarios(),
  }));
}

async function getStoredScenario(
  scenarioId: string,
): Promise<{ scenario?: Scenario }> {
  return enqueueStateMutation(async () => {
    const scenarios = await getScenarios();
    return {
      scenario: scenarios.find((scenario) => scenario.id === scenarioId),
    };
  });
}

async function exportStoredScenarios(): Promise<ScenarioExport> {
  return enqueueStateMutation(async () => ({
    schemaVersion: "scenario-recorder/export/v1",
    exportedAt: toIsoNow(),
    scenarios: await getScenarios(),
  }));
}

function sanitizeStepUrls(step: ScenarioStep): ScenarioStep {
  return {
    ...step,
    url: sanitizeUrl(step.url),
    fromUrl: sanitizeOptionalUrl(step.fromUrl),
    toUrl: sanitizeOptionalUrl(step.toUrl),
  };
}

function sanitizeOptionalUrl(url: string | undefined): string | undefined {
  return url ? sanitizeUrl(url) : undefined;
}

async function handleMessage(
  message: RuntimeMessage,
  sender?: chrome.runtime.MessageSender,
): Promise<unknown> {
  switch (message.type) {
    case "START_RECORDING":
      return startRecording();
    case "PAUSE_RECORDING":
      return pauseRecording();
    case "RESUME_RECORDING":
      return resumeRecording();
    case "STOP_RECORDING":
      return stopRecording();
    case "CLEAR_RECORDING":
      return clearCurrentRecording();
    case "GET_RECORDER_STATE":
      return getCurrentRecorderState();
    case "RECORDED_STEP":
      return recordStep(message.payload.step, sender?.tab?.id);
    case "SAVE_SCENARIO":
      return saveCurrentScenario(message.payload.name);
    case "DELETE_SCENARIO":
      return deleteStoredScenario(message.payload.scenarioId);
    case "GET_SCENARIOS":
      return getStoredScenarios();
    case "EXPORT_SCENARIO":
      return getStoredScenario(message.payload.scenarioId);
    case "EXPORT_ALL_SCENARIOS":
      return exportStoredScenarios();
    default:
      throw new Error("Unsupported message");
  }
}

chrome.runtime.onMessage.addListener(
  (message: RuntimeMessage, sender, sendResponse) => {
    void handleMessage(message, sender)
      .then(sendResponse)
      .catch((error: unknown) => {
        sendResponse({
          error: error instanceof Error ? error.message : String(error),
        });
      });
    return true;
  },
);

async function initializeTabUrls(): Promise<void> {
  await loadTabUrls();
}

chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) {
    return;
  }
  void recordTabNavigation(details.tabId, details.url);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void deleteTabUrl(tabId);
});

void tabUrlsReady;
