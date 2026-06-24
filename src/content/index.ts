import type { ContentMessage } from "../shared/messages";
import type { ScenarioStep, SelectorCandidate, TargetSnapshot } from "../shared/types";
import { flushPendingInputs, installRecorder } from "./recorder";
import { watchNavigation } from "./navigation";
import { renderRecordingOverlay } from "./overlay";
import { sanitizeUrl } from "./urlSanitizer";

function createStepId(): string {
  const random = crypto.getRandomValues(new Uint32Array(2));
  return `step_${Date.now().toString(36)}_${Array.from(random)
    .map((value) => value.toString(36))
    .join("")}`;
}

async function isRecording(): Promise<boolean> {
  const state = await chrome.storage.local.get(
    "scenarioRecorder.recorderState",
  );
  const recorderState = state["scenarioRecorder.recorderState"] as
    | { status?: string }
    | undefined;
  return recorderState?.status === "recording";
}

async function refreshRecordingOverlay(): Promise<void> {
  try {
    const response = await chrome.runtime.sendMessage({
      type: "GET_RECORDING_OVERLAY_STATE",
    });
    renderRecordingOverlay(response);
  } catch {
    renderRecordingOverlay({ visible: false });
  }
}

async function sendStep(step: ScenarioStep): Promise<void> {
  const next = sendQueueActive
    ? sendQueue.catch(() => undefined).then(() => sendStepNow(step))
    : sendStepNow(step);
  sendQueueActive = true;
  let cleanup: Promise<void>;
  cleanup = next.catch(() => undefined).finally(() => {
    if (sendQueue === cleanup) {
      sendQueueActive = false;
    }
  });
  sendQueue = cleanup;
  return next;
}

let sendQueue: Promise<void> = Promise.resolve();
let sendQueueActive = false;

async function sendStepNow(step: ScenarioStep): Promise<void> {
  const response = await chrome.runtime.sendMessage({
    type: "RECORDED_STEP",
    payload: { step },
  });
  if (response && typeof response === "object" && "error" in response) {
    throw new Error(String(response.error));
  }
  await refreshRecordingOverlay();
}

async function recordNavigationStep(fromUrl: string, toUrl: string): Promise<void> {
  const step: ScenarioStep = {
    id: createStepId(),
    type: "navigation",
    timestamp: Date.now(),
    url: sanitizeUrl(toUrl),
    title: document.title,
    fromUrl: sanitizeUrl(fromUrl),
    toUrl: sanitizeUrl(toUrl),
  };
  try {
    await flushPendingInputs(sendStep, { throwOnError: true });
    await sendStep(step);
  } catch {
    await delay(300);
    await flushPendingInputs(sendStep, { throwOnError: true });
    await sendStep(step);
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function findByText(selector: string, text: string): HTMLElement | undefined {
  return Array.from(document.querySelectorAll<HTMLElement>(selector))
    .find((element) => normalizeText(element.innerText || element.textContent) === text);
}

function findByLabel(text: string): HTMLElement | undefined {
  const label = findByText("label", text);
  if (!(label instanceof HTMLLabelElement)) {
    return undefined;
  }
  if (label.control instanceof HTMLElement) {
    return label.control;
  }
  return label.querySelector<HTMLElement>("input,textarea,select,button");
}

function findByCandidate(candidate: SelectorCandidate): HTMLElement | undefined {
  const value = candidate.value;
  if (typeof value === "string") {
    const escaped = CSS.escape(value);
    switch (candidate.type) {
      case "data-testid":
      case "data-test":
      case "data-cy":
        return document.querySelector<HTMLElement>(`[${candidate.type}="${escaped}"]`) ?? undefined;
      case "aria-label":
        return document.querySelector<HTMLElement>(`[aria-label="${escaped}"]`) ?? undefined;
      case "label":
        return findByLabel(value);
      case "name":
        return document.querySelector<HTMLElement>(`[name="${escaped}"]`) ?? undefined;
      case "id":
        return document.getElementById(value) ?? undefined;
      case "placeholder":
        return document.querySelector<HTMLElement>(`[placeholder="${escaped}"]`) ?? undefined;
      case "text":
        return findByText("button,a,label,[role]", value);
      case "css":
        return document.querySelector<HTMLElement>(value) ?? undefined;
      case "xpath": {
        const result = document.evaluate(value, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        return result.singleNodeValue instanceof HTMLElement ? result.singleNodeValue : undefined;
      }
      default:
        return undefined;
    }
  }
  if (candidate.type === "role" && value && typeof value === "object" && "role" in value) {
    const role = String(value.role);
    const name = "name" in value && typeof value.name === "string" ? value.name : undefined;
    const candidates = Array.from(document.querySelectorAll<HTMLElement>(`[role="${CSS.escape(role)}"],${implicitRoleSelector(role)}`));
    return candidates.find((element) => !name || normalizeText(element.innerText || element.textContent || element.getAttribute("aria-label")) === name);
  }
  return undefined;
}

function implicitRoleSelector(role: string): string {
  if (role === "button") return "button,input[type=\"button\"],input[type=\"submit\"]";
  if (role === "link") return "a[href]";
  if (role === "textbox") return "input:not([type]),input[type=\"text\"],input[type=\"email\"],textarea";
  if (role === "combobox") return "select";
  if (role === "checkbox") return "input[type=\"checkbox\"]";
  if (role === "radio") return "input[type=\"radio\"]";
  return `[role="${CSS.escape(role)}"]`;
}

function findTarget(target: TargetSnapshot | undefined): HTMLElement | undefined {
  for (const candidate of target?.selectorCandidates ?? []) {
    const element = findByCandidate(candidate);
    if (element) {
      return element;
    }
  }
  if (target?.id) {
    return document.getElementById(target.id) ?? undefined;
  }
  if (target?.name) {
    return document.querySelector<HTMLElement>(`[name="${CSS.escape(target.name)}"]`) ?? undefined;
  }
  if (target?.label) {
    return findByLabel(target.label);
  }
  return undefined;
}

function dispatchValueEvents(element: HTMLElement): void {
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

async function executeStep(step: ScenarioStep): Promise<void> {
  if (step.type === "assert") {
    const actual = step.assertion.kind === "title" ? document.title : sanitizeUrl(location.href);
    if (actual !== step.assertion.expected) {
      throw new Error(`Assertion failed: expected ${step.assertion.expected}, got ${actual}`);
    }
    return;
  }
  if (step.type === "wait" || step.type === "navigation" || step.type === "goto") {
    return;
  }
  const target = findTarget(step.target);
  if (!target) {
    throw new Error(`Target was not found for ${step.type}.`);
  }
  target.scrollIntoView({ block: "center", inline: "center" });
  await delay(80);
  if (step.type === "fill") {
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
      throw new Error("Fill target is not an input or textarea.");
    }
    target.focus();
    target.value = step.value;
    dispatchValueEvents(target);
    return;
  }
  if (step.type === "select") {
    if (!(target instanceof HTMLSelectElement)) {
      throw new Error("Select target is not a select element.");
    }
    const values = Array.isArray(step.value) ? step.value : [step.value];
    for (const option of Array.from(target.options)) {
      option.selected = values.includes(option.value);
    }
    dispatchValueEvents(target);
    return;
  }
  if (step.type === "submit") {
    const form = target instanceof HTMLFormElement ? target : target.closest("form");
    if (form) {
      form.requestSubmit();
      return;
    }
  }
  target.click();
}

installRecorder(sendStep);
void refreshRecordingOverlay();

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
  void refreshRecordingOverlay();
});

chrome.runtime.onMessage.addListener(
  (message: ContentMessage, _sender, sendResponse) => {
    if (message.type === "EXECUTE_SCENARIO_STEP") {
      void executeStep(message.payload.step)
        .then(() => sendResponse({ ok: true }))
        .catch((error: unknown) => {
          sendResponse({
            error: error instanceof Error ? error.message : "Failed to execute scenario step",
          });
        });
      return true;
    }
    if (message.type === "FLUSH_PENDING_INPUTS") {
      void flushPendingInputs(sendStep, { throwOnError: true })
        .then(() => sendResponse({ ok: true }))
        .catch((error: unknown) => {
          sendResponse({
            error: error instanceof Error ? error.message : "Failed to flush pending inputs",
          });
        });
      return true;
    }
    return false;
  },
);

watchNavigation((fromUrl, toUrl) => {
  void isRecording()
    .then(async (recording) => {
      if (!recording) {
        return;
      }
      await recordNavigationStep(fromUrl, toUrl);
    })
    .catch((error: unknown) => {
      console.warn("Scenario Recorder failed to record navigation.", error);
    });
});
