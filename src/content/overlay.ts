import type { RecordingOverlayState } from "../shared/types";

const HOST_ID = "scenario-recorder-status-overlay";

let host: HTMLElement | undefined;
let shadowRoot: ShadowRoot | undefined;

export function renderRecordingOverlay(
  state: RecordingOverlayState | { visible: false },
): void {
  if (!state.visible) {
    removeRecordingOverlay();
    return;
  }
  const root = ensureOverlayRoot();
  const statusClass = state.status === "recording" ? "recording" : "paused";
  const title = state.status === "recording" ? "シナリオ録画中" : "シナリオ一時停止中";
  root.innerHTML = `
    <style>
      :host {
        all: initial;
        color-scheme: light dark;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .panel {
        position: fixed;
        right: 16px;
        bottom: 16px;
        z-index: 2147483647;
        box-sizing: border-box;
        width: min(320px, calc(100vw - 32px));
        padding: 12px 14px;
        border: 1px solid rgba(255, 255, 255, 0.18);
        border-radius: 8px;
        background: rgba(22, 24, 29, 0.92);
        box-shadow: 0 10px 28px rgba(0, 0, 0, 0.24);
        color: #f8fafc;
        font-size: 12px;
        line-height: 1.35;
        pointer-events: none;
      }
      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 8px;
      }
      .title {
        font-size: 12px;
        font-weight: 700;
      }
      .status {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
      }
      .dot {
        width: 7px;
        height: 7px;
        border-radius: 999px;
        background: #fbbf24;
      }
      .status.recording .dot {
        background: #22c55e;
      }
      .grid {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 5px 10px;
      }
      .label {
        color: #aeb7c6;
      }
      .value {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    </style>
    <div class="panel" role="status" aria-live="polite">
      <div class="header">
        <div class="title">${title}</div>
        <div class="status ${statusClass}">
          <span class="dot"></span>
          <span>${escapeHtml(statusLabel(state.status))}</span>
        </div>
      </div>
      <div class="grid">
        <span class="label">steps</span>
        <span class="value">${state.stepCount}</span>
        <span class="label">last</span>
        <span class="value">${escapeHtml(state.lastStepType ?? "none")}</span>
        <span class="label">url</span>
        <span class="value">${escapeHtml(formatUrl(state.currentUrl))}</span>
      </div>
    </div>
  `;
}

export function removeRecordingOverlay(): void {
  host?.remove();
  host = undefined;
  shadowRoot = undefined;
}

function ensureOverlayRoot(): ShadowRoot {
  if (host?.isConnected && shadowRoot) {
    return shadowRoot;
  }
  const existing = document.getElementById(HOST_ID);
  if (existing) {
    existing.remove();
  }
  host = document.createElement("div");
  host.id = HOST_ID;
  shadowRoot = host.attachShadow({ mode: "open" });
  (document.documentElement || document.body).append(host);
  return shadowRoot;
}

function statusLabel(status: RecordingOverlayState["status"]): string {
  return status === "recording" ? "recording" : "paused";
}

function formatUrl(url: string | undefined): string {
  if (!url) {
    return "unknown";
  }
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
}
