import type { ScenarioStep } from "../shared/types";
import { maskValue } from "./masking";
import { createTargetSnapshot } from "./selector";

type StepHandler = (step: ScenarioStep) => void | Promise<void>;
type FlushOptions = {
  throwOnError?: boolean;
};
type StepContext = {
  url: string;
  title: string;
};
type PendingInput = {
  timer: number;
  context: StepContext;
  sequence: number;
  step: ScenarioStep;
};
type PendingFillSend = {
  element: HTMLInputElement | HTMLTextAreaElement;
  sequence: number;
  step: ScenarioStep;
};

const INPUT_DEBOUNCE_MS = 300;
const pendingInputs = new Map<
  HTMLInputElement | HTMLTextAreaElement,
  PendingInput
>();
let lastClickSignature = "";
let lastClickTimestamp = 0;
let cachedRecording = false;
let pendingInputSequence = 0;
const replayedClicks = new WeakSet<HTMLElement>();
const replayedSubmits = new WeakSet<HTMLFormElement>();

function createStepId(): string {
  const random = crypto.getRandomValues(new Uint32Array(2));
  return `step_${Date.now().toString(36)}_${Array.from(random)
    .map((value) => value.toString(36))
    .join("")}`;
}

function updateCachedRecording(state: unknown): void {
  const recorderState = (
    state as Record<string, { status?: string } | undefined>
  )["scenarioRecorder.recorderState"];
  cachedRecording = recorderState?.status === "recording";
}

function initializeRecordingCache(): void {
  void chrome.storage.local
    .get("scenarioRecorder.recorderState")
    .then(updateCachedRecording);
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes["scenarioRecorder.recorderState"]) {
      return;
    }
    updateCachedRecording({
      "scenarioRecorder.recorderState":
        changes["scenarioRecorder.recorderState"].newValue,
    });
  });
}

function isRecording(): boolean {
  return cachedRecording;
}

function sanitizeUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.username = "";
    url.password = "";
    for (const key of Array.from(url.searchParams.keys())) {
      if (isSecretUrlKey(key)) {
        url.searchParams.set(key, "{{SECRET}}");
      }
    }
    url.pathname = sanitizePath(url.pathname);
    const hash = sanitizeHash(url.hash);
    if (hash !== url.hash) {
      url.hash = hash;
    }
    return url.toString();
  } catch {
    return rawUrl;
  }
}

function isSecretUrlKey(key: string): boolean {
  const normalized = normalizeUrlKey(key);
  return [
    "access_token",
    "api_key",
    "apikey",
    "auth",
    "authorization",
    "client_secret",
    "code",
    "credential",
    "id_token",
    "key",
    "otp",
    "password",
    "refresh_token",
    "secret",
    "session",
    "signature",
    "state",
    "ticket",
    "token",
  ].some(
    (secretKey) =>
      normalized === secretKey || normalized.endsWith(`_${secretKey}`),
  );
}

function normalizeUrlKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[-.]/g, "_");
}

const SECRET_PATH_MARKERS = [
  "auth",
  "confirm",
  "confirmation",
  "invite",
  "invitation",
  "magic-link",
  "magic_link",
  "password",
  "reset",
  "reset-password",
  "reset_password",
  "session",
  "ticket",
  "token",
  "verify",
  "verification",
];

function sanitizeHash(hash: string): string {
  if (!hash) {
    return hash;
  }
  const rawHash = hash.slice(1);
  const queryIndex = rawHash.indexOf("?");
  const hashPath = queryIndex >= 0 ? rawHash.slice(0, queryIndex) : rawHash;
  if (shouldRedactHashPath(hashPath)) {
    return "#{{SECRET}}";
  }
  const paramText = queryIndex >= 0 ? rawHash.slice(queryIndex + 1) : rawHash;
  if (!paramText.includes("=")) {
    return hash;
  }
  const hashParams = new URLSearchParams(paramText);
  let changed = false;
  for (const key of Array.from(hashParams.keys())) {
    if (isSecretUrlKey(key)) {
      hashParams.set(key, "{{SECRET}}");
      changed = true;
    }
  }
  if (!changed) {
    return hash;
  }
  return queryIndex >= 0
    ? `#${rawHash.slice(0, queryIndex)}?${hashParams.toString()}`
    : `#${hashParams.toString()}`;
}

function sanitizePath(pathname: string): string {
  const segments = pathname.split("/");
  let redactingTail = false;
  return segments
    .map((segment) => {
      if (!segment) {
        return segment;
      }
      if (redactingTail) {
        return "{{SECRET}}";
      }
      if (isSecretPathMarker(segment)) {
        redactingTail = true;
        return segment;
      }
      return segment;
    })
    .join("/");
}

function isSecretPathMarker(segment: string): boolean {
  const normalized = safeDecode(segment).toLowerCase();
  return SECRET_PATH_MARKERS.includes(normalized);
}

function shouldRedactHashPath(rawHash: string): boolean {
  const normalized = safeDecode(rawHash).toLowerCase();
  if (
    ["token", "secret", "password", "code", "credential", "key"].some((key) =>
      normalized.includes(key),
    )
  ) {
    return true;
  }
  const segments = normalized.split(/[/?#&=]+/);
  return segments.some((segment) =>
    SECRET_PATH_MARKERS.includes(segment),
  );
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isDisabledElement(element: HTMLElement): boolean {
  return (
    element.hasAttribute("disabled") ||
    element.getAttribute("aria-disabled") === "true" ||
    Boolean((element as HTMLButtonElement | HTMLInputElement).disabled)
  );
}

function createStepContext(): StepContext {
  return {
    url: sanitizeUrl(location.href),
    title: document.title,
  };
}

function createBaseStep(
  type: ScenarioStep["type"],
  context = createStepContext(),
): Omit<ScenarioStep, "id"> {
  return {
    type,
    timestamp: Date.now(),
    url: context.url,
    title: context.title,
  };
}

function getInputValue(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
): string | string[] {
  if (element instanceof HTMLSelectElement) {
    if (element.multiple) {
      return Array.from(element.selectedOptions).map((option) => option.value);
    }
    return element.value;
  }
  if (
    element instanceof HTMLInputElement &&
    (element.type === "checkbox" || element.type === "radio")
  ) {
    return String(element.checked);
  }
  return element.value;
}

function isFillInput(
  element: HTMLElement,
): element is HTMLInputElement | HTMLTextAreaElement {
  return (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement
  );
}

function isFileInput(element: HTMLElement): element is HTMLInputElement {
  return element instanceof HTMLInputElement && element.type === "file";
}

function getComposedElement(event: Event): HTMLElement | undefined {
  return event
    .composedPath()
    .find((item): item is HTMLElement => item instanceof HTMLElement);
}

function recordClick(event: MouseEvent, onStep: StepHandler): void {
  const targetElement = getComposedElement(event);
  if (!targetElement) {
    return;
  }

  const target =
    targetElement.closest<HTMLElement>(
      "button,a,input,textarea,select,[role],label,[data-testid],[data-test],[data-cy]",
    ) ?? targetElement;
  if (isDisabledElement(target) || !isRecording()) {
    return;
  }

  const signature = `${location.href}:${target.tagName}:${target.id}:${target.textContent}`;
  const now = Date.now();
  if (signature === lastClickSignature && now - lastClickTimestamp < 250) {
    return;
  }
  lastClickSignature = signature;
  lastClickTimestamp = now;

  void onStep({
    id: createStepId(),
    ...createBaseStep("click"),
    target: createTargetSnapshot(target),
  });
}

async function flushAndRecordClick(event: MouseEvent, onStep: StepHandler): Promise<void> {
  const navigationTarget = getNavigationClickTarget(event);
  if (navigationTarget && replayedClicks.has(navigationTarget)) {
    replayedClicks.delete(navigationTarget);
    await flushPendingInputs(onStep, { throwOnError: true });
    return;
  }
  if (navigationTarget) {
    event.preventDefault();
    event.stopImmediatePropagation();
    try {
      await flushPendingInputs(onStep, { throwOnError: true });
      recordClick(event, onStep);
      replayedClicks.add(navigationTarget);
      navigationTarget.click();
      replayedClicks.delete(navigationTarget);
    } catch (error) {
      replayedClicks.delete(navigationTarget);
      console.warn("Scenario Recorder skipped navigation click because pending input flush failed.", error);
    }
    return;
  }
  await flushPendingInputs(onStep, { throwOnError: true });
  recordClick(event, onStep);
}

function getNavigationClickTarget(event: MouseEvent): HTMLElement | undefined {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return undefined;
  }
  const targetElement = getComposedElement(event);
  if (!targetElement) {
    return undefined;
  }
  const link = targetElement.closest<HTMLAnchorElement>("a[href]");
  if (
    link &&
    !link.hasAttribute("download") &&
    link.target !== "_blank" &&
    link.href &&
    link.href !== location.href
  ) {
    return link;
  }
  const submitter = targetElement.closest<HTMLElement>("button,input");
  if (submitter instanceof HTMLButtonElement && submitter.type === "submit") {
    return submitter;
  }
  if (submitter instanceof HTMLInputElement && submitter.type === "submit") {
    return submitter;
  }
  return undefined;
}

async function flushAndReplaySubmit(event: SubmitEvent, onStep: StepHandler): Promise<void> {
  const form = event.target instanceof HTMLFormElement ? event.target : undefined;
  if (!form) {
    await flushPendingInputs(onStep);
    return;
  }
  const submitter = getSubmitter(event);
  if (replayedSubmits.has(form)) {
    replayedSubmits.delete(form);
    await flushPendingInputs(onStep);
    return;
  }
  event.preventDefault();
  event.stopImmediatePropagation();
  try {
    await flushPendingInputs(onStep, { throwOnError: true });
    replayedSubmits.add(form);
    form.requestSubmit(submitter);
    replayedSubmits.delete(form);
  } catch (error) {
    replayedSubmits.delete(form);
    console.warn("Scenario Recorder skipped form submit because pending input flush failed.", error);
  }
}

function getSubmitter(event: SubmitEvent): HTMLElement | undefined {
  const submitter = event.submitter;
  if (submitter instanceof HTMLButtonElement || submitter instanceof HTMLInputElement) {
    return submitter;
  }
  return undefined;
}

function scheduleFill(
  element: HTMLInputElement | HTMLTextAreaElement,
  onStep: StepHandler,
): void {
  const oldPending = pendingInputs.get(element);
  if (oldPending) {
    window.clearTimeout(oldPending.timer);
    pendingInputs.delete(element);
  }
  const context = createStepContext();
  const sequence = pendingInputSequence + 1;
  pendingInputSequence = sequence;
  const step: ScenarioStep = {
    id: createStepId(),
    ...createBaseStep("fill", context),
    target: createTargetSnapshot(element),
    value: maskValue(element, getInputValue(element)),
  };

  const timer = window.setTimeout(async () => {
    pendingInputs.delete(element);
    if (isDisabledElement(element) || !isRecording()) {
      return;
    }
    void sendPendingStepWithRestore(element, { timer, context, sequence, step }, onStep);
  }, INPUT_DEBOUNCE_MS);

  pendingInputs.set(element, { timer, context, sequence, step });
}

function recordSelect(element: HTMLSelectElement, onStep: StepHandler): void {
  if (isDisabledElement(element) || !isRecording()) {
    return;
  }
  void onStep({
    id: createStepId(),
    ...createBaseStep("select"),
    target: createTargetSnapshot(element),
    value: maskValue(element, getInputValue(element)),
  });
}

export function installRecorder(onStep: StepHandler): void {
  initializeRecordingCache();
  document.addEventListener(
    "click",
    (event) => {
      void flushAndRecordClick(event, onStep);
    },
    true,
  );

  document.addEventListener(
    "input",
    (event) => {
      const target = getComposedElement(event);
      if (
        (target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement) &&
        !isFileInput(target)
      ) {
        scheduleFill(target, onStep);
      }
    },
    true,
  );

  document.addEventListener(
    "change",
    (event) => {
      const target = getComposedElement(event);
      if (target instanceof HTMLSelectElement) {
        recordSelect(target, onStep);
      } else if (
        target instanceof HTMLElement &&
        isFillInput(target) &&
        !isFileInput(target)
      ) {
        scheduleFill(target, onStep);
      }
    },
    true,
  );

  document.addEventListener(
    "submit",
    (event) => {
      void flushAndReplaySubmit(event, onStep);
    },
    true,
  );

  window.addEventListener("pagehide", () => {
    void flushPendingInputs(onStep);
  });
}

export async function flushPendingInputs(
  onStep: StepHandler,
  options: FlushOptions = {},
): Promise<void> {
  const pendingEntries = Array.from(pendingInputs.entries()).sort(
    ([, first], [, second]) => first.sequence - second.sequence,
  );
  const sends: PendingFillSend[] = [];
  for (const [element, pending] of pendingEntries) {
    window.clearTimeout(pending.timer);
    pendingInputs.delete(element);
    if (isDisabledElement(element) || !isRecording()) {
      continue;
    }
    sends.push({
      element,
      sequence: pending.sequence,
      step: pending.step,
    });
  }
  const results = await sendPendingFillsInOrder(sends, onStep);
  const failure = results.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  restoreFailedPendingInputs(sends, results, onStep);
  if (!options.throwOnError) {
    return;
  }
  if (failure) {
    throw failure.reason instanceof Error
      ? failure.reason
      : new Error(String(failure.reason));
  }
}

async function sendPendingFillsInOrder(
  sends: PendingFillSend[],
  onStep: StepHandler,
): Promise<Array<PromiseSettledResult<void>>> {
  const results: Array<PromiseSettledResult<void>> = [];
  for (const pending of sends) {
    try {
      await onStep(pending.step);
      results.push({ status: "fulfilled", value: undefined });
    } catch (reason) {
      results.push({ status: "rejected", reason });
      break;
    }
  }
  return results;
}

function restoreFailedPendingInputs(
  sends: PendingFillSend[],
  results: Array<PromiseSettledResult<void>>,
  onStep: StepHandler,
): void {
  for (let index = 0; index < sends.length; index += 1) {
    const result = results[index];
    if (result?.status === "fulfilled") {
      continue;
    }
    const element = sends[index].element;
    if (pendingInputs.has(element)) {
      continue;
    }
    const sequence = sends[index].sequence;
    const step = sends[index].step;
    const pending = {
      timer: 0,
      context: { url: step.url, title: step.title ?? "" },
      sequence,
      step,
    };
    pending.timer = window.setTimeout(() => {
      pendingInputs.delete(element);
      if (isDisabledElement(element) || !isRecording()) {
        return;
      }
      void sendPendingStepWithRestore(element, pending, onStep);
    }, INPUT_DEBOUNCE_MS);
    pendingInputs.set(element, pending);
  }
}

async function sendPendingStepWithRestore(
  element: HTMLInputElement | HTMLTextAreaElement,
  pending: PendingInput,
  onStep: StepHandler,
): Promise<void> {
  try {
    await onStep(pending.step);
  } catch {
    if (!pendingInputs.has(element)) {
      const timer = window.setTimeout(() => {
        pendingInputs.delete(element);
        if (isDisabledElement(element) || !isRecording()) {
          return;
        }
        void sendPendingStepWithRestore(element, { ...pending, timer }, onStep);
      }, INPUT_DEBOUNCE_MS);
      pendingInputs.set(element, { ...pending, timer });
    }
  }
}
