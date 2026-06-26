import type { ScenarioStep } from "./types";

export function truncateStepText(value: string, maxLength = 34): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}...` : normalized;
}

export function pageLabel(url: string | undefined, title?: string): string {
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

export function describeStep(step: ScenarioStep): string {
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
      return typeof step.value === "string" ? `「${truncateStepText(step.value)}」を確認` : "選択文字を確認";
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
