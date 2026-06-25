import type { RecordingSession, Scenario, ScenarioStep } from "./types";

export function scenarioToJsonl(scenario: Scenario): string {
  return scenarioToJsonlLines(scenario).map((line) => JSON.stringify(line)).join("\n");
}

export function scenariosToJsonls(scenarios: Scenario[]): string {
  return scenarios.map((scenario) => scenarioToJsonl(scenario)).join("\n");
}

export type ScenarioJsonlLine =
  | {
      kind: "meta";
      schemaVersion: "scenario-recorder/jsonl/v1";
      scenarioSchemaVersion: Scenario["schemaVersion"];
      id: string;
      name: string;
      description?: string;
      tags?: string[];
      createdAt: string;
      updatedAt: string;
      startUrl?: string;
      baseUrl?: string;
      variables?: Scenario["variables"];
      assertions?: Scenario["assertions"];
      metadata: Scenario["metadata"];
    }
  | ({ kind: "session"; index: number } & RecordingSession)
  | ({ kind: "step"; index: number } & Exclude<ScenarioStep, { type: "assert" }>)
  | ({ kind: "assertion"; index: number } & Extract<ScenarioStep, { type: "assert" }>);

function scenarioToJsonlLines(scenario: Scenario): ScenarioJsonlLine[] {
  return [
    {
      kind: "meta",
      schemaVersion: "scenario-recorder/jsonl/v1",
      scenarioSchemaVersion: scenario.schemaVersion,
      id: scenario.id,
      name: scenario.name,
      description: scenario.description,
      tags: scenario.tags,
      createdAt: scenario.createdAt,
      updatedAt: scenario.updatedAt,
      startUrl: scenario.startUrl,
      baseUrl: scenario.baseUrl,
      variables: scenario.variables,
      assertions: scenario.assertions,
      metadata: scenario.metadata,
    },
    ...scenario.recording.sessions.map((session, index) => ({
      ...session,
      kind: "session" as const,
      index,
    })),
    ...scenario.steps.map((step, index): ScenarioJsonlLine => {
      if (step.type === "assert") {
        return { ...step, kind: "assertion", index };
      }
      return { ...step, kind: "step", index };
    }),
  ];
}
