import { describe, expect, it } from "vitest";
import type { Scenario } from "../shared/types";
import { playwrightDownloadPayload } from "./downloads";

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
  it("passes target-domain settings into Playwright generation", () => {
    expect(() =>
      playwrightDownloadPayload(secretScenario, {
        allowedOrigins: ["https://app.example"]
      })
    ).toThrow("outside target domain");
    expect(playwrightDownloadPayload(secretScenario, {
      allowedOrigins: ["https://attacker.example"]
    })).toMatchObject({
      filename: "secret-login.spec.ts",
      type: "text/typescript;charset=utf-8"
    });
  });
});
