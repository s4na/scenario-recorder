import type { ContentMessage } from "../shared/messages";
import type { ScenarioStep } from "../shared/types";
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
    if (message.type !== "FLUSH_PENDING_INPUTS") {
      return false;
    }
    void flushPendingInputs(sendStep, { throwOnError: true })
      .then(() => sendResponse({ ok: true }))
      .catch((error: unknown) => {
        sendResponse({
          error: error instanceof Error ? error.message : "Failed to flush pending inputs",
        });
      });
    return true;
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
