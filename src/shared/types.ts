export type RecordingStatus = "idle" | "recording" | "paused";

export type ScenarioStepType =
  | "click"
  | "fill"
  | "select"
  | "submit"
  | "navigation"
  | "goto"
  | "wait"
  | "assert";

export type SelectorCandidateType =
  | "data-testid"
  | "data-test"
  | "data-cy"
  | "aria-label"
  | "role"
  | "label"
  | "name"
  | "id"
  | "placeholder"
  | "text"
  | "css"
  | "xpath";

export type SelectorCandidate = {
  type: SelectorCandidateType;
  value: string | Record<string, string>;
  confidence: number;
};

export type TargetSnapshot = {
  selectorCandidates: SelectorCandidate[];
  tagName: string;
  text?: string;
  ariaLabel?: string;
  role?: string;
  name?: string;
  id?: string;
  className?: string;
  dataTestId?: string;
  label?: string;
  placeholder?: string;
  inputType?: string;
  rect?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

type ScenarioStepBase = {
  id: string;
  timestamp: number;
  url: string;
  title?: string;
  target?: TargetSnapshot;
  fromUrl?: string;
  toUrl?: string;
};

export type ScenarioStep =
  | (ScenarioStepBase & {
      type: Exclude<ScenarioStepType, "assert">;
      value?: string | string[];
      assertion?: never;
    })
  | (ScenarioStepBase & {
      type: "assert";
      value?: never;
      assertion: {
        kind: "url" | "title";
        expected: string;
      };
    });

export type RecordingSession = {
  startedAt?: string;
  pausedAt?: string;
  resumedAt?: string;
  stoppedAt?: string;
};

export type ScenarioVariable = {
  type: "string" | "number" | "boolean";
  defaultValue?: string | number | boolean;
  secret?: boolean;
};

export type Scenario = {
  schemaVersion: "scenario-recorder/v1";
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
  startUrl?: string;
  baseUrl?: string;
  variables?: Record<string, ScenarioVariable>;
  recording: {
    sessions: RecordingSession[];
  };
  steps: ScenarioStep[];
  assertions?: unknown[];
  metadata: {
    userAgent: string;
    extensionVersion: string;
    recordedBy: "scenario-recorder";
  };
};

export type ScenarioExport = {
  schemaVersion: "scenario-recorder/export/v1";
  exportedAt: string;
  scenarios: Scenario[];
};

export type ScenarioRecorderSettings = {
  allowedOrigins: string[];
};

export type RecorderState = {
  status: RecordingStatus;
  currentSteps: ScenarioStep[];
  recordingSessions: RecordingSession[];
  startedAt?: string;
  pausedAt?: string;
  resumedAt?: string;
  stoppedAt?: string;
  targetTabId?: number;
  targetWindowId?: number;
  startedAtMs?: number;
};

export type RecordingOverlayState = {
  visible: true;
  status: Extract<RecordingStatus, "recording" | "paused">;
  stepCount: number;
  lastStepType?: ScenarioStepType;
  currentUrl?: string;
};
