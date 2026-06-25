import { describe, expect, it } from "vitest";
import type { Scenario } from "./types";
import { parseScenarioImport, parseScenarioImportText, scenarioToJsonl, scenariosToJsonls, scenarioToPlaywright, withDerivedSecretVariables } from "./scenarioArtifacts";

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
    const lines = scenarioToJsonl(scenario).split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);

    expect(lines[0]).toMatchObject({
      kind: "meta",
      schemaVersion: "scenario-recorder/jsonl/v1",
      scenarioSchemaVersion: "scenario-recorder/v1",
      id: scenario.id,
      name: scenario.name
    });
    expect(lines.slice(1).map((line) => [line.kind, line.index, line.id, line.type])).toEqual(
      scenario.steps.map((step, index) => [
        step.type === "assert" ? "assertion" : "step",
        index,
        step.id,
        step.type
      ])
    );
  });

  it("keeps JSONL envelope fields authoritative over imported extra fields", () => {
    const lines = scenarioToJsonl({
      ...scenario,
      recording: {
        sessions: [{
          startedAt: "2026-06-23T10:00:00.000Z",
          kind: "step",
          index: 99,
        } as never],
      },
      steps: [{
        ...scenario.steps[0],
        kind: "assertion",
        index: 42,
      } as never],
    }).split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);

    expect(lines[1]).toMatchObject({ kind: "session", index: 0 });
    expect(lines[2]).toMatchObject({ kind: "step", index: 0, id: "step_0", type: "click" });
  });

  it("imports JSONL scenarios back into scenario objects", () => {
    const scenarioWithTopLevelAssertions: Scenario = {
      ...scenario,
      assertions: [{ kind: "legacy", expected: "kept" }],
    };

    expect(parseScenarioImportText(scenarioToJsonl(scenarioWithTopLevelAssertions))).toEqual([{
      ...scenario,
      assertions: [{ kind: "legacy", expected: "kept" }],
      description: "",
      tags: [],
    }]);
  });

  it("exports and imports multiple JSONL scenarios", () => {
    const secondScenario: Scenario = {
      ...scenario,
      id: "scenario_2",
      name: "second",
      steps: scenario.steps.slice(0, 1),
    };

    expect(parseScenarioImportText(scenariosToJsonls([scenario, secondScenario]))).toEqual([
      {
        ...scenario,
        description: "",
        tags: [],
      },
      {
        ...secondScenario,
        description: "",
        tags: [],
      },
    ]);
  });

  it("exports and imports JSONL recording sessions", () => {
    const scenarioWithSession: Scenario = {
      ...scenario,
      recording: {
        sessions: [{
          startedAt: "2026-06-23T10:00:00.000Z",
          pausedAt: "2026-06-23T10:01:00.000Z",
          resumedAt: "2026-06-23T10:02:00.000Z",
          stoppedAt: "2026-06-23T10:03:00.000Z",
        }],
      },
      steps: [],
    };
    const lines = scenarioToJsonl(scenarioWithSession)
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);

    expect(lines[1]).toMatchObject({
      kind: "session",
      index: 0,
      startedAt: "2026-06-23T10:00:00.000Z",
    });
    expect(parseScenarioImportText(scenarioToJsonl(scenarioWithSession))[0].recording.sessions).toEqual(
      scenarioWithSession.recording.sessions,
    );
  });

  it("preserves JSONL event line order when importing scenarios", () => {
    const [metaLine, firstStepLine, secondStepLine] = scenarioToJsonl({
      ...scenario,
      steps: scenario.steps.slice(0, 2),
    }).split("\n");
    const firstStep = JSON.parse(firstStepLine) as Record<string, unknown>;
    const secondStep = JSON.parse(secondStepLine) as Record<string, unknown>;
    const imported = parseScenarioImportText([
      metaLine,
      JSON.stringify({ ...secondStep, index: 0 }),
      JSON.stringify({ ...firstStep, index: 1 }),
    ].join("\n"));

    expect(imported[0].steps.map((step) => step.id)).toEqual(["step_1", "step_0"]);
  });

  it("rejects invalid JSONL event lines instead of dropping them", () => {
    const [metaLine, stepLine] = scenarioToJsonl({
      ...scenario,
      steps: scenario.steps.slice(0, 1),
    }).split("\n");
    const invalidStep = JSON.parse(stepLine) as Record<string, unknown>;
    delete invalidStep.id;

    expect(() => parseScenarioImportText([
      metaLine,
      JSON.stringify(invalidStep),
    ].join("\n"))).toThrow("scenario-recorder/jsonl/v1 の2行目が不正です。");
    expect(() => parseScenarioImportText([
      metaLine,
      JSON.stringify({ kind: "note", index: 0, text: "unsupported" }),
    ].join("\n"))).toThrow("scenario-recorder/jsonl/v1 の2行目が不正です。");
    expect(() => parseScenarioImportText([
      metaLine,
      JSON.stringify({ kind: "session", index: 0, startedAt: 123 }),
    ].join("\n"))).toThrow("scenario-recorder/jsonl/v1 の2行目が不正です。");
    expect(() => parseScenarioImportText([
      metaLine,
      JSON.stringify({ ...scenario.steps[0], kind: "assertion", index: 0 }),
    ].join("\n"))).toThrow("scenario-recorder/jsonl/v1 の2行目が不正です。");
    expect(() => parseScenarioImportText([
      metaLine,
      JSON.stringify({ ...scenario.steps[2], kind: "step", index: 0 }),
    ].join("\n"))).toThrow("scenario-recorder/jsonl/v1 の2行目が不正です。");
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
    }, { allowedOrigins: ["https://example.com"] });

    expect(code).toContain("function getRequiredEnv(name: string): string");
    expect(code).toContain("async function assertAllowedOrigin(page: import('@playwright/test').Page): Promise<void>");
    expect(code).toContain("  const password = getRequiredEnv(\"SCENARIO_RECORDER_PASSWORD\");");
    expect(code).toContain("  const secret = getRequiredEnv(\"SCENARIO_RECORDER_SECRET\");");
    expect(code).toContain("  await page.goto(\"https://example.com/login\");");
    expect(code).toContain("  await page.getByRole(\"button\", { name: \"Sign in\" }).click();");
    expect(code).toContain("  await assertAllowedOrigin(page);\n  await page.getByLabel(\"Password\").fill(password);");
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
    expect(code).toContain("  await assertAllowedOrigin(page);\n  await page.locator(\"[name=\\\"secretChoice\\\"]\").selectOption([secret]);");
    expect(code).toContain("  await page.locator(\"[name=\\\"secretChoice\\\"]\").selectOption([secret]);");
    expect(code).toContain("  await page.goto(\"https://example.com/unsupported\");");
    expect(code).toContain("  await page.waitForLoadState(\"networkidle\");");
    expect(code).toContain("  await expect(page).toHaveURL(new RegExp(\"^https://example\\\\.com/callback\\\\?code=[^/?#&]+$\"));");
    expect(code).toContain("Unsupported assertion step");
    const orderedFragments = [
      "  await page.goto(\"https://example.com/login\");",
      "  await page.getByRole(\"button\", { name: \"Sign in\" }).click();",
      "  await assertAllowedOrigin(page);",
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
      variables: {
        "class": { type: "string", defaultValue: "{{PASSWORD}}", secret: true },
        "secret-value": { type: "string", defaultValue: "{{SECRET}}", secret: true },
        "secret_value": { type: "string", defaultValue: "{{CREDIT_CARD}}", secret: true }
      },
      steps: [{
        id: "step_dot_id",
        type: "fill",
        timestamp: 0,
        url: "https://example.com",
        value: "{{PASSWORD}}",
        target: {
          tagName: "input",
          selectorCandidates: [{ type: "id", value: "user.email", confidence: 90 }]
        }
      }]
    }, { allowedOrigins: ["https://example.com"] })).toContain("  const classValue = getRequiredEnv(\"SCENARIO_RECORDER_PASSWORD\");");
    expect(scenarioToPlaywright({
      ...scenario,
      variables: {
        "class": { type: "string", defaultValue: "{{PASSWORD}}", secret: true },
        "secret-value": { type: "string", defaultValue: "{{SECRET}}", secret: true },
        "secret_value": { type: "string", defaultValue: "{{CREDIT_CARD}}", secret: true }
      },
      steps: [{
        id: "step_dot_id",
        type: "fill",
        timestamp: 0,
        url: "https://example.com",
        value: "{{PASSWORD}}",
        target: {
          tagName: "input",
          selectorCandidates: [{ type: "id", value: "user.email", confidence: 90 }]
        }
      }]
    }, { allowedOrigins: ["https://example.com"] })).toContain("  const secret_value_2 = getRequiredEnv(\"SCENARIO_RECORDER_CREDIT_CARD\");");
    expect(scenarioToPlaywright({
      ...scenario,
      variables: {
        "class": { type: "string", defaultValue: "{{PASSWORD}}", secret: true },
        "secret-value": { type: "string", defaultValue: "{{SECRET}}", secret: true },
        "secret_value": { type: "string", defaultValue: "{{CREDIT_CARD}}", secret: true }
      },
      steps: [{
        id: "step_dot_id",
        type: "fill",
        timestamp: 0,
        url: "https://example.com",
        value: "{{PASSWORD}}",
        target: {
          tagName: "input",
          selectorCandidates: [{ type: "id", value: "user.email", confidence: 90 }]
        }
      }]
    }, { allowedOrigins: ["https://example.com"] })).toContain("  await page.locator(\"[id=\\\"user.email\\\"]\").fill(classValue);");
    expect(scenarioToPlaywright({
      ...scenario,
      variables: {
        "let": { type: "string", defaultValue: "{{PASSWORD}}", secret: true }
      },
      steps: [{
        id: "reserved_identifier",
        type: "fill",
        timestamp: 0,
        url: "https://example.com",
        value: "{{PASSWORD}}",
        target: {
          tagName: "input",
          selectorCandidates: [{ type: "label", value: "Password", confidence: 90 }]
        }
      }]
    }, { allowedOrigins: ["https://example.com"] })).toContain("  const letValue = getRequiredEnv(\"SCENARIO_RECORDER_PASSWORD\");");
    const importedSecretNameCode = scenarioToPlaywright({
      ...scenario,
      variables: {
        AWS_SECRET_ACCESS_KEY: { type: "string", defaultValue: "{{SECRET}}", secret: true }
      },
      steps: [{
        id: "imported_secret_name",
        type: "fill",
        timestamp: 0,
        url: "https://example.com",
        value: "{{SECRET}}",
        target: {
          tagName: "input",
          selectorCandidates: [{ type: "label", value: "API token", confidence: 90 }]
        }
      }]
    }, { allowedOrigins: ["https://example.com"] });
    expect(importedSecretNameCode).toContain("getRequiredEnv(\"SCENARIO_RECORDER_SECRET\")");
    expect(importedSecretNameCode).not.toContain("getRequiredEnv(\"AWS_SECRET_ACCESS_KEY\")");
  });

  it("prefers labels over verbose roles for form controls", () => {
    const code = scenarioToPlaywright({
      ...scenario,
      variables: {},
      steps: [{
        id: "step_form_label",
        type: "select",
        timestamp: 1,
        url: "https://example.com/settings",
        value: "okinawa",
        target: {
          tagName: "select",
          selectorCandidates: [
            { type: "role", value: { role: "combobox", name: "Destination Tokyo Osaka Okinawa" }, confidence: 88 },
            { type: "label", value: "Destination", confidence: 85 }
          ]
        }
      }]
    });

    expect(code).toContain("  await page.getByLabel(\"Destination\").selectOption(\"okinawa\");");
  });

  it("disambiguates repeated controls with their recorded same-label position", () => {
    const code = scenarioToPlaywright({
      ...scenario,
      variables: {},
      steps: [{
        id: "step_repeated_button",
        type: "click",
        timestamp: 1,
        url: "https://example.com/plans",
        target: {
          tagName: "button",
          text: "Choose",
          selectorCandidates: [
            { type: "role", value: { role: "button", name: "Choose" }, confidence: 88 }
          ],
          contextSummary: {
            heading: "Pro plan",
            sameLabel: { value: "Choose", index: 2, count: 2 }
          }
        }
      }]
    });

    expect(code).toContain("  await page.getByRole(\"button\", { name: \"Choose\" }).nth(1).click();");
  });

  it("generates regexp URL assertions for encoded secret masks", () => {
    expect(scenarioToPlaywright({
      ...scenario,
      steps: [{
        id: "encoded_assert",
        type: "assert",
        timestamp: 0,
        url: "https://example.com/callback?code=%7B%7BSECRET%7D%7D",
        assertion: { kind: "url", expected: "https://example.com/callback?code=%7B%7BSECRET%7D%7D" }
      }]
    }, { allowedOrigins: ["https://example.com"] })).toContain(
      "  await expect(page).toHaveURL(new RegExp(\"^https://example\\\\.com/callback\\\\?code=[^/?#&]+$\"));"
    );
  });

  it("blocks Playwright generation with secret variables outside allowed target origins", () => {
    expect(() => scenarioToPlaywright(scenario)).toThrow("Set target origins");
    expect(() =>
      scenarioToPlaywright({
        ...scenario,
        startUrl: "https://attacker.example/login",
        steps: [{
          id: "external_secret",
          type: "fill",
          timestamp: 0,
          url: "https://attacker.example/login",
          value: "{{PASSWORD}}",
          target: {
            tagName: "input",
            selectorCandidates: [{ type: "label", value: "Password", confidence: 90 }]
          }
        }]
      }, { allowedOrigins: ["https://example.com"] })
    ).toThrow("outside target origin");
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
    expect(withDerivedSecretVariables({
      ...scenario,
      variables: {
        password: {
          type: "string",
          secret: true
        }
      }
    }).variables?.password).toEqual({
      type: "string",
      defaultValue: "{{PASSWORD}}",
      secret: true
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
    expect("unexpected" in parseScenarioImport({
      ...scenario,
      unexpected: "ignored"
    })[0]).toBe(false);
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
        variables: { broken: null }
      })
    ).toThrow("scenario-recorder/v1");
    expect(() =>
      parseScenarioImport({
        ...scenario,
        variables: { broken: { type: "string", defaultValue: [] } }
      })
    ).toThrow("scenario-recorder/v1");
    expect(() =>
      parseScenarioImport({
        ...scenario,
        variables: { password: { type: "string", defaultValue: "actual-secret", secret: true } }
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
        steps: [{ ...scenario.steps[1], value: undefined }]
      })
    ).toThrow("scenario-recorder/v1");
    expect(() =>
      parseScenarioImport({
        ...scenario,
        steps: [{ ...scenario.steps[2], assertion: undefined }]
      })
    ).toThrow("scenario-recorder/v1");
    expect(() =>
      parseScenarioImport({
        ...scenario,
        steps: [{
          ...scenario.steps[0],
          assertion: { kind: "url", expected: "https://example.com" }
        }]
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
