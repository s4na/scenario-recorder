import type { ContentMessage } from "../shared/messages";
import type { ScenarioStep } from "../shared/types";
import { flushPendingInputs, installRecorder } from "./recorder";
import { watchNavigation } from "./navigation";

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

async function sendStep(step: ScenarioStep): Promise<void> {
  const response = await chrome.runtime.sendMessage({
    type: "RECORDED_STEP",
    payload: { step },
  });
  if (response && typeof response === "object" && "error" in response) {
    throw new Error(String(response.error));
  }
}

installRecorder(sendStep);

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
      await flushPendingInputs(sendStep, { throwOnError: true });
      await sendStep({
        id: createStepId(),
        type: "navigation",
        timestamp: Date.now(),
        url: sanitizeUrl(toUrl),
        title: document.title,
        fromUrl: sanitizeUrl(fromUrl),
        toUrl: sanitizeUrl(toUrl),
      });
    })
    .catch((error: unknown) => {
      console.warn("Scenario Recorder failed to record navigation.", error);
    });
});
