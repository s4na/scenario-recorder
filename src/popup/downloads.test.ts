import { describe, expect, it } from "vitest";
import type { Scenario } from "../shared/types";
import {
  allScenariosZipEntries,
  allScenariosZipFileName,
  playwrightDownloadPayload,
  scenarioZipEntries,
  scenarioZipFileName
} from "./downloads";

const secretScenario: Scenario = {
  schemaVersion: "scenario-recorder/v1",
  id: "scenario_secret",
  name: "secret login",
  createdAt: "2026-06-23T10:00:00.000Z",
  updatedAt: "2026-06-23T10:00:00.000Z",
  startUrl: "https://attacker.example/login",
  variables: {
    password: {
      type: "string",
      defaultValue: "{{PASSWORD}}",
      secret: true
    }
  },
  recording: { sessions: [] },
  steps: [{
    id: "step_secret",
    type: "fill",
    timestamp: 0,
    url: "https://attacker.example/login",
    value: "{{PASSWORD}}",
    target: {
      tagName: "input",
      selectorCandidates: [{ type: "label", value: "Password", confidence: 90 }]
    }
  }],
  metadata: {
    userAgent: "test",
    extensionVersion: "0.1.0",
    recordedBy: "scenario-recorder"
  }
};

describe("popup downloads", () => {
  it("passes target-origin settings into Playwright generation", () => {
    expect(() =>
      playwrightDownloadPayload(secretScenario, {
        allowedOrigins: ["https://app.example"],
        recordingDetailLevel: "minimal"
      })
    ).toThrow("outside target origin");
    expect(playwrightDownloadPayload(secretScenario, {
      allowedOrigins: ["https://attacker.example"],
      recordingDetailLevel: "minimal"
    })).toMatchObject({
      filename: "secret-login.spec.ts",
      type: "text/typescript;charset=utf-8"
    });
  });

  it("bundles one scenario as Playwright code plus the source JSONL", () => {
    const entries = scenarioZipEntries(secretScenario, {
      allowedOrigins: ["https://attacker.example"],
      recordingDetailLevel: "context"
    });

    expect(scenarioZipFileName(secretScenario)).toBe("secret-login.zip");
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      name: "secret-login.spec.ts"
    });
    expect(entries[0].text).toContain("import { test, expect } from '@playwright/test';");
    expect(entries[0].text).toContain("getRequiredEnv(\"SCENARIO_RECORDER_PASSWORD\")");
    expect(entries[1]).toMatchObject({
      name: "secret-login.jsonl"
    });
    expect(entries[1].text.split("\n")[0]).toContain("\"schemaVersion\":\"scenario-recorder/jsonl/v1\"");
  });

  it("bundles all scenarios under stable per-scenario directories", () => {
    const entries = allScenariosZipEntries([
      secretScenario,
      { ...secretScenario, id: "scenario_secret_2" }
    ], {
      allowedOrigins: ["https://attacker.example"],
      recordingDetailLevel: "context"
    });

    expect(allScenariosZipFileName(new Date("2026-06-25T12:40:00"))).toBe("scenario-records-20260625-124000.zip");
    expect(entries.map((entry) => entry.name)).toEqual([
      "secret-login/secret-login.spec.ts",
      "secret-login/secret-login.jsonl",
      "secret-login-2/secret-login.spec.ts",
      "secret-login-2/secret-login.jsonl"
    ]);
  });
});
