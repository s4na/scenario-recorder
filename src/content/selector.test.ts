// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { createTargetSnapshot } from "./selector";

describe("createTargetSnapshot", () => {
  afterEach(() => {
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
          text: expect.stringContaining("yamada@example.com"),
        }),
        expect.objectContaining({
          relation: "ancestor",
          tagName: "section",
          dataTestId: "users-panel",
          ariaLabel: "Users",
        }),
      ]),
    );
  });
});
