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
  if (host) {
    host.dataset.status = state.status;
  }
  const statusClass = "recording";
  const title = "録画中";
  const recentSteps = state.recentSteps.slice().reverse();
  const lastStep = recentSteps[0];
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
        width: min(360px, calc(100vw - 32px));
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
        margin-bottom: 10px;
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
        gap: 10px;
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
      .latest {
        display: grid;
        gap: 2px;
        padding: 9px 10px;
        border: 1px solid rgba(148, 163, 184, 0.32);
        border-radius: 7px;
        background: rgba(255, 255, 255, 0.08);
      }
      .latest strong {
        overflow: hidden;
        font-size: 13px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .latest small,
      .empty {
        color: #aeb7c6;
        font-size: 11px;
      }
      .flow {
        display: grid;
        gap: 0;
        max-height: 190px;
        margin: 0;
        padding: 0;
        overflow-y: auto;
        scrollbar-gutter: stable;
        list-style: none;
      }
      .flow li {
        display: grid;
        grid-template-columns: 22px 1fr;
        gap: 8px;
        min-width: 0;
        padding: 6px 0;
        border-top: 1px solid rgba(148, 163, 184, 0.22);
      }
      .flow li:first-child {
        border-top: 0;
      }
      .node {
        display: inline-grid;
        place-items: center;
        width: 20px;
        height: 20px;
        border-radius: 999px;
        color: #0f172a;
        background: #facc15;
        font-size: 10px;
        font-weight: 800;
      }
      .stepText {
        display: grid;
        gap: 1px;
        min-width: 0;
      }
      .stepText strong,
      .stepText small {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .stepText strong {
        font-size: 12px;
      }
      .stepText small {
        color: #aeb7c6;
        font-size: 10px;
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
        <div class="latest">
          <small>${state.stepCount} steps</small>
          <strong>${escapeHtml(lastStep ? describeStep(lastStep) : "まだ操作は記録されていません")}</strong>
          <small>${escapeHtml(lastStep ? pageLabel(lastStep.url, lastStep.title) : formatUrl(state.currentUrl))}</small>
        </div>
        ${recentSteps.length > 0 ? `
          <ol class="flow">
            ${recentSteps.map((step, index) => `
              <li>
                <span class="node">${state.stepCount - index}</span>
                <span class="stepText">
                  <small>${escapeHtml(pageLabel(step.url, step.title))}</small>
                  <strong>${escapeHtml(describeStep(step))}</strong>
                </span>
              </li>
            `).join("")}
          </ol>
        ` : `<p class="empty">操作するとここにステップが追加されます。</p>`}
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
  shadowRoot = host.attachShadow({ mode: "closed" });
  (document.documentElement || document.body).append(host);
  return shadowRoot;
}

export function getRecordingOverlayRootForTest(): ShadowRoot | undefined {
  return shadowRoot;
}

function statusLabel(_status: RecordingOverlayState["status"]): string {
  return "recording";
}

function truncateStepText(value: string, maxLength = 34): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}...` : normalized;
}

function pageLabel(url: string | undefined, title?: string): string {
  const cleanTitle = title?.trim();
  if (cleanTitle) {
    return `${truncateStepText(cleanTitle, 26)}ページ`;
  }
  if (!url) {
    return "現在のページ";
  }
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/^\/|\/$/g, "");
    return `${truncateStepText(path || parsed.host, 26)}ページ`;
  } catch {
    return "現在のページ";
  }
}

function describeStep(step: RecordingOverlayState["recentSteps"][number]): string {
  const targetName = step.target?.label ?? step.target?.ariaLabel ?? step.target?.text ?? step.target?.placeholder;
  const target = targetName ? `「${targetName}」` : step.target?.tagName?.toLowerCase();
  switch (step.type) {
    case "click":
      return target ? `${target}をクリック` : "クリック";
    case "fill":
      return target ? `${target}に入力` : "入力";
    case "select":
      return target ? `${target}を選択` : "選択";
    case "selection":
      return typeof step.value === "string" ? `「${truncateStepText(step.value)}」を文字選択` : "文字選択";
    case "submit":
      return target ? `${target}を送信` : "送信";
    case "navigation":
      return `${pageLabel(step.toUrl ?? step.url, step.title)}へ移動`;
    case "goto":
      return `${pageLabel(step.toUrl ?? step.url, step.title)}へ移動`;
    case "wait":
      return "ページの読み込みを待機";
    case "assert":
      return step.assertion?.kind === "title" ? "タイトルを確認" : "URLを確認";
    default:
      return "操作を記録";
  }
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
