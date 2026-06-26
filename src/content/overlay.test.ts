// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  getRecordingOverlayRootForTest,
  removeRecordingOverlay,
  renderRecordingOverlay,
} from "./overlay";

describe("recording overlay", () => {
  afterEach(() => {
    removeRecordingOverlay();
  });

  it("renders the current recording summary in a fixed overlay", () => {
    renderRecordingOverlay({
      visible: true,
      status: "recording",
      stepCount: 3,
      lastStepType: "fill",
      currentUrl: "https://app.example/customers?token={{SECRET}}",
      recentSteps: [{
        id: "step_fill",
        type: "fill",
        timestamp: 100,
        url: "https://app.example/customers?token={{SECRET}}",
        title: "Customers",
        value: "Sana",
        target: {
          tagName: "input",
          label: "Name",
          selectorCandidates: [{ type: "label", value: "Name", confidence: 90 }]
        }
      }],
    });

    const host = document.getElementById("scenario-recorder-status-overlay");
    expect(host).not.toBeNull();
    expect(host?.dataset.status).toBe("recording");
    expect(host?.shadowRoot).toBeNull();
    const root = getRecordingOverlayRootForTest();
    const text = root?.textContent ?? "";
    const markup = root?.innerHTML ?? "";
    expect(text).toContain("録画中");
    expect(text).toContain("recording");
    expect(text).toContain("3");
    expect(text).toContain("「Name」に入力");
    expect(text).toContain("Customersページ");
    expect(text).not.toContain("token");
    expect(text).not.toContain("{{SECRET}}");
    expect(markup).toContain("position: fixed");
    expect(markup).toContain("right:");
    expect(markup).toContain("bottom:");
  });

  it("removes the overlay when it should no longer be visible", () => {
    renderRecordingOverlay({
      visible: true,
      status: "paused",
      stepCount: 1,
      currentUrl: "https://app.example",
      recentSteps: [],
    });

    renderRecordingOverlay({ visible: false });

    expect(document.getElementById("scenario-recorder-status-overlay")).toBeNull();
  });

  it("keeps the recording language while the internal state is paused", () => {
    renderRecordingOverlay({
      visible: true,
      status: "paused",
      stepCount: 4,
      lastStepType: "click",
      currentUrl: "https://app.example",
      recentSteps: [],
    });

    const host = document.getElementById("scenario-recorder-status-overlay");
    expect(host?.dataset.status).toBe("paused");
    expect(host?.shadowRoot).toBeNull();
    const text = getRecordingOverlayRootForTest()?.textContent ?? "";
    expect(text).toContain("録画中");
    expect(text).toContain("recording");
    expect(text).not.toContain("一時停止");
    expect(text).not.toContain("paused");
  });
});
