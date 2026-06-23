import { describe, expect, it } from "vitest";
import type { ScenarioStep } from "./types";
import { sanitizeUrl, shouldReplaceFillStep } from "./utils";

function fillStep(selector: string, value: string, timestamp: number): ScenarioStep {
  return {
    id: `step-${timestamp}`,
    type: "fill",
    timestamp,
    url: "https://example.test/form",
    target: {
      tagName: "input",
      selectorCandidates: [{ type: "css", value: selector, confidence: 0.5 }],
    },
    value,
  };
}

describe("sanitizeUrl", () => {
  it("redacts credentials and sensitive query/hash values", () => {
    const sanitized = sanitizeUrl(
      "https://user:pass@example.test/callback?access_token=abc&next=/ok#/done?id_token=xyz",
    );

    expect(sanitized).toBe(
      "https://example.test/callback?access_token=%7B%7BSECRET%7D%7D&next=%2Fok#/done?id_token=%7B%7BSECRET%7D%7D",
    );
  });

  it("redacts sensitive path tails", () => {
    expect(sanitizeUrl("https://example.test/reset/token-123/confirm")).toBe(
      "https://example.test/reset/%7B%7BSECRET%7D%7D/%7B%7BSECRET%7D%7D",
    );
  });
});

describe("shouldReplaceFillStep", () => {
  it("matches fill steps for the same primary selector", () => {
    expect(shouldReplaceFillStep(fillStep("#email", "a", 1), fillStep("#email", "ab", 2))).toBe(
      true,
    );
  });

  it("does not match different fields", () => {
    expect(shouldReplaceFillStep(fillStep("#email", "a", 1), fillStep("#name", "b", 2))).toBe(
      false,
    );
  });
});
