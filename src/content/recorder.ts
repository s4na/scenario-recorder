import type { RuntimeMessage } from "../shared/messages";
import type { ScenarioStep } from "../shared/types";
import { showClickFeedback, showSelectionFeedback } from "./feedback";
import { maskValue } from "./masking";
import { createTargetSnapshot } from "./selector";
import { sanitizeUrl } from "./urlSanitizer";

type RecorderStepType = Exclude<ScenarioStep["type"], "assert">;
type StepHandler = (step: ScenarioStep) => void | Promise<void>;
type FlushOptions = {
  throwOnError?: boolean;
};
type RecorderInstallOptions = {
  initializeRecordingCache?: boolean;
  isRecording?: () => boolean;
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

const RETRY_DELAY_MS = 300;
const OVERLAY_HOST_ID = "scenario-recorder-status-overlay";
const FEEDBACK_HOST_ID = "scenario-recorder-feedback-layer";
const pendingInputs = new Map<
  HTMLInputElement | HTMLTextAreaElement,
  PendingInput
>();
const latestInputSequences = new WeakMap<
  HTMLInputElement | HTMLTextAreaElement,
  number
>();
let lastClickSignature = "";
let lastClickTimestamp = 0;
let lastClickTarget: HTMLElement | undefined;
let cachedRecording = false;
let pendingInputSequence = 0;
let activeFlush: Promise<void> | undefined;
let recordingTargetRefreshSequence = 0;
let selectionTimer: number | undefined;
let lastSelectionSignature = "";
let lastSelectionTimestamp = 0;
const replayingSubmits = new WeakSet<HTMLFormElement>();
let recordingStateOverride: (() => boolean) | undefined;

function createStepId(): string {
  const random = crypto.getRandomValues(new Uint32Array(2));
  return `step_${Date.now().toString(36)}_${Array.from(random)
    .map((value) => value.toString(36))
    .join("")}`;
}

async function refreshRecordingTargetCache(): Promise<void> {
  const refreshSequence = recordingTargetRefreshSequence + 1;
  recordingTargetRefreshSequence = refreshSequence;
  const message: RuntimeMessage<"IS_RECORDING_TARGET"> = { type: "IS_RECORDING_TARGET" };
  const response = await chrome.runtime.sendMessage(message);
  if (recordingTargetRefreshSequence !== refreshSequence) {
    return;
  }
  cachedRecording = Boolean(response?.recording);
}

function markRecordingTargetUnavailable(error: unknown, refreshSequence: number): void {
  if (recordingTargetRefreshSequence === refreshSequence) {
    cachedRecording = false;
  }
  console.warn("Scenario Recorder failed to refresh target recording state.", error);
}

function initializeRecordingCache(): void {
  const initialRefresh = recordingTargetRefreshSequence + 1;
  void refreshRecordingTargetCache().catch((error: unknown) => {
    markRecordingTargetUnavailable(error, initialRefresh);
  });
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (
      areaName !== "local" ||
      (
        !changes["scenarioRecorder.recorderState"] &&
        !changes["scenarioRecorder.settings"]
      )
    ) {
      return;
    }
    const refreshSequence = recordingTargetRefreshSequence + 1;
    void refreshRecordingTargetCache().catch((error: unknown) => {
      markRecordingTargetUnavailable(error, refreshSequence);
    });
  });
}

function isRecording(): boolean {
  return recordingStateOverride?.() ?? cachedRecording;
}

function shouldRecordTargetContext(): boolean {
  return true;
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

function createBaseStep<T extends RecorderStepType>(
  type: T,
  context = createStepContext(),
): {
  type: T;
  timestamp: number;
  url: string;
  title: string;
} {
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

function isHiddenInput(element: HTMLElement): element is HTMLInputElement {
  return element instanceof HTMLInputElement && element.type === "hidden";
}

function isToggleInput(element: HTMLElement): element is HTMLInputElement {
  return (
    element instanceof HTMLInputElement &&
    (element.type === "checkbox" || element.type === "radio")
  );
}

function invalidatePendingFill(element: HTMLInputElement | HTMLTextAreaElement): void {
  const sequence = pendingInputSequence + 1;
  pendingInputSequence = sequence;
  latestInputSequences.set(element, sequence);
}

function getComposedElement(event: Event): HTMLElement | undefined {
  return event
    .composedPath()
    .find((item): item is HTMLElement => item instanceof HTMLElement);
}

function isRecorderUiElement(element: HTMLElement): boolean {
  return (
    element.id === OVERLAY_HOST_ID ||
    element.id === FEEDBACK_HOST_ID ||
    Boolean(element.closest(`#${OVERLAY_HOST_ID}, #${FEEDBACK_HOST_ID}`))
  );
}

function isRecorderUiEvent(event: Event): boolean {
  return event
    .composedPath()
    .some((item) => item instanceof HTMLElement && isRecorderUiElement(item));
}

async function recordClick(
  event: MouseEvent,
  onStep: StepHandler,
): Promise<void> {
  const targetElement = getComposedElement(event);
  if (!targetElement) {
    return;
  }
  if (isRecorderUiElement(targetElement)) {
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
  if (
    target === lastClickTarget &&
    signature === lastClickSignature &&
    now - lastClickTimestamp < 250
  ) {
    return;
  }
  lastClickTarget = target;
  lastClickSignature = signature;
  lastClickTimestamp = now;

  await onStep({
    id: createStepId(),
    ...createBaseStep("click"),
    target: createTargetSnapshot(target, { includeContext: shouldRecordTargetContext() }),
  });
  showClickFeedback(target);
}

async function flushAndRecordClick(
  event: MouseEvent,
  onStep: StepHandler,
): Promise<void> {
  if (!isRecording()) {
    return;
  }
  if (!event.isTrusted) {
    return;
  }
  await recordClick(event, onStep);
}

function flushBeforeActivation(event: Event, onStep: StepHandler): void {
  if (!isRecording()) {
    return;
  }
  if (isRecorderUiEvent(event)) {
    return;
  }
  const target = getComposedElement(event);
  if (!target?.closest("button,a,input,textarea,select,[role],label")) {
    return;
  }
  void flushTrackedPendingInputs(onStep).catch((error: unknown) => {
    console.warn("Scenario Recorder failed to flush before activation.", error);
  });
}

async function flushBeforeSubmit(event: SubmitEvent, onStep: StepHandler): Promise<void> {
  if (!isRecording()) {
    return;
  }
  const form =
    event.target instanceof HTMLFormElement ? event.target : undefined;
  if (!form) {
    await flushPendingInputs(onStep);
    return;
  }
  if (replayingSubmits.has(form)) {
    replayingSubmits.delete(form);
    return;
  }
  if (!event.cancelable) {
    await recordSubmit(form, onStep);
    return;
  }
  event.preventDefault();
  event.stopImmediatePropagation();
  const submitter =
    event.submitter instanceof HTMLElement ? event.submitter : undefined;
  if (
    pendingInputs.size > 0 ||
    activeFlush
  ) {
    await flushTrackedPendingInputs(onStep, { throwOnError: true }).catch((error: unknown) => {
      console.warn(
        "Scenario Recorder could not flush pending input before form submit.",
        error,
      );
    });
  }
  await recordSubmit(form, onStep, submitter).catch((error: unknown) => {
    console.warn(
      "Scenario Recorder could not record form submit.",
      error,
    );
  }).finally(() => {
    replayFormSubmit(form, submitter);
  });
}

async function recordSubmit(
  form: HTMLFormElement,
  onStep: StepHandler,
  submitter?: HTMLElement,
): Promise<void> {
  const includeContext = shouldRecordTargetContext();
  await onStep({
    id: createStepId(),
    ...createBaseStep("submit"),
    target: createTargetSnapshot(form, { includeContext }),
    ...(submitter
      ? { submitter: createTargetSnapshot(submitter, { includeContext }) }
      : {}),
  });
}

function replayFormSubmit(
  form: HTMLFormElement,
  submitter: HTMLElement | undefined,
): void {
  replayingSubmits.add(form);
  let temporarySubmitter: HTMLButtonElement | undefined;
  try {
    if (
      isSubmitter(submitter) &&
      submitter.form !== form
    ) {
      temporarySubmitter = createTemporarySubmitter(form, submitter);
      HTMLFormElement.prototype.requestSubmit.call(form, temporarySubmitter);
    } else {
      HTMLFormElement.prototype.requestSubmit.call(form, submitter);
    }
    window.setTimeout(() => {
      temporarySubmitter?.remove();
      replayingSubmits.delete(form);
    }, 0);
  } catch (error) {
    temporarySubmitter?.remove();
    try {
      HTMLFormElement.prototype.requestSubmit.call(form);
      window.setTimeout(() => {
        replayingSubmits.delete(form);
      }, 0);
    } catch (fallbackError) {
      replayingSubmits.delete(form);
      console.warn(
        "Scenario Recorder could not replay form submit.",
        fallbackError,
      );
      console.warn("Scenario Recorder original replay error.", error);
    }
  }
}

function isSubmitter(
  element: HTMLElement | undefined,
): element is HTMLButtonElement | HTMLInputElement {
  return element instanceof HTMLButtonElement || element instanceof HTMLInputElement;
}

function createTemporarySubmitter(
  form: HTMLFormElement,
  submitter: HTMLButtonElement | HTMLInputElement,
): HTMLButtonElement {
  const temporary = document.createElement("button");
  temporary.type = "submit";
  temporary.hidden = true;
  copySubmitterAttribute(submitter, temporary, "formaction");
  copySubmitterAttribute(submitter, temporary, "formenctype");
  copySubmitterAttribute(submitter, temporary, "formmethod");
  copySubmitterAttribute(submitter, temporary, "formnovalidate");
  copySubmitterAttribute(submitter, temporary, "formtarget");
  if (submitter.name) {
    temporary.name = submitter.name;
    temporary.value = submitter.value;
  }
  form.append(temporary);
  return temporary;
}

function copySubmitterAttribute(
  from: HTMLButtonElement | HTMLInputElement,
  to: HTMLButtonElement,
  attribute: string,
): void {
  const value = from.getAttribute(attribute);
  if (value === null) {
    return;
  }
  to.setAttribute(attribute, value);
}

function scheduleFill(
  element: HTMLInputElement | HTMLTextAreaElement,
  onStep: StepHandler,
): void {
  const value = maskValue(element, getInputValue(element)) as string;
  const oldPending = pendingInputs.get(element);
  if (oldPending) {
    window.clearTimeout(oldPending.timer);
    pendingInputs.delete(element);
  }
  if (isDisabledElement(element) || !isRecording()) {
    invalidatePendingFill(element);
    return;
  }
  const context = createStepContext();
  const sequence = pendingInputSequence + 1;
  pendingInputSequence = sequence;
  latestInputSequences.set(element, sequence);
  const step: ScenarioStep = {
    id: createStepId(),
    type: "fill",
    timestamp: Date.now(),
    url: context.url,
    title: context.title,
    target: createTargetSnapshot(element, { includeContext: shouldRecordTargetContext() }),
    value,
  };

  const timer = 0;
  const pending = { timer, context, sequence, step };
  pendingInputs.set(element, pending);
  trackImmediateFillSend(
    element,
    pending,
    onStep,
  );
}

function trackImmediateFillSend(
  element: HTMLInputElement | HTMLTextAreaElement,
  pending: PendingInput,
  onStep: StepHandler,
): void {
  const previousFlush = activeFlush?.catch(() => undefined) ?? Promise.resolve();
  const send = sendPendingStepWithRestore(element, pending, onStep);
  const tracked = Promise.allSettled([previousFlush, send]).then(() => undefined).finally(() => {
    if (activeFlush === tracked) {
      activeFlush = undefined;
    }
  });
  activeFlush = tracked;
}

function recordSelect(element: HTMLSelectElement, onStep: StepHandler): void {
  if (isDisabledElement(element) || !isRecording()) {
    return;
  }
  void Promise.resolve(
    onStep({
      id: createStepId(),
      ...createBaseStep("select"),
      target: createTargetSnapshot(element, { includeContext: shouldRecordTargetContext() }),
      value: maskValue(element, getInputValue(element)),
    }),
  ).catch((error: unknown) => {
    console.warn("Scenario Recorder failed to record select.", error);
  });
}

function selectedInputText(
  element: HTMLInputElement | HTMLTextAreaElement,
): string | undefined {
  const start = element.selectionStart;
  const end = element.selectionEnd;
  if (start === null || end === null || start === end) {
    return undefined;
  }
  return element.value.slice(Math.min(start, end), Math.max(start, end));
}

function currentSelection(): { text: string; target: HTMLElement; rects: DOMRect[] } | undefined {
  const activeElement = document.activeElement;
  if (
    activeElement instanceof HTMLInputElement ||
    activeElement instanceof HTMLTextAreaElement
  ) {
    const text = selectedInputText(activeElement)?.replace(/\s+/g, " ").trim();
    if (text) {
      return { text, target: activeElement, rects: [activeElement.getBoundingClientRect()] };
    }
  }
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return undefined;
  }
  const text = selection.toString().replace(/\s+/g, " ").trim();
  if (!text) {
    return undefined;
  }
  const range = selection.getRangeAt(0);
  const container = range.commonAncestorContainer;
  const target = container instanceof HTMLElement ? container : container.parentElement;
  if (!target || isRecorderUiElement(target)) {
    return undefined;
  }
  return { text, target, rects: Array.from(range.getClientRects()) };
}

function recordSelection(onStep: StepHandler): void {
  if (!isRecording()) {
    return;
  }
  const selected = currentSelection();
  if (!selected) {
    return;
  }
  const signature = `${location.href}:${selected.target.tagName}:${selected.target.id}:${selected.text}`;
  const now = Date.now();
  if (signature === lastSelectionSignature && now - lastSelectionTimestamp < 1000) {
    return;
  }
  lastSelectionSignature = signature;
  lastSelectionTimestamp = now;
  void Promise.resolve(
    onStep({
      id: createStepId(),
      ...createBaseStep("selection"),
      target: createTargetSnapshot(selected.target, { includeContext: shouldRecordTargetContext() }),
      value: selected.text,
    }),
  ).then(() => {
    showSelectionFeedback(selected.rects);
  }).catch((error: unknown) => {
    console.warn("Scenario Recorder failed to record text selection.", error);
  });
}

function scheduleSelectionRecord(onStep: StepHandler): void {
  if (!isRecording()) {
    return;
  }
  if (selectionTimer !== undefined) {
    window.clearTimeout(selectionTimer);
  }
  selectionTimer = window.setTimeout(() => {
    selectionTimer = undefined;
    recordSelection(onStep);
  }, 120);
}

export function installRecorder(
  onStep: StepHandler,
  options: RecorderInstallOptions = {},
): void {
  recordingStateOverride = options.isRecording;
  if (options.initializeRecordingCache !== false) {
    initializeRecordingCache();
  }
  document.addEventListener(
    "pointerdown",
    (event) => {
      flushBeforeActivation(event, onStep);
    },
    true,
  );

  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Enter" || event.key === " ") {
        flushBeforeActivation(event, onStep);
      }
    },
    true,
  );

  document.addEventListener(
    "click",
    (event) => {
      if (!event.isTrusted) {
        return;
      }
      if (isRecorderUiEvent(event)) {
        return;
      }
      void flushAndRecordClick(event, onStep);
    },
    true,
  );

  document.addEventListener(
    "input",
    (event) => {
      if (!event.isTrusted) {
        return;
      }
      if (isRecorderUiEvent(event)) {
        return;
      }
      const target = getComposedElement(event);
      if (
        (target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement) &&
        !isFileInput(target) &&
        !isHiddenInput(target) &&
        !isToggleInput(target)
      ) {
        scheduleFill(target, onStep);
      }
    },
    true,
  );

  document.addEventListener(
    "change",
    (event) => {
      if (!event.isTrusted) {
        return;
      }
      if (isRecorderUiEvent(event)) {
        return;
      }
      const target = getComposedElement(event);
      if (target instanceof HTMLSelectElement) {
        recordSelect(target, onStep);
      } else if (
        target instanceof HTMLElement &&
        isFillInput(target) &&
        !isFileInput(target) &&
        !isHiddenInput(target) &&
        !isToggleInput(target)
      ) {
        scheduleFill(target, onStep);
      }
    },
    true,
  );

  document.addEventListener(
    "submit",
    (event) => {
      if (!event.isTrusted) {
        return;
      }
      void flushBeforeSubmit(event, onStep);
    },
    true,
  );

  document.addEventListener(
    "selectionchange",
    (event) => {
      if (!event.isTrusted) {
        return;
      }
      scheduleSelectionRecord(onStep);
    },
    true,
  );

  window.addEventListener("pagehide", () => {
    void flushTrackedPendingInputs(onStep);
  });
}

export async function flushPendingInputs(
  onStep: StepHandler,
  options: FlushOptions = {},
): Promise<void> {
  await activeFlush?.catch(() => undefined);
  await flushPendingInputsNow(onStep, options);
}

async function flushPendingInputsNow(
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

function flushTrackedPendingInputs(
  onStep: StepHandler,
  options: FlushOptions = {},
): Promise<void> {
  const next = (activeFlush ?? Promise.resolve())
    .catch(() => undefined)
    .then(() => flushPendingInputsNow(onStep, options));
  const tracked = next.finally(() => {
    if (activeFlush === tracked) {
      activeFlush = undefined;
    }
  });
  activeFlush = tracked;
  return next;
}

async function sendPendingFillsInOrder(
  sends: PendingFillSend[],
  onStep: StepHandler,
): Promise<Array<PromiseSettledResult<void>>> {
  const results: Array<PromiseSettledResult<void>> = [];
  for (const pending of sends) {
    try {
      if (
        latestInputSequences.get(pending.element) !== pending.sequence ||
        isDisabledElement(pending.element) ||
        !isRecording()
      ) {
        results.push({ status: "fulfilled", value: undefined });
        continue;
      }
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
    if (
      latestInputSequences.get(element) !== sequence ||
      isDisabledElement(element) ||
      !isRecording()
    ) {
      continue;
    }
    const step = sends[index].step;
    const pending = {
      timer: 0,
      context: { url: step.url, title: step.title ?? "" },
      sequence,
      step,
    };
    pending.timer = window.setTimeout(() => {
      void flushPendingInputs(onStep);
    }, RETRY_DELAY_MS);
    pendingInputs.set(element, pending);
  }
}

function schedulePendingRetry(
  element: HTMLInputElement | HTMLTextAreaElement,
  pending: PendingInput,
  onStep: StepHandler,
): void {
  const existing = pendingInputs.get(element);
  if (existing && existing.sequence !== pending.sequence) {
    return;
  }
  if (
    latestInputSequences.get(element) !== pending.sequence ||
    pendingInputs.get(element)?.sequence !== pending.sequence ||
    isDisabledElement(element) ||
    !isRecording()
  ) {
    pendingInputs.delete(element);
    return;
  }
  if (existing?.timer) {
    window.clearTimeout(existing.timer);
  }
  const timer = window.setTimeout(() => {
    void flushPendingInputs(onStep);
  }, RETRY_DELAY_MS);
  pendingInputs.set(element, { ...pending, timer });
}

async function sendPendingStepWithRestore(
  element: HTMLInputElement | HTMLTextAreaElement,
  pending: PendingInput,
  onStep: StepHandler,
): Promise<void> {
  if (
    latestInputSequences.get(element) !== pending.sequence ||
    isDisabledElement(element) ||
    !isRecording()
  ) {
    if (pendingInputs.get(element)?.sequence === pending.sequence) {
      pendingInputs.delete(element);
    }
    return;
  }
  try {
    await onStep(pending.step);
    if (
      pendingInputs.get(element)?.sequence === pending.sequence &&
      latestInputSequences.get(element) === pending.sequence
    ) {
      pendingInputs.delete(element);
    }
  } catch {
    schedulePendingRetry(element, pending, onStep);
  }
}
