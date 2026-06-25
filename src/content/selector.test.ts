// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTargetSnapshot } from "./selector";

describe("createTargetSnapshot", () => {
  beforeEach(() => {
    vi.stubGlobal("CSS", {
      escape: (value: string) => value.replaceAll("\"", "\\\""),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("omits ancestor context by default", () => {
    document.body.innerHTML = `
      <section aria-label="Users">
        <button>Edit</button>
      </section>
    `;

    const button = document.querySelector("button");
    expect(button).not.toBeNull();

    expect(createTargetSnapshot(button as HTMLButtonElement).context).toBeUndefined();
  });

  it("records local semantic context for similar controls", () => {
    document.body.innerHTML = `
      <section aria-label="Users" data-testid="users-panel">
        <table>
          <tr data-testid="user-row">
            <td>山田 太郎</td>
            <td>yamada@example.com</td>
            <td><button>Edit</button></td>
          </tr>
          <tr>
            <td>佐藤 花子</td>
            <td>hanako@example.com</td>
            <td><button>Edit</button></td>
          </tr>
        </table>
      </section>
    `;

    const button = document.querySelector("button");
    expect(button).not.toBeNull();

    const snapshot = createTargetSnapshot(button as HTMLButtonElement, { includeContext: true });

    expect(snapshot.context).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relation: "self",
          tagName: "button",
          text: "Edit",
        }),
        expect.objectContaining({
          relation: "ancestor",
          tagName: "tr",
          dataTestId: "user-row",
          text: expect.stringContaining("山田 太郎"),
        }),
        expect.objectContaining({
          relation: "ancestor",
          tagName: "tr",
          text: expect.stringContaining("{{EMAIL}}"),
        }),
        expect.objectContaining({
          relation: "ancestor",
          tagName: "section",
          dataTestId: "users-panel",
          ariaLabel: "Users",
        }),
      ]),
    );
    expect(snapshot.context?.map((item) => item.text).join(" ")).not.toContain("yamada@example.com");
    expect(snapshot.contextSummary).toEqual(
      expect.objectContaining({
        scope: "tableRow",
        heading: "Users",
        nearbyText: expect.arrayContaining(["山田 太郎", "{{EMAIL}}"]),
        sameLabel: {
          value: "Edit",
          index: 1,
          count: 2,
        },
      }),
    );
  });

  it("ignores controls hidden by ancestors when counting repeated labels", () => {
    document.body.innerHTML = `
      <div hidden>
        <button>Choose</button>
      </div>
      <section>
        <article>
          <h2>Free plan</h2>
          <button>Choose</button>
        </article>
        <article>
          <h2>Pro plan</h2>
          <button id="target">Choose</button>
        </article>
      </section>
    `;

    const target = document.querySelector("#target");
    expect(target).not.toBeNull();

    const snapshot = createTargetSnapshot(target as HTMLButtonElement, { includeContext: true });

    expect(snapshot.contextSummary?.sameLabel).toEqual({
      value: "Choose",
      index: 2,
      count: 2,
    });
  });

  it("ignores nearby controls hidden by ancestors", () => {
    document.body.innerHTML = `
      <section>
        <h2>Plans</h2>
        <div hidden>
          <button>Archive plan</button>
        </div>
        <article>
          <h3>Pro plan</h3>
          <button id="target">Choose</button>
        </article>
        <button>Preview plan</button>
      </section>
    `;

    const target = document.querySelector("#target");
    expect(target).not.toBeNull();

    const snapshot = createTargetSnapshot(target as HTMLButtonElement, { includeContext: true });

    expect(snapshot.contextSummary?.nearbyControls).toEqual(["Preview plan"]);
    expect(snapshot.contextSummary?.nearbyControls).not.toContain("Archive plan");
  });

  it("redacts sensitive values from all context string fields", () => {
    document.body.innerHTML = `
      <section
        id="customer-yamada@example.com"
        class="customer 090-1234-5678"
        aria-label="Customer yamada@example.com"
        data-testid="customer-123456789012345678901234"
      >
        <label for="customer-yamada@example.com">Code 123456</label>
        <input
          id="customer-yamada@example.com"
          aria-label="Token abcdefghijklmnopqrstuvwxyz123456"
          data-testid="input-yamada@example.com"
          class="field 080-9876-5432"
        >
      </section>
    `;

    const input = document.querySelector("input");
    expect(input).not.toBeNull();

    const snapshot = createTargetSnapshot(input as HTMLInputElement, { includeContext: true });
    const serializedContext = JSON.stringify(snapshot.context);

    expect(serializedContext).toContain("{{EMAIL}}");
    expect(serializedContext).toContain("{{PHONE_OR_ID}}");
    expect(serializedContext).toContain("{{SECRET}}");
    expect(serializedContext).not.toContain("yamada@example.com");
    expect(serializedContext).not.toContain("090-1234-5678");
    expect(serializedContext).not.toContain("080-9876-5432");
    expect(serializedContext).not.toContain("abcdefghijklmnopqrstuvwxyz123456");
    expect(serializedContext).not.toContain("123456789012345678901234");
  });
});
