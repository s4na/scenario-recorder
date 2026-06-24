// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { maskValue, shouldMaskValue } from "./masking";

function input(attributes: Record<string, string>): HTMLInputElement {
  const element = document.createElement("input");
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, value);
  }
  document.body.append(element);
  return element;
}

describe("maskValue", () => {
  it("masks password and token-like fields", () => {
    expect(maskValue(input({ type: "password", name: "login" }), "secret")).toBe(
      "{{PASSWORD}}",
    );
    expect(maskValue(input({ name: "apiKey" }), "abc123")).toBe("{{SECRET}}");
  });

  it("masks common card-number and card-security-code fields", () => {
    expect(maskValue(input({ name: "creditCardNumber" }), "4111111111111111")).toBe(
      "{{CREDIT_CARD}}",
    );
    expect(maskValue(input({ name: "cscCode" }), "123")).toBe("{{CREDIT_CARD}}");
    expect(maskValue(input({ name: "security_code" }), "123")).toBe("{{CREDIT_CARD}}");
  });

  it("does not mask ordinary words that contain short secret markers", () => {
    expect(shouldMaskValue(input({ name: "keyboard" }))).toBe(false);
    expect(shouldMaskValue(input({ name: "passenger" }))).toBe(false);
    expect(shouldMaskValue(input({ name: "monkey" }))).toBe(false);
  });

  it("uses labels and autocomplete metadata", () => {
    const labeled = input({ id: "oneTimeCode" });
    const label = document.createElement("label");
    label.htmlFor = "oneTimeCode";
    label.textContent = "One time code";
    document.body.append(label);

    expect(maskValue(labeled, "123456")).toBe("{{SECRET}}");
    expect(maskValue(input({ autocomplete: "cc-csc" }), "123")).toBe("{{CREDIT_CARD}}");
  });
});
