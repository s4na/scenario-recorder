// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { getFeedbackRootForTest, showClickFeedback, showSelectionFeedback } from "./feedback";

describe("recording feedback", () => {
  afterEach(() => {
    vi.useRealTimers();
    document.getElementById("scenario-recorder-feedback-layer")?.remove();
  });

  it("marks recorded clicks with a temporary amber outline", async () => {
    vi.useFakeTimers();
    const button = document.createElement("button");
    vi.spyOn(button, "getBoundingClientRect").mockReturnValue({
      x: 12,
      y: 24,
      width: 90,
      height: 32,
      top: 24,
      right: 102,
      bottom: 56,
      left: 12,
      toJSON: () => undefined,
    } as DOMRect);

    showClickFeedback(button);

    const root = getFeedbackRootForTest();
    expect(root?.querySelector(".feedback.click")).not.toBeNull();
    expect(root?.innerHTML).toContain("#f59e0b");

    await vi.advanceTimersByTimeAsync(900);
    expect(document.getElementById("scenario-recorder-feedback-layer")).toBeNull();
  });

  it("marks recorded text selections with a temporary highlight", async () => {
    vi.useFakeTimers();

    showSelectionFeedback([{ x: 10, y: 20, width: 120, height: 18 }]);

    const root = getFeedbackRootForTest();
    expect(root?.querySelector(".feedback.selection")).not.toBeNull();
    expect(root?.innerHTML).toContain("rgba(250, 204, 21, 0.28)");

    await vi.advanceTimersByTimeAsync(900);
    expect(document.getElementById("scenario-recorder-feedback-layer")).toBeNull();
  });
});
