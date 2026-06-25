import { MASK_TOKENS, SELECTOR_CANDIDATE_TYPES } from "./scenarioConstants";

/* oxlint-disable unicorn/no-thenable -- JSON Schema uses the `then` keyword. */
export const SCENARIO_JSON_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://s4na.github.io/scenario-recorder/schema/scenario-recorder-v1.json",
  title: "Scenario Recorder Scenario",
  type: "object",
  required: ["schemaVersion", "id", "name", "createdAt", "updatedAt", "recording", "steps", "metadata"],
  properties: {
    schemaVersion: { const: "scenario-recorder/v1" },
    id: { type: "string" },
    name: { type: "string" },
    description: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
    startUrl: { type: "string" },
    baseUrl: { type: "string" },
    variables: {
      type: "object",
      additionalProperties: {
        type: "object",
        required: ["type"],
        properties: {
          type: { enum: ["string", "number", "boolean"] },
          defaultValue: { oneOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }] },
          secret: { type: "boolean" }
        },
        allOf: [{
          if: { properties: { secret: { const: true } }, required: ["secret", "defaultValue"] },
          then: { properties: { defaultValue: { enum: MASK_TOKENS } } }
        }],
        additionalProperties: true
      }
    },
    recording: {
      type: "object",
      required: ["sessions"],
      properties: {
        sessions: { type: "array" }
      }
    },
    steps: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "type", "timestamp", "url"],
        properties: {
          id: { type: "string" },
          type: { enum: ["click", "fill", "select", "selection", "submit", "navigation", "goto", "wait", "assert"] },
          timestamp: { type: "number" },
          url: { type: "string" },
          title: { type: "string" },
          value: { oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] },
          fromUrl: { type: "string" },
          toUrl: { type: "string" },
          target: {
            type: "object",
            required: ["selectorCandidates", "tagName"],
            properties: {
              selectorCandidates: {
                type: "array",
                items: {
                  type: "object",
                  required: ["type", "value", "confidence"],
                  properties: {
                    type: { enum: SELECTOR_CANDIDATE_TYPES },
                    value: { oneOf: [{ type: "string" }, { type: "object" }] },
                    confidence: { type: "number" }
                  },
                  allOf: [
                    {
                      if: { properties: { type: { const: "role" } } },
                      then: {
                        properties: {
                          value: {
                            type: "object",
                            required: ["role"],
                            properties: {
                              role: { type: "string" },
                              name: { type: "string" }
                            },
                            additionalProperties: true
                          }
                        }
                      }
                    },
                    {
                      if: { properties: { type: { enum: SELECTOR_CANDIDATE_TYPES.filter((type) => type !== "role") } } },
                      then: { properties: { value: { type: "string" } } }
                    }
                  ],
                  additionalProperties: true
                }
              },
              tagName: { type: "string" },
              text: { type: "string" },
              ariaLabel: { type: "string" },
              role: { type: "string" },
              name: { type: "string" },
              id: { type: "string" },
              className: { type: "string" },
              dataTestId: { type: "string" },
              label: { type: "string" },
              placeholder: { type: "string" },
              inputType: { type: "string" },
              rect: {
                type: "object",
                required: ["x", "y", "width", "height"],
                properties: {
                  x: { type: "number" },
                  y: { type: "number" },
                  width: { type: "number" },
                  height: { type: "number" }
                }
              },
              context: {
                type: "array",
                items: {
                  type: "object",
                  required: ["tagName", "relation", "depth"],
                  properties: {
                    tagName: { type: "string" },
                    role: { type: "string" },
                    text: { type: "string" },
                    ariaLabel: { type: "string" },
                    id: { type: "string" },
                    className: { type: "string" },
                    dataTestId: { type: "string" },
                    label: { type: "string" },
                    relation: { enum: ["self", "ancestor"] },
                    depth: { type: "number" }
                  },
                  additionalProperties: true
                }
              },
            },
            additionalProperties: true
          },
          submitter: { $ref: "#/properties/steps/items/properties/target" },
          assertion: {
            type: "object",
            required: ["kind", "expected"],
            properties: {
              kind: { enum: ["url", "title"] },
              expected: { type: "string" }
            },
            additionalProperties: true
          }
        },
        allOf: [
          {
            if: { properties: { type: { const: "fill" } } },
            then: { required: ["value"], properties: { value: { type: "string" } } }
          },
          {
            if: { properties: { type: { const: "selection" } } },
            then: { required: ["value"], properties: { value: { type: "string" } } }
          },
          {
            if: { properties: { type: { const: "select" } } },
            then: {
              required: ["value"],
              properties: { value: { oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] } }
            }
          },
          {
            if: { properties: { type: { enum: ["click", "submit", "navigation", "goto", "wait", "assert"] } } },
            then: { not: { required: ["value"] } }
          },
          {
            if: { properties: { type: { const: "assert" } } },
            then: { required: ["assertion"] }
          },
          {
            if: { properties: { type: { enum: ["click", "fill", "select", "selection", "submit", "navigation", "goto", "wait"] } } },
            then: { not: { required: ["assertion"] } }
          }
        ],
        additionalProperties: true
      }
    },
    assertions: { type: "array" },
    metadata: {
      type: "object",
      required: ["userAgent", "extensionVersion", "recordedBy"],
      properties: {
        userAgent: { type: "string" },
        extensionVersion: { type: "string" },
        recordedBy: { const: "scenario-recorder" }
      }
    }
  },
  additionalProperties: false
} as const;
/* oxlint-enable unicorn/no-thenable */
