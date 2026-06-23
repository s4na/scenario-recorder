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
};
type PendingFillSend = {
  element: HTMLInputElement | HTMLTextAreaElement;
  sequence: number;
  step: ScenarioStep;
  send: Promise<void>;
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
  const paramText = queryIndex >= 0 ? rawHash.slice(queryIndex + 1) : rawHash;
  if (!paramText.includes("=")) {
    return shouldRedactHashPath(rawHash) ? "#{{SECRET}}" : hash;
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
  return segments
    .map((segment, index) => {
      if (!segment) {
        return segment;
      }
      const previous = segments[index - 1] ?? "";
      return isSecretPathMarker(previous) ? "{{SECRET}}" : segment;
    })
    .join("/");
}

function isSecretPathMarker(segment: string): boolean {
  const normalized = safeDecode(segment).toLowerCase();
  return SECRET_PATH_MARKERS.some(
    (marker) => normalized === marker || normalized.includes(marker),
  );
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
    SECRET_PATH_MARKERS.some(
      (marker) => segment === marker || segment.includes(marker),
    ),
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

  const timer = window.setTimeout(async () => {
    pendingInputs.delete(element);
    if (isDisabledElement(element) || !isRecording()) {
      return;
    }
    void onStep({
      id: createStepId(),
      ...createBaseStep("fill", context),
      target: createTargetSnapshot(element),
      value: maskValue(element, getInputValue(element)),
    });
  }, INPUT_DEBOUNCE_MS);

  pendingInputs.set(element, { timer, context, sequence });
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
      void flushPendingInputs(onStep, { throwOnError: true })
        .then(() => recordClick(event, onStep))
        .catch((error: unknown) => {
          console.warn(
            "Scenario Recorder skipped click because pending input flush failed.",
            error,
          );
        });
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
    () => {
      void flushPendingInputs(onStep);
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
  const pendingEntries = Array.from(pendingInputs.entries());
  const sends: PendingFillSend[] = [];
  for (const [element, pending] of pendingEntries) {
    window.clearTimeout(pending.timer);
    pendingInputs.delete(element);
    if (isDisabledElement(element) || !isRecording()) {
      continue;
    }
    const step: ScenarioStep = {
      id: createStepId(),
      ...createBaseStep("fill", pending.context),
      target: createTargetSnapshot(element),
      value: maskValue(element, getInputValue(element)),
    };
    sends.push({
      element,
      sequence: pending.sequence,
      step,
      send: new Promise<void>((resolve, reject) => {
        try {
          Promise.resolve(onStep(step)).then(resolve, reject);
        } catch (error) {
          reject(error);
        }
      }),
    });
  }
  const results = await Promise.allSettled(sends.map(({ send }) => send));
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

function restoreFailedPendingInputs(
  sends: PendingFillSend[],
  results: Array<PromiseSettledResult<void>>,
  onStep: StepHandler,
): void {
  for (let index = 0; index < sends.length; index += 1) {
    if (results[index]?.status !== "rejected") {
      continue;
    }
    const element = sends[index].element;
    if (pendingInputs.has(element)) {
      continue;
    }
    const sequence = sends[index].sequence;
    const step = sends[index].step;
    const timer = window.setTimeout(() => {
      pendingInputs.delete(element);
      if (isDisabledElement(element) || !isRecording()) {
        return;
      }
      void onStep(step);
    }, INPUT_DEBOUNCE_MS);
    pendingInputs.set(element, {
      timer,
      context: { url: step.url, title: step.title ?? "" },
      sequence,
    });
  }
}
