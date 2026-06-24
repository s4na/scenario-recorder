import type {
  RecorderState,
  RecordingOverlayState,
  Scenario,
  ScenarioExport,
  ScenarioRecorderSettings,
  ScenarioStep,
} from "./types";

export type MessageMap = {
  START_RECORDING: {
    payload: undefined;
    response: RecorderState;
  };
  PAUSE_RECORDING: {
    payload: undefined;
    response: RecorderState;
  };
  RESUME_RECORDING: {
    payload: undefined;
    response: RecorderState;
  };
  STOP_RECORDING: {
    payload: undefined;
    response: RecorderState;
  };
  CLEAR_RECORDING: {
    payload: undefined;
    response: RecorderState;
  };
  GET_RECORDER_STATE: {
    payload: undefined;
    response: RecorderState;
  };
  IS_RECORDING_TARGET: {
    payload: undefined;
    response: { recording: boolean; recordingDetailLevel: ScenarioRecorderSettings["recordingDetailLevel"] };
  };
  GET_RECORDING_OVERLAY_STATE: {
    payload: undefined;
    response: RecordingOverlayState | { visible: false };
  };
  RECORDED_STEP: {
    payload: { step: ScenarioStep };
    response: RecorderState;
  };
  SAVE_SCENARIO: {
    payload: { name: string };
    response: { scenario: Scenario; state: RecorderState };
  };
  UPDATE_SCENARIO: {
    payload: { scenarioId: string; name: string; description: string; tags: string[] };
    response: { scenarios: Scenario[] };
  };
  IMPORT_SCENARIOS: {
    payload: { scenarios: Scenario[] };
    response: { scenarios: Scenario[] };
  };
  ADD_ASSERTION_STEP: {
    payload: { kind: "url" | "title" };
    response: RecorderState;
  };
  DELETE_SCENARIO: {
    payload: { scenarioId: string };
    response: { scenarios: Scenario[] };
  };
  GET_SCENARIOS: {
    payload: undefined;
    response: { scenarios: Scenario[] };
  };
  EXPORT_SCENARIO: {
    payload: { scenarioId: string };
    response: { scenario?: Scenario };
  };
  EXPORT_ALL_SCENARIOS: {
    payload: undefined;
    response: ScenarioExport;
  };
  GET_SETTINGS: {
    payload: undefined;
    response: ScenarioRecorderSettings;
  };
  UPDATE_SETTINGS: {
    payload: ScenarioRecorderSettings;
    response: ScenarioRecorderSettings;
  };
};

export type MessageType = keyof MessageMap;

export type RuntimeMessage<TType extends MessageType = MessageType> = {
  [K in MessageType]: MessageMap[K]["payload"] extends undefined
    ? { type: K }
    : { type: K; payload: MessageMap[K]["payload"] };
}[TType];

export type RuntimeResponse<TType extends MessageType> = MessageMap[TType]["response"];

export type ContentMessageMap = {
  FLUSH_PENDING_INPUTS: {
    payload: undefined;
    response: { ok: true } | { error: string };
  };
};

export type ContentMessageType = keyof ContentMessageMap;

export type ContentMessage<TType extends ContentMessageType = ContentMessageType> = {
  [K in ContentMessageType]: ContentMessageMap[K]["payload"] extends undefined
    ? { type: K }
    : { type: K; payload: ContentMessageMap[K]["payload"] };
}[TType];

export function sendRuntimeMessage<TType extends MessageType>(
  message: RuntimeMessage<TType>
): Promise<RuntimeResponse<TType>> {
  return chrome.runtime.sendMessage(message).then((response) => {
    if (response && typeof response === "object" && "error" in response) {
      throw new Error(String(response.error));
    }
    return response as RuntimeResponse<TType>;
  });
}
