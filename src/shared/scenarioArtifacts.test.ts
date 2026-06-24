import { describe, expect, it } from "vitest";
import type { Scenario } from "./types";
import { parseScenarioImport, scenarioToJsonl, scenarioToPlaywright, withDerivedSecretVariables } from "./scenarioArtifacts";

const scenario: Scenario = {
  schemaVersion: "scenario-recorder/v1",
  id: "scenario_1",
  name: "login",
  createdAt: "2026-06-23T10:00:00.000Z",
  updatedAt: "2026-06-23T10:00:00.000Z",
  startUrl: "https://example.com/login",
  baseUrl: "https://example.com",
  variables: {
    password: {
      type: "string",
      defaultValue: "{{PASSWORD}}",
      secret: true
    },
    secret: {
      type: "string",
      defaultValue: "{{SECRET}}",
      secret: true
    }
  },
  recording: { sessions: [] },
  steps: [
    {
      id: "step_0",
      type: "click",
      timestamp: 0,
      url: "https://example.com/login",
      target: {
        tagName: "button",
        selectorCandidates: [{ type: "role", value: { role: "button", name: "Sign in" }, confidence: 95 }]
      }
    },
    {
      id: "step_1",
      type: "fill",
      timestamp: 1,
      url: "https://example.com/login",
      value: "{{PASSWORD}}",
      target: {
        tagName: "input",
        selectorCandidates: [{ type: "label", value: "Password", confidence: 90 }]
      }
    },
    {
      id: "step_2",
      type: "assert",
      timestamp: 2,
      url: "https://example.com/dashboard",
      assertion: { kind: "url", expected: "https://example.com/dashboard" }
    },
    {
      id: "step_3",
      type: "select",
      timestamp: 3,
      url: "https://example.com/settings",
      value: "admin",
      target: {
        tagName: "select",
        selectorCandidates: [{ type: "css", value: "select[name=\"role\"]", confidence: 70 }]
      }
    },
    {
      id: "step_4",
      type: "submit",
      timestamp: 4,
      url: "https://example.com/settings",
      target: {
        tagName: "form",
        selectorCandidates: [{ type: "css", value: "form#settings", confidence: 80 }]
      }
    },
    {
      id: "step_5",
      type: "navigation",
      timestamp: 5,
      url: "https://example.com/done",
      toUrl: "https://example.com/done"
    },
    {
      id: "step_6",
      type: "assert",
      timestamp: 6,
      url: "https://example.com/done",
      assertion: { kind: "title", expected: "Done" }
    },
    {
      id: "step_7",
      type: "click",
      timestamp: 7,
      url: "https://example.com/done"
    },
    {
      id: "step_8",
      type: "fill",
      timestamp: 8,
      url: "https://example.com/done",
      value: "search",
      target: {
        tagName: "input",
        selectorCandidates: [{ type: "placeholder", value: "Search", confidence: 80 }]
      }
    },
    {
      id: "step_9",
      type: "click",
      timestamp: 9,
      url: "https://example.com/done",
      target: {
        tagName: "a",
        selectorCandidates: [{ type: "text", value: "Details", confidence: 70 }]
      }
    },
    {
      id: "step_10",
      type: "click",
      timestamp: 10,
      url: "https://example.com/done",
      target: {
        tagName: "button",
        selectorCandidates: [{ type: "data-testid", value: "confirm-button", confidence: 90 }]
      }
    },
    {
      id: "step_11",
      type: "select",
      timestamp: 11,
      url: "https://example.com/done",
      value: ["{{SECRET}}"],
      target: {
        tagName: "select",
        selectorCandidates: [{ type: "name", value: "secretChoice", confidence: 60 }]
      }
    },
    {
      id: "step_12",
      type: "goto",
      timestamp: 12,
      url: "https://example.com/unsupported",
      target: {
        tagName: "a",
        selectorCandidates: [{ type: "text", value: "Unsupported", confidence: 20 }]
      }
    },
    {
      id: "step_13",
      type: "wait",
      timestamp: 13,
      url: "https://example.com/unsupported"
    },
    {
      id: "step_14",
      type: "click",
      timestamp: 14,
      url: "https://example.com/unsupported",
      target: {
        tagName: "button",
        selectorCandidates: [
          { type: "id", value: "save-button", confidence: 80 },
          { type: "aria-label", value: "Save", confidence: 70 },
          { type: "data-test", value: "save-action", confidence: 60 }
        ]
      }
    },
    {
      id: "step_15",
      type: "click",
      timestamp: 15,
      url: "https://example.com/unsupported",
      target: {
        tagName: "button",
        selectorCandidates: [
          { type: "data-cy", value: "confirm-action", confidence: 60 }
        ]
      }
    },
    {
      id: "step_16",
      type: "click",
      timestamp: 16,
      url: "https://example.com/unsupported",
      target: {
        tagName: "button",
        selectorCandidates: [
          { type: "aria-label", value: "Close", confidence: 70 }
        ]
      }
    },
    {
      id: "step_17",
      type: "click",
      timestamp: 17,
      url: "https://example.com/unsupported",
      target: {
        tagName: "button",
        selectorCandidates: [
          { type: "data-test", value: "delete-action", confidence: 60 }
        ]
      }
    }
  ],
  assertions: [],
  metadata: {
    userAgent: "test",
    extensionVersion: "0.1.0",
    recordedBy: "scenario-recorder"
  }
};

describe("scenario artifacts", () => {
  it("exports steps as JSONL", () => {
    expect(scenarioToJsonl(scenario).split("\n").map((line) => JSON.parse(line) as unknown)).toEqual(
      scenario.steps
    );
  });

  it("generates Playwright code from selectors and assertions", () => {
    const code = scenarioToPlaywright({
      ...scenario,
      steps: [
        ...scenario.steps,
        {
          id: "step_18",
          type: "assert",
          timestamp: 18,
          url: "https://example.com/unsupported",
          assertion: { kind: "text", expected: "Saved" } as never
        },
        {
          id: "step_19",
          type: "assert",
          timestamp: 19,
          url: "https://example.com/callback?code={{SECRET}}",
          assertion: { kind: "url", expected: "https://example.com/callback?code={{SECRET}}" }
        }
      ]
    });

    expect(code).toContain("function getRequiredEnv(name: string): string");
    expect(code).toContain("  const password = getRequiredEnv(\"PASSWORD\");");
    expect(code).toContain("  const secret = getRequiredEnv(\"SECRET\");");
    expect(code).toContain("  await page.goto(\"https://example.com/login\");");
    expect(code).toContain("  await page.getByRole(\"button\", { name: \"Sign in\" }).click();");
    expect(code).toContain("  await page.getByLabel(\"Password\").fill(password);");
    expect(code).toContain("  await page.locator(\"select[name=\\\"role\\\"]\").selectOption(\"admin\");");
    expect(code).toContain("  await page.locator(\"form#settings\").evaluate");
    expect(code).toContain("  await page.waitForURL(\"https://example.com/done\");");
    expect(code).toContain("  await expect(page).toHaveURL(\"https://example.com/dashboard\");");
    expect(code).toContain("  await expect(page).toHaveTitle(\"Done\");");
    expect(code).toContain("Skipped click: no selector candidate");
    expect(code).toContain("  await page.getByPlaceholder(\"Search\").fill(\"search\");");
    expect(code).toContain("  await page.getByText(\"Details\").click();");
    expect(code).toContain("  await page.getByTestId(\"confirm-button\").click();");
    expect(code).toContain("  await page.locator(\"[name=\\\"secretChoice\\\"]\").selectOption([secret]);");
    expect(code).toContain("  await page.goto(\"https://example.com/unsupported\");");
    expect(code).toContain("  await page.waitForLoadState(\"networkidle\");");
    expect(code).toContain("  await expect(page).toHaveURL(new RegExp(\"^https://example\\\\.com/callback\\\\?code=[^/?#&]+$\"));");
    expect(code).toContain("Unsupported assertion step");
    const orderedFragments = [
      "  await page.goto(\"https://example.com/login\");",
      "  await page.getByRole(\"button\", { name: \"Sign in\" }).click();",
      "  await page.getByLabel(\"Password\").fill(password);",
      "  await expect(page).toHaveURL(\"https://example.com/dashboard\");",
      "  await page.locator(\"select[name=\\\"role\\\"]\").selectOption(\"admin\");",
      "  await page.locator(\"form#settings\").evaluate",
      "  await page.waitForURL(\"https://example.com/done\");",
      "  await expect(page).toHaveTitle(\"Done\");",
      "Skipped click: no selector candidate",
      "  await page.getByPlaceholder(\"Search\").fill(\"search\");",
      "  await page.getByText(\"Details\").click();",
      "  await page.getByTestId(\"confirm-button\").click();",
      "  await page.locator(\"[name=\\\"secretChoice\\\"]\").selectOption([secret]);",
      "  await page.goto(\"https://example.com/unsupported\");",
      "  await page.waitForLoadState(\"networkidle\");",
      "  await page.locator(\"[id=\\\"save-button\\\"]\").click();",
      "  await page.locator(\"[data-cy=\\\"confirm-action\\\"]\").click();",
      "  await page.getByLabel(\"Close\").click();",
      "  await page.locator(\"[data-test=\\\"delete-action\\\"]\").click();",
      "Unsupported assertion step",
      "  await expect(page).toHaveURL(new RegExp(\"^https://example\\\\.com/callback\\\\?code=[^/?#&]+$\"));"
    ];
    expect(orderedFragments.map((fragment) => code.indexOf(fragment))).toEqual(
      orderedFragments.map(() => expect.any(Number))
    );
    expect(orderedFragments.map((fragment) => code.indexOf(fragment))).toEqual(
      orderedFragments.map((fragment) => code.indexOf(fragment)).sort((a, b) => a - b)
    );
    expect(scenarioToPlaywright({
      ...scenario,
      steps: [{
        id: "step_dot_id",
        type: "click",
        timestamp: 0,
        url: "https://example.com",
        target: {
          tagName: "input",
          selectorCandidates: [{ type: "id", value: "user.email", confidence: 90 }]
        }
      }]
    })).toContain("  await page.locator(\"[id=\\\"user.email\\\"]\").click();");
  });

  it("derives secret variables from masked values", () => {
    expect(withDerivedSecretVariables(scenario).variables).toMatchObject({
      password: {
        type: "string",
        defaultValue: "{{PASSWORD}}",
        secret: true
      },
      secret: {
        type: "string",
        defaultValue: "{{SECRET}}",
        secret: true
      }
    });
    expect(withDerivedSecretVariables({
      ...scenario,
      variables: {
        password: {
          type: "string",
          defaultValue: "user-defined",
          secret: false
        }
      }
    }).variables?.password).toEqual({
      type: "string",
      defaultValue: "user-defined",
      secret: false
    });
  });

  it("parses single scenario and export payloads", () => {
    const [importedScenario] = parseScenarioImport({
      ...scenario,
      variables: undefined,
      assertions: undefined,
      tags: undefined,
      description: undefined
    });

    expect(importedScenario).toMatchObject({
      description: "",
      tags: [],
      assertions: [],
      variables: {
        password: {
          type: "string",
          defaultValue: "{{PASSWORD}}",
          secret: true
        }
      }
    });
    expect(parseScenarioImport([{
      ...scenario,
      variables: undefined,
      assertions: undefined,
      tags: undefined,
      description: undefined
    }])[0]).toMatchObject({
      description: "",
      tags: [],
      assertions: [],
      variables: {
        secret: {
          type: "string",
          defaultValue: "{{SECRET}}",
          secret: true
        }
      }
    });
    expect(parseScenarioImport({
      schemaVersion: "scenario-recorder/export/v1",
      exportedAt: "2026-06-23T10:00:00.000Z",
      scenarios: [{
        ...scenario,
        variables: undefined,
        assertions: undefined,
        tags: undefined,
        description: undefined
      }]
    })[0]).toMatchObject({
      description: "",
      tags: [],
      assertions: [],
      variables: {
        password: {
          type: "string",
          defaultValue: "{{PASSWORD}}",
          secret: true
        }
      }
    });
  });

  it("rejects non-scenario imports", () => {
    expect(() => parseScenarioImport({ schemaVersion: "not-this-schema" })).toThrow(
      "scenario-recorder/v1"
    );
    expect(() =>
      parseScenarioImport({
        ...scenario,
        steps: [{
          id: "broken",
          type: "click",
          timestamp: 1,
          url: "https://example.com",
          target: { tagName: "button" }
        }]
      })
    ).toThrow("scenario-recorder/v1");
    expect(() =>
      parseScenarioImport({
        ...scenario,
        createdAt: undefined
      })
    ).toThrow("scenario-recorder/v1");
    expect(() =>
      parseScenarioImport({
        ...scenario,
        metadata: { ...scenario.metadata, recordedBy: "someone-else" }
      })
    ).toThrow("scenario-recorder/v1");
    expect(() =>
      parseScenarioImport({
        ...scenario,
        steps: [{ ...scenario.steps[0], type: "unknown" }]
      })
    ).toThrow("scenario-recorder/v1");
    expect(() =>
      parseScenarioImport({
        ...scenario,
        tags: "not-tags"
      })
    ).toThrow("scenario-recorder/v1");
    expect(() =>
      parseScenarioImport({
        ...scenario,
        variables: []
      })
    ).toThrow("scenario-recorder/v1");
    expect(() =>
      parseScenarioImport({
        ...scenario,
        steps: [{ ...scenario.steps[1], value: ["a", "b"] }]
      })
    ).toThrow("scenario-recorder/v1");
    expect(() =>
      parseScenarioImport({
        ...scenario,
        steps: [{
          ...scenario.steps[0],
          target: {
            tagName: "button",
            selectorCandidates: [{ type: "unknown", value: "x", confidence: 1 }]
          }
        }]
      })
    ).toThrow("scenario-recorder/v1");
  });
});
