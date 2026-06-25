import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeMessage } from "../shared/messages";
import type { RecorderState, Scenario } from "../shared/types";

const localStorage = new Map<string, unknown>();
const sessionStorage = new Map<string, unknown>();
let runtimeListener: (
  message: RuntimeMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void,
) => boolean;
let navigationListener: (details: chrome.webNavigation.WebNavigationTransitionCallbackDetails) => void;

vi.stubGlobal("chrome", {
  runtime: {
    getManifest: () => ({ version: "0.1.0" }),
    onMessage: {
      addListener(listener: typeof runtimeListener) {
        runtimeListener = listener;
      }
    }
  },
  storage: {
    local: {
      async get(key: string) {
        return { [key]: localStorage.get(key) };
      },
      async set(values: Record<string, unknown>) {
        for (const [key, value] of Object.entries(values)) {
          localStorage.set(key, value);
        }
      }
    },
    session: {
      async get(key: string) {
        return { [key]: sessionStorage.get(key) };
      },
      async set(values: Record<string, unknown>) {
        for (const [key, value] of Object.entries(values)) {
          sessionStorage.set(key, value);
        }
      }
    }
  },
  tabs: {
    onRemoved: {
      addListener() {
        return undefined;
      }
    },
    async get(tabId: number) {
      return { id: tabId, url: "https://app.example/current", title: "App" };
    },
    async query() {
      return [];
    },
    async sendMessage() {
      return undefined;
    }
  },
  scripting: {
    async executeScript() {
      return [];
    }
  },
  webNavigation: {
    onCommitted: {
      addListener(listener: typeof navigationListener) {
        navigationListener = listener;
      }
    }
  }
});

await import("./index");

function scenario(id: string, name: string, updatedAt: string): Scenario {
  return {
    schemaVersion: "scenario-recorder/v1",
    id,
    name,
    createdAt: "2026-06-23T10:00:00.000Z",
    updatedAt,
    recording: { sessions: [] },
    steps: [],
    metadata: {
      userAgent: "test",
      extensionVersion: "0.1.0",
      recordedBy: "scenario-recorder"
    }
  };
}

function expectIsoDateString(value: unknown): string {
  expect(typeof value).toBe("string");
  const text = value as string;
  expect(Number.isNaN(Date.parse(text))).toBe(false);
  expect(new Date(text).toISOString()).toBe(text);
  return text;
}

async function sendMessage<T>(
  message: RuntimeMessage,
  sender: chrome.runtime.MessageSender = {},
): Promise<T> {
  return new Promise((resolve) => {
    runtimeListener(message, sender, (response) => resolve(response as T));
  });
}

async function waitForTabUrl(tabId: number, expectedUrl: string | undefined): Promise<void> {
  for (let index = 0; index < 20; index += 1) {
    const urls = sessionStorage.get("scenarioRecorder.tabUrls") as Record<string, string> | undefined;
    if (urls?.[String(tabId)] === expectedUrl) {
      return;
    }
    await Promise.resolve();
  }
  throw new Error(`Timed out waiting for tab ${tabId} URL ${String(expectedUrl)}`);
}

describe("background", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("keeps newer local scenarios when importing older scenarios through runtime messages", async () => {
    localStorage.set("scenarioRecorder.scenarios", [
      scenario("same-id", "new local", "2026-06-24T10:00:00.000Z")
    ]);

    const response = await sendMessage<{ scenarios: Scenario[] }>({
      type: "IMPORT_SCENARIOS",
      payload: {
        scenarios: [scenario("same-id", "old import", "2026-06-23T10:00:00.000Z")]
      }
    });

    expect(response.scenarios.map((item) => [item.id, item.name, item.updatedAt])).toEqual([
      ["same-id", "new local", "2026-06-24T10:00:00.000Z"]
    ]);
  });

  it("updates scenario metadata without overwriting recorded steps", async () => {
    const keptStep: Scenario["steps"][number] = {
      id: "kept_step",
      type: "click",
      timestamp: 0,
      url: "https://app.example",
      target: {
        tagName: "button",
        selectorCandidates: [{ type: "text", value: "Save", confidence: 80 }]
      }
    };
    localStorage.set("scenarioRecorder.scenarios", [{
      ...scenario("edit-id", "before", "2026-06-24T10:00:00.000Z"),
      description: "old",
      tags: ["old"],
      steps: [keptStep]
    }]);

    const response = await sendMessage<{ scenarios: Scenario[] }>({
      type: "UPDATE_SCENARIO",
      payload: {
        scenarioId: "edit-id",
        name: "after",
        description: "new",
        tags: ["new"]
      }
    });

    expect(response.scenarios[0]).toMatchObject({
      id: "edit-id",
      name: "after",
      description: "new",
      tags: ["new"]
    });
    expect(response.scenarios[0]?.steps).toEqual([keptStep]);
  });

  it("saves the current recording without requiring a separate stop action", async () => {
    const recordedStep: Scenario["steps"][number] = {
      id: "step_save_now",
      type: "click",
      timestamp: 100,
      url: "https://app.example/start",
      target: {
        tagName: "button",
        selectorCandidates: [{ type: "text", value: "Create", confidence: 80 }]
      }
    };
    localStorage.set("scenarioRecorder.recorderState", {
      status: "recording",
      currentSteps: [recordedStep],
      recordingSessions: [{ startedAt: "2026-06-24T10:00:00.000Z" }],
      startUrl: "https://app.example/start",
      targetTabId: 7
    } satisfies RecorderState);

    const response = await sendMessage<{ scenario: Scenario; state: RecorderState }>({
      type: "SAVE_SCENARIO",
      payload: { name: "saved directly" }
    });

    expect(response.scenario).toMatchObject({
      name: "saved directly",
      steps: [recordedStep],
      recording: {
        sessions: [expect.objectContaining({
          startedAt: "2026-06-24T10:00:00.000Z",
          stoppedAt: expect.any(String),
        })]
      }
    });
    expectIsoDateString(response.scenario.recording.sessions[0]?.stoppedAt);
    expect(response.state).toEqual({
      status: "idle",
      currentSteps: [],
      recordingSessions: []
    });
    expect(localStorage.get("scenarioRecorder.scenarios")).toEqual([response.scenario]);
  });

  it("saves a paused recording while preserving pause session details", async () => {
    const recordedStep: Scenario["steps"][number] = {
      id: "step_save_paused",
      type: "fill",
      timestamp: 100,
      url: "https://app.example/start",
      value: "Sana",
      target: {
        tagName: "input",
        selectorCandidates: [{ type: "label", value: "Name", confidence: 90 }]
      }
    };
    localStorage.set("scenarioRecorder.recorderState", {
      status: "paused",
      currentSteps: [recordedStep],
      recordingSessions: [{
        startedAt: "2026-06-24T10:00:00.000Z",
        pausedAt: "2026-06-24T10:01:00.000Z"
      }],
      startUrl: "https://app.example/start",
      targetTabId: 7
    } satisfies RecorderState);

    const response = await sendMessage<{ scenario: Scenario; state: RecorderState }>({
      type: "SAVE_SCENARIO",
      payload: { name: "saved from pause" }
    });

    expect(response.scenario).toMatchObject({
      name: "saved from pause",
      steps: [recordedStep],
      recording: {
        sessions: [expect.objectContaining({
          startedAt: "2026-06-24T10:00:00.000Z",
          pausedAt: "2026-06-24T10:01:00.000Z",
          stoppedAt: expect.any(String),
        })]
      }
    });
    expectIsoDateString(response.scenario.recording.sessions[0]?.stoppedAt);
    expect(response.state).toEqual({
      status: "idle",
      currentSteps: [],
      recordingSessions: []
    });
    expect(localStorage.get("scenarioRecorder.scenarios")).toEqual([response.scenario]);
  });

  it("normalizes target origins without a URL scheme", async () => {
    await expect(sendMessage({
      type: "UPDATE_SETTINGS",
      payload: { allowedOrigins: ["localhost:3000"], recordingDetailLevel: "minimal" }
    })).resolves.toEqual({
      allowedOrigins: ["https://localhost:3000"],
      recordingDetailLevel: "context"
    });
  });

  it("stops reporting a tab as recording after it navigates outside target origins", async () => {
    const state: RecorderState = {
      status: "recording",
      currentSteps: [],
      recordingSessions: [{ startedAt: "2026-06-24T10:00:00.000Z" }],
      targetTabId: 1,
      startedAtMs: 100
    };
    localStorage.set("scenarioRecorder.recorderState", state);
    localStorage.set("scenarioRecorder.settings", {
      allowedOrigins: ["https://app.example"]
    });

    navigationListener({
      tabId: 1,
      frameId: 0,
      url: "https://app.example/start",
      timeStamp: 200
    } as chrome.webNavigation.WebNavigationTransitionCallbackDetails);
    await waitForTabUrl(1, "https://app.example/start");

    await expect(sendMessage(
      { type: "IS_RECORDING_TARGET" },
      { tab: { id: 1 } as chrome.tabs.Tab },
    )).resolves.toEqual({ recording: true, recordingDetailLevel: "context" });

    navigationListener({
      tabId: 1,
      frameId: 0,
      url: "https://idp.example/login",
      timeStamp: 300
    } as chrome.webNavigation.WebNavigationTransitionCallbackDetails);
    await waitForTabUrl(1, undefined);

    await sendMessage(
      {
        type: "RECORDED_STEP",
        payload: {
          step: {
            id: "delayed_step",
            type: "fill",
            timestamp: 250,
            url: "https://app.example/start",
            value: "delayed",
            target: {
              tagName: "input",
              selectorCandidates: [{ type: "label", value: "Search", confidence: 90 }]
            }
          }
        }
      },
      { tab: { id: 1 } as chrome.tabs.Tab },
    );

    await expect(sendMessage(
      { type: "IS_RECORDING_TARGET" },
      { tab: { id: 1 } as chrome.tabs.Tab },
    )).resolves.toEqual({ recording: false, recordingDetailLevel: "context" });
  });

  it("returns recording summary details for the target tab overlay", async () => {
    const state: RecorderState = {
      status: "recording",
      currentSteps: [
        {
          id: "step-1",
          type: "click",
          timestamp: 100,
          url: "https://app.example/start",
          target: {
            tagName: "button",
            selectorCandidates: [{ type: "text", value: "Save", confidence: 80 }]
          }
        },
        {
          id: "step-2",
          type: "fill",
          timestamp: 200,
          url: "https://app.example/start",
          value: "value",
          target: {
            tagName: "input",
            selectorCandidates: [{ type: "label", value: "Name", confidence: 90 }]
          }
        }
      ],
      recordingSessions: [{ startedAt: "2026-06-24T10:00:00.000Z" }],
      targetTabId: 7,
      startedAtMs: 100
    };
    localStorage.set("scenarioRecorder.recorderState", state);
    localStorage.set("scenarioRecorder.settings", {
      allowedOrigins: ["https://app.example"]
    });

    await expect(sendMessage(
      { type: "GET_RECORDING_OVERLAY_STATE" },
      { tab: { id: 7, url: "https://app.example/start?token=raw" } as chrome.tabs.Tab },
    )).resolves.toEqual({
      visible: true,
      status: "recording",
      stepCount: 2,
      lastStepType: "fill",
      currentUrl: "https://app.example/start?token=%7B%7BSECRET%7D%7D"
    });
  });

  it("hides the overlay for non-target tabs", async () => {
    localStorage.set("scenarioRecorder.recorderState", {
      status: "paused",
      currentSteps: [],
      recordingSessions: [{ startedAt: "2026-06-24T10:00:00.000Z" }],
      targetTabId: 7
    } satisfies RecorderState);

    await expect(sendMessage(
      { type: "GET_RECORDING_OVERLAY_STATE" },
      { tab: { id: 8, url: "https://app.example/start" } as chrome.tabs.Tab },
    )).resolves.toEqual({ visible: false });
  });

  it("keeps the overlay visible while the target tab recording is paused", async () => {
    localStorage.set("scenarioRecorder.recorderState", {
      status: "paused",
      currentSteps: [],
      recordingSessions: [{ startedAt: "2026-06-24T10:00:00.000Z" }],
      targetTabId: 7
    } satisfies RecorderState);
    localStorage.set("scenarioRecorder.settings", {
      allowedOrigins: ["https://app.example"]
    });

    await expect(sendMessage(
      { type: "GET_RECORDING_OVERLAY_STATE" },
      { tab: { id: 7, url: "https://app.example/start" } as chrome.tabs.Tab },
    )).resolves.toEqual({
      visible: true,
      status: "paused",
      stepCount: 0,
      lastStepType: undefined,
      currentUrl: "https://app.example/start"
    });
  });

  it("hides the overlay when the target tab leaves the configured origins", async () => {
    localStorage.set("scenarioRecorder.recorderState", {
      status: "recording",
      currentSteps: [],
      recordingSessions: [{ startedAt: "2026-06-24T10:00:00.000Z" }],
      targetTabId: 7
    } satisfies RecorderState);
    localStorage.set("scenarioRecorder.settings", {
      allowedOrigins: ["https://app.example"]
    });

    await expect(sendMessage(
      { type: "GET_RECORDING_OVERLAY_STATE" },
      { tab: { id: 7, url: "https://idp.example/login" } as chrome.tabs.Tab },
    )).resolves.toEqual({ visible: false });
  });
});
