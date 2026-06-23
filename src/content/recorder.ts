import type { ScenarioStep } from "../shared/types";
import { sanitizeUrl } from "../shared/utils";
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
const replayingSubmits = new WeakSet<HTMLFormElement>();

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

async function recordClick(
  event: MouseEvent,
  onStep: StepHandler,
): Promise<void> {
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

  await onStep({
    id: createStepId(),
    ...createBaseStep("click"),
    target: createTargetSnapshot(target),
  });
}

async function flushAndRecordClick(
  event: MouseEvent,
  onStep: StepHandler,
): Promise<void> {
  if (!isRecording()) {
    return;
  }
  await recordClick(event, onStep);
}

function flushBeforeActivation(event: Event, onStep: StepHandler): void {
  if (!isRecording()) {
    return;
  }
  const target = getComposedElement(event);
  if (!target?.closest("button,a,input,textarea,select,[role],label")) {
    return;
  }
  void flushPendingInputs(onStep).catch((error: unknown) => {
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
  if (replayingSubmits.has(form) || pendingInputs.size === 0 || !event.cancelable) {
    replayingSubmits.delete(form);
    return;
  }
  event.preventDefault();
  event.stopImmediatePropagation();
  await flushPendingInputs(onStep, { throwOnError: true }).then(() => {
    const submitter =
      event.submitter instanceof HTMLElement ? event.submitter : undefined;
    replayFormSubmit(form, submitter);
  }).catch((error: unknown) => {
    console.warn(
      "Scenario Recorder could not flush pending input before form submit.",
      error,
    );
    const submitter =
      event.submitter instanceof HTMLElement ? event.submitter : undefined;
    replayFormSubmit(form, submitter);
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
    void sendPendingStepWithRestore(
      element,
      { timer, context, sequence, step },
      onStep,
    );
  }, INPUT_DEBOUNCE_MS);

  pendingInputs.set(element, { timer, context, sequence, step });
}

function recordSelect(element: HTMLSelectElement, onStep: StepHandler): void {
  if (isDisabledElement(element) || !isRecording()) {
    return;
  }
  void Promise.resolve(
    onStep({
      id: createStepId(),
      ...createBaseStep("select"),
      target: createTargetSnapshot(element),
      value: maskValue(element, getInputValue(element)),
    }),
  ).catch((error: unknown) => {
    console.warn("Scenario Recorder failed to record select.", error);
  });
}

export function installRecorder(onStep: StepHandler): void {
  initializeRecordingCache();
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
      void flushBeforeSubmit(event, onStep);
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
      void flushPendingInputs(onStep);
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
        void flushPendingInputs(onStep);
      }, INPUT_DEBOUNCE_MS);
      pendingInputs.set(element, { ...pending, timer });
    }
  }
}
