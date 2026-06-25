const HOST_ID = "scenario-recorder-feedback-layer";
const FEEDBACK_DURATION_MS = 820;

let host: HTMLElement | undefined;
let shadowRoot: ShadowRoot | undefined;

type RectLike = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function showClickFeedback(element: HTMLElement): void {
  const rect = element.getBoundingClientRect();
  if (!isVisibleRect(rect)) {
    return;
  }
  appendFeedbackBox(rect, "click");
}

export function showSelectionFeedback(rects: RectLike[]): void {
  for (const rect of rects.filter(isVisibleRect)) {
    appendFeedbackBox(rect, "selection");
  }
}

function appendFeedbackBox(rect: RectLike, kind: "click" | "selection"): void {
  const root = ensureFeedbackRoot();
  const box = document.createElement("span");
  box.className = `feedback ${kind}`;
  box.style.setProperty("--x", `${Math.max(0, rect.x - 3)}px`);
  box.style.setProperty("--y", `${Math.max(0, rect.y - 3)}px`);
  box.style.setProperty("--w", `${rect.width + 6}px`);
  box.style.setProperty("--h", `${rect.height + 6}px`);
  root.append(box);
  window.setTimeout(() => {
    box.remove();
    if (root.childElementCount === 1) {
      removeFeedbackRoot();
    }
  }, FEEDBACK_DURATION_MS);
}

function ensureFeedbackRoot(): ShadowRoot {
  if (host?.isConnected && shadowRoot) {
    return shadowRoot;
  }
  const existing = document.getElementById(HOST_ID);
  if (existing) {
    existing.remove();
  }
  host = document.createElement("div");
  host.id = HOST_ID;
  shadowRoot = host.attachShadow({ mode: "closed" });
  shadowRoot.innerHTML = `
    <style>
      :host {
        all: initial;
        pointer-events: none;
      }
      .feedback {
        position: fixed;
        left: var(--x);
        top: var(--y);
        width: var(--w);
        height: var(--h);
        z-index: 2147483646;
        box-sizing: border-box;
        border-radius: 6px;
        pointer-events: none;
        animation: scenario-recorder-feedback ${FEEDBACK_DURATION_MS}ms ease-out forwards;
      }
      .click {
        border: 3px solid #f59e0b;
        box-shadow: 0 0 0 3px rgba(250, 204, 21, 0.2);
      }
      .selection {
        border: 2px solid rgba(245, 158, 11, 0.82);
        background: rgba(250, 204, 21, 0.28);
      }
      @keyframes scenario-recorder-feedback {
        0% {
          opacity: 0;
          transform: scale(0.98);
        }
        16% {
          opacity: 1;
          transform: scale(1);
        }
        100% {
          opacity: 0;
          transform: scale(1.02);
        }
      }
    </style>
  `;
  (document.documentElement || document.body).append(host);
  return shadowRoot;
}

function removeFeedbackRoot(): void {
  host?.remove();
  host = undefined;
  shadowRoot = undefined;
}

function isVisibleRect(rect: RectLike): boolean {
  return rect.width > 0 && rect.height > 0;
}

export function getFeedbackRootForTest(): ShadowRoot | undefined {
  return shadowRoot;
}
