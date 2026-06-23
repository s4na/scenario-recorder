import type { ScenarioStep } from "../shared/types";
import { maskValue } from "./masking";
import { createTargetSnapshot } from "./selector";

type StepHandler = (step: ScenarioStep) => void | Promise<void>;

const INPUT_DEBOUNCE_MS = 300;
const inputTimers = new Map<HTMLInputElement | HTMLTextAreaElement, number>();
let lastClickSignature = "";
let lastClickTimestamp = 0;

function createStepId(): string {
  const random = crypto.getRandomValues(new Uint32Array(2));
  return `step_${Date.now().toString(36)}_${Array.from(random)
    .map((value) => value.toString(36))
    .join("")}`;
}

async function isRecording(): Promise<boolean> {
  const state = await chrome.storage.local.get("scenarioRecorder.recorderState");
  const recorderState = state["scenarioRecorder.recorderState"] as { status?: string } | undefined;
  return recorderState?.status === "recording";
}

function sanitizeUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    for (const key of Array.from(url.searchParams.keys())) {
      if (isSecretUrlKey(key)) {
        url.searchParams.set(key, "{{SECRET}}");
      }
    }
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
  const normalized = key.toLowerCase().replace(/[-.]/g, "_");
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
    "token"
  ].some((secretKey) => normalized === secretKey || normalized.endsWith(`_${secretKey}`));
}

function sanitizeHash(hash: string): string {
  if (!hash) {
    return hash;
  }
  const rawHash = hash.slice(1);
  const queryIndex = rawHash.indexOf("?");
  const paramText = queryIndex >= 0 ? rawHash.slice(queryIndex + 1) : rawHash;
  if (!paramText.includes("=")) {
    return ["token", "secret", "password", "code", "credential", "key"].some((key) =>
      rawHash.toLowerCase().includes(key)
    )
      ? "#{{SECRET}}"
      : hash;
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

function isDisabledElement(element: HTMLElement): boolean {
  return (
    element.hasAttribute("disabled") ||
    element.getAttribute("aria-disabled") === "true" ||
    Boolean((element as HTMLButtonElement | HTMLInputElement).disabled)
  );
}

function createBaseStep(type: ScenarioStep["type"]): Omit<ScenarioStep, "id"> {
  return {
    type,
    timestamp: Date.now(),
    url: sanitizeUrl(location.href),
    title: document.title
  };
}

function getInputValue(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): string {
  if (element instanceof HTMLSelectElement) {
    return element.value;
  }
  if (element instanceof HTMLInputElement && (element.type === "checkbox" || element.type === "radio")) {
    return String(element.checked);
  }
  return element.value;
}

function isFillInput(element: HTMLElement): element is HTMLInputElement | HTMLTextAreaElement {
  return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement;
}

async function recordClick(event: MouseEvent, onStep: StepHandler): Promise<void> {
  if (!(event.target instanceof HTMLElement)) {
    return;
  }

  const target = event.target.closest<HTMLElement>("button,a,input,textarea,select,[role],label,[data-testid],[data-test],[data-cy]") ?? event.target;
  if (isDisabledElement(target) || !(await isRecording())) {
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
    target: createTargetSnapshot(target)
  });
}

function scheduleFill(
  element: HTMLInputElement | HTMLTextAreaElement,
  onStep: StepHandler
): void {
  const oldTimer = inputTimers.get(element);
  if (oldTimer) {
    window.clearTimeout(oldTimer);
  }

  const timer = window.setTimeout(async () => {
    inputTimers.delete(element);
    if (isDisabledElement(element) || !(await isRecording())) {
      return;
    }
    void onStep({
      id: createStepId(),
      ...createBaseStep("fill"),
      target: createTargetSnapshot(element),
      value: maskValue(element, getInputValue(element))
    });
  }, INPUT_DEBOUNCE_MS);

  inputTimers.set(element, timer);
}

async function recordSelect(element: HTMLSelectElement, onStep: StepHandler): Promise<void> {
  if (isDisabledElement(element) || !(await isRecording())) {
    return;
  }
  void onStep({
    id: createStepId(),
    ...createBaseStep("select"),
    target: createTargetSnapshot(element),
    value: maskValue(element, getInputValue(element))
  });
}

export function installRecorder(onStep: StepHandler): void {
  document.addEventListener(
    "click",
    (event) => {
      void recordClick(event, onStep);
    },
    true
  );

  document.addEventListener(
    "input",
    (event) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        scheduleFill(event.target, onStep);
      }
    },
    true
  );

  document.addEventListener(
    "change",
    (event) => {
      if (event.target instanceof HTMLSelectElement) {
        void recordSelect(event.target, onStep);
      } else if (event.target instanceof HTMLElement && isFillInput(event.target)) {
        scheduleFill(event.target, onStep);
      }
    },
    true
  );
}

export async function flushPendingInputs(onStep: StepHandler): Promise<void> {
  const pendingElements = Array.from(inputTimers.keys());
  for (const element of pendingElements) {
    const timer = inputTimers.get(element);
    if (timer) {
      window.clearTimeout(timer);
    }
    inputTimers.delete(element);
    if (isDisabledElement(element) || !(await isRecording())) {
      continue;
    }
    await onStep({
      id: createStepId(),
      ...createBaseStep("fill"),
      target: createTargetSnapshot(element),
      value: maskValue(element, getInputValue(element))
    });
  }
}
