// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ScenarioStep } from "../shared/types";

describe("installRecorder", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
    document.body.innerHTML = "";
  });

  it("records target context when the active recording uses context detail", async () => {
    const { listeners, steps } = await installRecorderForContextTest("context");
    document.body.innerHTML = `
      <section aria-label="Billing actions">
        <button type="button">Save</button>
      </section>
    `;
    const button = document.querySelector("button");

    dispatchTrustedListener(listeners, "click", button);
    await Promise.resolve();

    expect(steps).toHaveLength(1);
    expect(steps[0].target?.context).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relation: "self",
          tagName: "button",
          text: "Save",
        }),
        expect.objectContaining({
          relation: "ancestor",
          tagName: "section",
          ariaLabel: "Billing actions",
        }),
      ]),
    );
  });

  it("records target context for fill, select, and submit steps", async () => {
    const { listeners, steps } = await installRecorderForContextTest("context");
    vi.spyOn(HTMLFormElement.prototype, "requestSubmit").mockImplementation(() => undefined);
    document.body.innerHTML = `
      <section aria-label="Profile form">
        <form>
          <label for="display-name">Display name</label>
          <input id="display-name" value="Sana">
          <select aria-label="Role">
            <option value="admin" selected>Admin</option>
          </select>
          <button type="submit">Save profile</button>
        </form>
      </section>
    `;
    const input = document.querySelector("input");
    const select = document.querySelector("select");
    const form = document.querySelector("form");

    dispatchTrustedListener(listeners, "input", input);
    dispatchTrustedListener(listeners, "change", select);
    await Promise.resolve();
    dispatchTrustedListener(listeners, "submit", form, {
      cancelable: false,
      target: form,
    });
    await Promise.resolve();

    expect(steps.map((step) => step.type)).toEqual(["fill", "select", "submit"]);
    expect(steps.every((step) => step.target?.context && step.target.context.length > 0)).toBe(true);
    expect(steps.find((step) => step.type === "fill")?.target?.context).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ relation: "self", tagName: "input", id: "display-name" }),
        expect.objectContaining({ relation: "ancestor", tagName: "form" }),
      ]),
    );
    expect(steps.find((step) => step.type === "select")?.target?.context).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ relation: "self", tagName: "select", ariaLabel: "Role" }),
        expect.objectContaining({ relation: "ancestor", tagName: "form" }),
      ]),
    );
    expect(steps.find((step) => step.type === "submit")?.target?.context).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ relation: "self", tagName: "form" }),
        expect.objectContaining({ relation: "ancestor", tagName: "section", ariaLabel: "Profile form" }),
      ]),
    );
  });

  it("omits target context when the active recording uses minimal detail", async () => {
    const { listeners, steps } = await installRecorderForContextTest("minimal");
    document.body.innerHTML = `
      <section aria-label="Billing actions">
        <button type="button">Save</button>
      </section>
    `;
    const button = document.querySelector("button");

    dispatchTrustedListener(listeners, "click", button);
    await Promise.resolve();

    expect(steps).toHaveLength(1);
    expect(steps[0].target?.context).toBeUndefined();
  });

  it("records text selection steps", async () => {
    vi.useFakeTimers();
    const { listeners, steps } = await installRecorderForContextTest("context");
    document.body.innerHTML = "<p id=\"terms\">Please review the cancellation policy before booking.</p>";
    const paragraph = document.querySelector("p");
    const textNode = paragraph?.firstChild ?? document.body;
    vi.spyOn(window, "getSelection").mockReturnValue({
      isCollapsed: false,
      rangeCount: 1,
      toString: () => "cancellation policy",
      getRangeAt: () => ({
        commonAncestorContainer: textNode,
        getClientRects: () => [{ x: 10, y: 20, width: 120, height: 18 }],
      }),
    } as unknown as Selection);

    dispatchTrustedListener(listeners, "selectionchange", document.body);
    await vi.advanceTimersByTimeAsync(130);

    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      type: "selection",
      value: "cancellation policy",
      target: expect.objectContaining({ tagName: "p", id: "terms" }),
    });
    await vi.advanceTimersByTimeAsync(900);
  });

  it("ignores events from the recorder overlay", async () => {
    const { listeners, steps } = await installRecorderForContextTest("context");
    document.body.innerHTML = `
      <div id="scenario-recorder-status-overlay">
        <button type="button">Overlay action</button>
      </div>
    `;
    const host = document.getElementById("scenario-recorder-status-overlay") as HTMLElement;
    const button = document.querySelector("button") as HTMLButtonElement;

    dispatchTrustedListener(listeners, "click", button, {
      composedPath: () => [button, host, document.body, document],
    });
    await Promise.resolve();

    expect(steps).toHaveLength(0);
  });
});

async function installRecorderForContextTest(
  recordingDetailLevel: "minimal" | "context",
): Promise<{
  listeners: Map<string, EventListener[]>;
  steps: ScenarioStep[];
}> {
  const listeners = new Map<string, EventListener[]>();
  vi.spyOn(document, "addEventListener").mockImplementation((type, listener) => {
    const eventType = String(type);
    listeners.set(eventType, [
      ...(listeners.get(eventType) ?? []),
      listener as EventListener,
    ]);
  });
  vi.stubGlobal("chrome", {
    runtime: {
      sendMessage: vi.fn(async () => ({
        recording: true,
        recordingDetailLevel,
      })),
    },
    storage: {
      onChanged: {
        addListener: vi.fn(),
      },
    },
  });
  vi.stubGlobal("CSS", {
    escape: (value: string) => value.replaceAll("\"", "\\\""),
  });
  const steps: ScenarioStep[] = [];
  const { installRecorder } = await import("./recorder");

  installRecorder((step) => {
    steps.push(step);
  });
  await Promise.resolve();
  return { listeners, steps };
}

function dispatchTrustedListener(
  listeners: Map<string, EventListener[]>,
  type: string,
  target: Element | null,
  overrides: Partial<Event> = {},
): void {
  for (const listener of listeners.get(type) ?? []) {
    listener({
      isTrusted: true,
      composedPath: () => target ? [target] : [],
      ...overrides,
    } as unknown as Event);
  }
}
