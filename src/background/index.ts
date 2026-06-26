import type { RuntimeMessage } from "../shared/messages";
import {
  clearRecorderState,
  deleteScenario,
  getRecorderState,
  getScenarios,
  getSettings,
  importScenarios,
  saveScenario,
  setRecorderState,
  setSettings,
} from "../shared/storage";
import type {
  RecorderState,
  RecordingOverlayState,
  Scenario,
  ScenarioExport,
  ScenarioRecorderSettings,
  ScenarioStep,
} from "../shared/types";
import {
  createId,
  createStepId,
  formatTimestampForScenarioName,
  getPrimarySelectorKey,
  sanitizeUrl,
  shouldReplaceFillStep,
  toIsoNow,
} from "../shared/utils";
import { withDerivedSecretVariables } from "../shared/secretVariables";

const EXTENSION_VERSION = chrome.runtime.getManifest().version;
const TAB_URLS_STORAGE_KEY = "scenarioRecorder.tabUrls";
let stateMutationQueue: Promise<unknown> = Promise.resolve();
let tabUrlsSaveQueue: Promise<unknown> = Promise.resolve();
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
  const currentSteps = [...state.currentSteps, step].sort(
    (first, second) => first.timestamp - second.timestamp,
  );

  replaceAdjacentFillSteps(currentSteps);
  removeAdjacentDuplicateNavigationSteps(currentSteps);
  removeAdjacentSubmitterClicks(currentSteps);

  return { ...state, currentSteps };
}

function replaceAdjacentFillSteps(steps: ScenarioStep[]): void {
  for (let index = 1; index < steps.length; index += 1) {
    if (shouldReplaceFillStep(steps[index - 1], steps[index])) {
      steps.splice(index - 1, 1);
      index -= 1;
    }
  }
}

function removeAdjacentDuplicateNavigationSteps(steps: ScenarioStep[]): void {
  for (let index = 1; index < steps.length; index += 1) {
    if (isDuplicateNavigationStep(steps[index - 1], steps[index])) {
      steps.splice(index, 1);
      index -= 1;
    }
  }
}

function removeAdjacentSubmitterClicks(steps: ScenarioStep[]): void {
  for (let index = 1; index < steps.length; index += 1) {
    if (isSubmitterClick(steps[index - 1], steps[index])) {
      steps.splice(index - 1, 1);
      index -= 1;
    }
  }
}

function isSubmitterClick(previous: ScenarioStep, next: ScenarioStep): boolean {
  return (
    previous.type === "click" &&
    next.type === "submit" &&
    targetSnapshotsMatch(previous.target, next.submitter)
  );
}

function targetSnapshotsMatch(
  first: ScenarioStep["target"],
  second: ScenarioStep["target"],
): boolean {
  if (!first || !second) {
    return false;
  }
  const firstSelector = getPrimarySelectorKey(first);
  const secondSelector = getPrimarySelectorKey(second);
  if (firstSelector && secondSelector) {
    return firstSelector === secondSelector;
  }
  return (
    (first.id !== undefined && first.id === second.id) ||
    (first.name !== undefined && first.name === second.name) ||
    (first.dataTestId !== undefined && first.dataTestId === second.dataTestId)
  );
}

function isDuplicateNavigationStep(
  previous: ScenarioStep,
  next: ScenarioStep,
): boolean {
  return (
    previous.type === "navigation" &&
    next.type === "navigation" &&
    previous.fromUrl === next.fromUrl &&
    previous.toUrl === next.toUrl &&
    Math.abs(previous.timestamp - next.timestamp) < 1000
  );
}

async function startRecording(): Promise<RecorderState> {
  return enqueueStateMutation(async () => {
    const currentState = await getRecorderState();
    const settings = await getSettings();
    if (currentState.status !== "idle") {
      return currentState;
    }
    if (currentState.currentSteps.length > 0) {
      throw new Error(
        "Save or clear the current recording before starting a new one.",
      );
    }
    const activeTab = await seedActiveTabUrl();
    if (!isAllowedBySettings(activeTab?.url, settings)) {
      throw new Error("The active tab is outside the configured target origins.");
    }
    const recorderReady = await injectRecorderIntoTab(activeTab);
    if (!recorderReady) {
      throw new Error("Open an HTTP or HTTPS page before starting recording.");
    }
    const now = toIsoNow();
    const state: RecorderState = {
      status: "recording",
      currentSteps: [],
      recordingSessions: [{ startedAt: now }],
      startedAt: now,
      startedAtMs: Date.now(),
      startUrl: sanitizeOptionalUrl(activeTab?.url),
      targetTabId: activeTab?.id,
      targetWindowId: activeTab?.windowId,
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
      startedAtMs: Date.now(),
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
  await tabUrlsReady;
  return enqueueStateMutation(async () => {
    const state = await getRecorderState();
    const settings = await getSettings();
    if (
      state.status !== "recording" ||
      (senderTabId !== undefined && state.targetTabId !== senderTabId) ||
      !isAllowedBySettings(step.type === "navigation" ? step.toUrl ?? step.url : step.url, settings) ||
      !isAllowedSenderTab(step, senderTabId, settings)
    ) {
      return state;
    }
    if (senderTabId !== undefined) {
      await updateTabUrlFromStep(senderTabId, step);
    }
    const nextState = withUpdatedStep(state, sanitizeStepUrls(step));
    await setRecorderState(nextState);
    return nextState;
  });
}

async function updateTabUrlFromStep(
  tabId: number,
  step: ScenarioStep,
): Promise<void> {
  const nextUrl = step.type === "navigation" && step.toUrl ? step.toUrl : step.url;
  const currentUrl = tabUrls.get(tabId);
  if (
    step.type !== "navigation" &&
    currentUrl &&
    currentUrl !== nextUrl &&
    step.url !== currentUrl
  ) {
    return;
  }
  await setTabUrl(tabId, nextUrl);
}

async function recordTabNavigation(
  tabId: number,
  toUrl: string,
  title?: string,
  timestamp = Date.now(),
): Promise<void> {
  await tabUrlsReady;
  const sanitizedToUrl = sanitizeUrl(toUrl);
  const fromUrl = tabUrls.get(tabId);
  if (!isHttpUrl(toUrl) || fromUrl === sanitizedToUrl) {
    await setTabUrl(tabId, sanitizedToUrl);
    return;
  }
  const state = await getRecorderState();
  const settings = await getSettings();
  if (
    state.status !== "recording" ||
    state.targetTabId !== tabId ||
    timestamp < getActiveSessionStartedAtMs(state)
  ) {
    await setTabUrl(tabId, sanitizedToUrl);
    return;
  }
  if (!isAllowedBySettings(sanitizedToUrl, settings)) {
    await deleteTabUrl(tabId);
    return;
  }
  await recordStep({
    id: createStepId(),
    type: "navigation",
    timestamp,
    url: sanitizedToUrl,
    title,
    fromUrl: sanitizeOptionalUrl(fromUrl),
    toUrl: sanitizedToUrl,
  }, tabId);
}

function getActiveSessionStartedAtMs(state: RecorderState): number {
  return state.startedAtMs ?? 0;
}

function isHttpUrl(url: string): boolean {
  return url.startsWith("http://") || url.startsWith("https://");
}

function isAllowedBySettings(url: string | undefined, settings: ScenarioRecorderSettings): boolean {
  if (settings.allowedOrigins.length === 0) {
    return true;
  }
  if (!url) {
    return false;
  }
  try {
    return settings.allowedOrigins.includes(new URL(url).origin);
  } catch {
    return false;
  }
}

function isAllowedSenderTab(
  step: ScenarioStep,
  senderTabId: number | undefined,
  settings: ScenarioRecorderSettings,
): boolean {
  if (settings.allowedOrigins.length === 0 || senderTabId === undefined || step.type === "navigation") {
    return true;
  }
  return isAllowedBySettings(tabUrls.get(senderTabId), settings);
}

async function setTabUrl(tabId: number, url: string): Promise<void> {
  tabUrls.set(tabId, sanitizeUrl(url));
  await enqueueTabUrlsSave();
}

async function deleteTabUrl(tabId: number): Promise<void> {
  tabUrls.delete(tabId);
  await enqueueTabUrlsSave();
}

async function seedActiveTabUrl(): Promise<chrome.tabs.Tab | undefined> {
  await tabUrlsReady;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id !== undefined && tab.url) {
    await setTabUrl(tab.id, tab.url);
  }
  return tab;
}

async function injectRecorderIntoTab(tab: chrome.tabs.Tab | undefined): Promise<boolean> {
  if (tab?.id === undefined || !tab.url || !isHttpUrl(tab.url)) {
    return false;
  }
  if (await isRecorderContentAvailable(tab.id)) {
    return true;
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["assets/mainWorldNavigation.js"],
      world: "MAIN",
    });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["assets/content.js"],
    });
    return true;
  } catch (error) {
    console.warn("Scenario Recorder could not inject into the active tab.", error);
    return false;
  }
}

async function isRecorderContentAvailable(tabId: number): Promise<boolean> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "FLUSH_PENDING_INPUTS" });
    return true;
  } catch {
    return false;
  }
}

async function saveTabUrls(): Promise<void> {
  const entries = Array.from(tabUrls.entries()).map(([tabId, url]) => [
    String(tabId),
    sanitizeUrl(url),
  ]);
  await chrome.storage.session.set({
    [TAB_URLS_STORAGE_KEY]: Object.fromEntries(entries),
  });
}

function enqueueTabUrlsSave(): Promise<void> {
  const next = tabUrlsSaveQueue.catch(() => undefined).then(saveTabUrls);
  tabUrlsSaveQueue = next.catch(() => undefined);
  return next;
}

async function loadTabUrls(): Promise<void> {
  const stored = await chrome.storage.session.get(TAB_URLS_STORAGE_KEY);
  const value = stored[TAB_URLS_STORAGE_KEY];
  if (!value || typeof value !== "object") {
    return;
  }
  for (const [tabId, url] of Object.entries(value)) {
    if (typeof url === "string") {
      tabUrls.set(Number(tabId), sanitizeUrl(url));
    }
  }
}

function createScenario(name: string, state: RecorderState): Scenario {
  const now = toIsoNow();
  const startUrl = getRecordingStartUrl(state);
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

function getRecordingStartUrl(state: RecorderState): string | undefined {
  if (state.startUrl) {
    return sanitizeOptionalUrl(state.startUrl);
  }
  const firstStep = state.currentSteps[0];
  return sanitizeOptionalUrl(
    firstStep?.type === "navigation" ? firstStep.toUrl : firstStep?.url,
  );
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
    const state = closeRecordingForSave(await getRecorderState());
    if (state.currentSteps.length === 0) {
      throw new Error("Cannot save a scenario without recorded steps.");
    }
    const scenarioName =
      name.trim() ||
      formatTimestampForScenarioName(new Date(), getRecordingStartUrl(state));
    const scenario = withDerivedSecretVariables(createScenario(scenarioName, state));
    await saveScenario(scenario);
    await clearRecorderState();
    return { scenario, state: await getRecorderState() };
  });
}

function closeRecordingForSave(state: RecorderState): RecorderState {
  if (state.status === "idle") {
    return state;
  }
  const now = toIsoNow();
  const sessions = [...state.recordingSessions];
  const lastSession = sessions[sessions.length - 1];
  if (lastSession) {
    sessions[sessions.length - 1] = { ...lastSession, stoppedAt: lastSession.stoppedAt ?? now };
  } else {
    sessions.push({ stoppedAt: now });
  }
  return {
    ...state,
    status: "idle",
    stoppedAt: state.stoppedAt ?? now,
    recordingSessions: sessions,
  };
}

async function updateStoredScenario(
  update: { scenarioId: string; name: string; description: string; tags: string[] },
): Promise<{ scenarios: Scenario[] }> {
  return enqueueStateMutation(async () => {
    const existing = (await getScenarios()).find((scenario) => scenario.id === update.scenarioId);
    if (!existing) {
      throw new Error("Scenario not found.");
    }
    await saveScenario({
      ...existing,
      name: update.name,
      description: update.description,
      tags: update.tags,
      updatedAt: toIsoNow(),
    });
    return { scenarios: await getScenarios() };
  });
}

async function importStoredScenarios(
  scenarios: Scenario[],
): Promise<{ scenarios: Scenario[] }> {
  return enqueueStateMutation(async () => ({
    scenarios: await importScenarios(
      scenarios.map((scenario) => ({
        ...withDerivedSecretVariables(scenario),
      })),
    ),
  }));
}

async function addAssertionStep(kind: "url" | "title"): Promise<RecorderState> {
  await tabUrlsReady;
  return enqueueStateMutation(async () => {
    const state = await getRecorderState();
    if (state.status === "idle") {
      throw new Error("Recording must be active or paused before adding an assertion.");
    }
    const tabId = state.targetTabId;
    if (tabId === undefined) {
      throw new Error("No target tab is associated with the current recording.");
    }
    const tab = await chrome.tabs.get(tabId);
    const rawUrl = tab.url ?? tabUrls.get(tabId) ?? "about:blank";
    const url = sanitizeUrl(rawUrl);
    if (!isAllowedBySettings(url, await getSettings())) {
      throw new Error("The target tab is outside the configured target origins.");
    }
    const expected = kind === "url" ? url : tab.title ?? "";
    const nextState = withUpdatedStep(state, {
      id: createStepId(),
      type: "assert",
      timestamp: Date.now(),
      url,
      title: tab.title,
      assertion: { kind, expected },
    });
    await setRecorderState(nextState);
    return nextState;
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

function getExecutableScenarioStartUrl(scenario: Scenario): string {
  const firstStep = scenario.steps[0];
  const url = scenario.startUrl ?? (firstStep?.type === "navigation" ? firstStep.toUrl : firstStep?.url);
  if (!url || !isHttpUrl(url)) {
    throw new Error("Scenario does not have an HTTP or HTTPS start URL.");
  }
  return url;
}

async function waitForTabReady(tabId: number): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === "complete") {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Timed out waiting for the scenario tab to load.");
}

async function sendScenarioStep(tabId: number, step: ScenarioStep): Promise<void> {
  const response = await chrome.tabs.sendMessage(tabId, {
    type: "EXECUTE_SCENARIO_STEP",
    payload: { step },
  });
  if (response && typeof response === "object" && "error" in response) {
    throw new Error(String(response.error));
  }
}

async function previewScenarioStepNavigation(
  tabId: number,
  step: ScenarioStep,
): Promise<string | undefined> {
  const response = await chrome.tabs.sendMessage(tabId, {
    type: "PREVIEW_SCENARIO_STEP",
    payload: { step },
  });
  if (response && typeof response === "object" && "error" in response) {
    throw new Error(String(response.error));
  }
  if (
    response &&
    typeof response === "object" &&
    "navigationUrl" in response &&
    typeof response.navigationUrl === "string"
  ) {
    return response.navigationUrl;
  }
  return undefined;
}

async function executeStoredScenario(scenarioId: string): Promise<{ ok: true; scenario: Scenario }> {
  return enqueueStateMutation(async () => {
    const currentState = await getRecorderState();
    if (currentState.status !== "idle") {
      throw new Error("Stop the current recording before running a scenario.");
    }
    const scenario = (await getScenarios()).find((item) => item.id === scenarioId);
    if (!scenario) {
      throw new Error("Scenario not found.");
    }
    const settings = await getSettings();
    const startUrl = getExecutableScenarioStartUrl(scenario);
    assertScenarioUrlAllowed(startUrl, settings);
    const tab = await chrome.tabs.create({ active: true, url: startUrl });
    if (tab.id === undefined) {
      throw new Error("Could not open a tab for the scenario.");
    }
    await waitForTabReady(tab.id);
    await assertTabUrlAllowed(tab.id, settings);
    if (!await injectRecorderIntoTab(await chrome.tabs.get(tab.id))) {
      throw new Error("Could not prepare the scenario tab.");
    }
    let previousStep: ScenarioStep | undefined;
    for (const step of scenario.steps) {
      if (step.type === "navigation" || step.type === "goto") {
        const nextUrl = step.type === "navigation" ? step.toUrl ?? step.url : step.url;
        if (nextUrl && isHttpUrl(nextUrl)) {
          assertScenarioUrlAllowed(nextUrl, settings);
          if (previousStep && isNavigationTrigger(previousStep)) {
            await waitForTabUrl(tab.id, nextUrl);
          } else {
            await chrome.tabs.update(tab.id, { url: nextUrl });
          }
          await waitForTabReady(tab.id);
          await assertTabUrlAllowed(tab.id, settings);
          await injectRecorderIntoTab(await chrome.tabs.get(tab.id));
        }
        previousStep = step;
        continue;
      }
      await assertTabUrlAllowed(tab.id, settings);
      const navigationUrl = await previewScenarioStepNavigation(tab.id, step);
      if (navigationUrl && isHttpUrl(navigationUrl)) {
        assertScenarioUrlAllowed(navigationUrl, settings);
      }
      await sendScenarioStep(tab.id, step);
      await waitForPossibleStepNavigation(tab.id, settings);
      previousStep = step;
    }
    return { ok: true, scenario };
  });
}

async function waitForTabUrl(tabId: number, expectedUrl: string): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (sameUrl((await chrome.tabs.get(tabId)).url, expectedUrl)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for the scenario tab to reach ${expectedUrl}.`);
}

function sameUrl(actualUrl: string | undefined, expectedUrl: string): boolean {
  if (!actualUrl) {
    return false;
  }
  try {
    return new URL(actualUrl).href === new URL(expectedUrl).href;
  } catch {
    return actualUrl === expectedUrl;
  }
}

function isNavigationTrigger(step: ScenarioStep): boolean {
  return step.type === "click" || step.type === "submit";
}

async function waitForPossibleStepNavigation(
  tabId: number,
  settings: ScenarioRecorderSettings,
): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 150));
  await waitForTabReady(tabId);
  await assertTabUrlAllowed(tabId, settings);
}

async function assertTabUrlAllowed(
  tabId: number,
  settings: ScenarioRecorderSettings,
): Promise<void> {
  assertScenarioUrlAllowed(await getTabHttpUrl(tabId), settings);
}

async function getTabHttpUrl(tabId: number): Promise<string> {
  const url = (await chrome.tabs.get(tabId)).url;
  if (!url || !isHttpUrl(url)) {
    throw new Error("Scenario tab is not on an HTTP or HTTPS URL.");
  }
  return url;
}

function assertScenarioUrlAllowed(
  url: string,
  settings: ScenarioRecorderSettings,
): void {
  if (!isAllowedBySettings(url, settings)) {
    throw new Error("Scenario URL is outside the configured target origins.");
  }
}

async function getStoredSettings(): Promise<ScenarioRecorderSettings> {
  return getSettings();
}

async function updateStoredSettings(
  settings: ScenarioRecorderSettings,
): Promise<ScenarioRecorderSettings> {
  const normalized = {
    allowedOrigins: Array.from(new Set(settings.allowedOrigins.map(normalizeOrigin).filter(Boolean))),
    recordingDetailLevel: "context" as const,
  };
  await setSettings(normalized);
  return normalized;
}

function normalizeOrigin(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  const candidate = trimmed.includes("://") ? trimmed : `https://${trimmed}`;
  try {
    const origin = new URL(candidate).origin;
    return origin === "null" ? "" : origin;
  } catch {
    return "";
  }
}

async function isRecordingTarget(
  tab: chrome.tabs.Tab | undefined,
): Promise<{ recording: boolean; recordingDetailLevel: ScenarioRecorderSettings["recordingDetailLevel"] }> {
  const tabId = tab?.id;
  const settings = await getSettings();
  if (tabId === undefined) {
    return { recording: false, recordingDetailLevel: settings.recordingDetailLevel };
  }
  const state = await getRecorderState();
  const url = tab?.url ?? tabUrls.get(tabId);
  return {
    recording: state.status === "recording" && state.targetTabId === tabId && isAllowedBySettings(url, settings),
    recordingDetailLevel: settings.recordingDetailLevel,
  };
}

async function getRecordingOverlayState(
  tab: chrome.tabs.Tab | undefined,
): Promise<RecordingOverlayState | { visible: false }> {
  const tabId = tab?.id;
  if (tabId === undefined) {
    return { visible: false };
  }
  const state = await getRecorderState();
  const settings = await getSettings();
  const url = tab?.url ?? tabUrls.get(tabId);
  if (
    (state.status !== "recording" && state.status !== "paused") ||
    state.targetTabId !== tabId ||
    !isAllowedBySettings(url, settings)
  ) {
    return { visible: false };
  }
  const lastStep = state.currentSteps.at(-1);
  return {
    visible: true,
    status: state.status,
    stepCount: state.currentSteps.length,
    lastStepType: lastStep?.type,
    currentUrl: sanitizeOptionalUrl(url),
    recentSteps: state.currentSteps.slice(-6),
  };
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
    case "IS_RECORDING_TARGET":
      return isRecordingTarget(sender?.tab);
    case "GET_RECORDING_OVERLAY_STATE":
      return getRecordingOverlayState(sender?.tab);
    case "RECORDED_STEP":
      return recordStep(message.payload.step, sender?.tab?.id);
    case "SAVE_SCENARIO":
      return saveCurrentScenario(message.payload.name);
    case "UPDATE_SCENARIO":
      return updateStoredScenario(message.payload);
    case "IMPORT_SCENARIOS":
      return importStoredScenarios(message.payload.scenarios);
    case "ADD_ASSERTION_STEP":
      return addAssertionStep(message.payload.kind);
    case "DELETE_SCENARIO":
      return deleteStoredScenario(message.payload.scenarioId);
    case "GET_SCENARIOS":
      return getStoredScenarios();
    case "EXPORT_SCENARIO":
      return getStoredScenario(message.payload.scenarioId);
    case "EXPORT_ALL_SCENARIOS":
      return exportStoredScenarios();
    case "EXECUTE_SCENARIO":
      return executeStoredScenario(message.payload.scenarioId);
    case "GET_SETTINGS":
      return getStoredSettings();
    case "UPDATE_SETTINGS":
      return updateStoredSettings(message.payload);
    default:
      throw new Error("Unsupported message");
  }
}

function handleRuntimeMessage(
  message: RuntimeMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
): true {
  void handleMessage(message, sender)
    .then(sendResponse)
    .catch((error: unknown) => {
      sendResponse({
        error: error instanceof Error ? error.message : String(error),
      });
    });
  return true;
}

chrome.runtime.onMessage.addListener(handleRuntimeMessage);

async function initializeTabUrls(): Promise<void> {
  await loadTabUrls();
}

const handleCommittedNavigation: Parameters<typeof chrome.webNavigation.onCommitted.addListener>[0] = (details) => {
  if (details.frameId !== 0) {
    return;
  }
  void recordTabNavigation(details.tabId, details.url).catch((error: unknown) => {
    console.warn("Scenario Recorder failed to record tab navigation.", error);
  });
};

chrome.webNavigation.onCommitted.addListener(handleCommittedNavigation);

function handleRemovedTab(tabId: number): void {
  void deleteTabUrl(tabId);
}

chrome.tabs.onRemoved.addListener(handleRemovedTab);

void tabUrlsReady;
