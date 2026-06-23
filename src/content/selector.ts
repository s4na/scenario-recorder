import type { SelectorCandidate, TargetSnapshot } from "../shared/types";
import { shouldMaskValue } from "./masking";

const MAX_TEXT_LENGTH = 120;

function cleanText(value: string | null | undefined): string | undefined {
  const text = value?.replace(/\s+/g, " ").trim();
  if (!text) {
    return undefined;
  }
  return text.slice(0, MAX_TEXT_LENGTH);
}

function addCandidate(
  candidates: SelectorCandidate[],
  candidate: SelectorCandidate | undefined
): void {
  if (!candidate) {
    return;
  }
  const key = `${candidate.type}:${JSON.stringify(candidate.value)}`;
  if (!candidates.some((item) => `${item.type}:${JSON.stringify(item.value)}` === key)) {
    candidates.push(candidate);
  }
}

function getElementRole(element: HTMLElement): string | undefined {
  const explicitRole = element.getAttribute("role");
  if (explicitRole) {
    return explicitRole;
  }
  const tagName = element.tagName.toLowerCase();
  if (tagName === "button") return "button";
  if (tagName === "a" && element.hasAttribute("href")) return "link";
  if (tagName === "select") return "combobox";
  if (tagName === "textarea") return "textbox";
  if (tagName === "input") {
    const type = (element as HTMLInputElement).type;
    if (type === "checkbox") return "checkbox";
    if (type === "radio") return "radio";
    if (type === "button" || type === "submit") return "button";
    return "textbox";
  }
  return undefined;
}

export function getElementLabel(element: HTMLElement): string | undefined {
  if (element.id) {
    const label = document.querySelector<HTMLLabelElement>(
      `label[for="${CSS.escape(element.id)}"]`
    );
    const labelText = cleanText(label?.innerText);
    if (labelText) {
      return labelText;
    }
  }

  const wrappingLabel = element.closest("label");
  const wrappingText = cleanText(wrappingLabel?.innerText);
  if (wrappingText) {
    return wrappingText;
  }

  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => cleanText(document.getElementById(id)?.innerText))
      .filter(Boolean)
      .join(" ");
    return cleanText(text);
  }

  return undefined;
}

function getAccessibleName(element: HTMLElement): string | undefined {
  const inputValue =
    element instanceof HTMLInputElement && !shouldMaskValue(element) ? cleanText(element.value) : undefined;
  return (
    cleanText(element.getAttribute("aria-label")) ??
    getElementLabel(element) ??
    inputValue ??
    cleanText(element.innerText) ??
    cleanText(element.textContent)
  );
}

function createCssSelector(element: HTMLElement): string {
  const parts: string[] = [];
  let current: HTMLElement | null = element;

  while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
    const tagName = current.tagName.toLowerCase();
    if (current.id) {
      parts.unshift(`${tagName}#${CSS.escape(current.id)}`);
      break;
    }

    const classNames = Array.from(current.classList)
      .slice(0, 2)
      .map((className) => `.${CSS.escape(className)}`)
      .join("");
    let selector = `${tagName}${classNames}`;
    const parent = current.parentElement;
    if (parent) {
      const sameTagSiblings = Array.from(parent.children).filter(
        (sibling) => sibling.tagName === current?.tagName
      );
      if (sameTagSiblings.length > 1) {
        selector += `:nth-of-type(${sameTagSiblings.indexOf(current) + 1})`;
      }
    }
    parts.unshift(selector);
    current = current.parentElement;
  }

  return parts.join(" > ");
}

function createXPath(element: HTMLElement): string {
  const parts: string[] = [];
  let current: HTMLElement | null = element;

  while (current && current.nodeType === Node.ELEMENT_NODE) {
    const tagName = current.tagName.toLowerCase();
    const siblings = current.parentElement
      ? Array.from(current.parentElement.children).filter((item) => item.tagName === current?.tagName)
      : [];
    const index = siblings.length > 1 ? `[${siblings.indexOf(current) + 1}]` : "";
    parts.unshift(`${tagName}${index}`);
    current = current.parentElement;
  }

  return `/${parts.join("/")}`;
}

export function getSelectorCandidates(element: HTMLElement): SelectorCandidate[] {
  const candidates: SelectorCandidate[] = [];
  const ariaLabel = cleanText(element.getAttribute("aria-label"));
  const role = getElementRole(element);
  const accessibleName = getAccessibleName(element);
  const label = getElementLabel(element);
  const placeholder = cleanText(element.getAttribute("placeholder"));
  const text = cleanText(element.innerText ?? element.textContent);

  addCandidate(candidates, attributeCandidate(element, "data-testid", 0.95));
  addCandidate(candidates, attributeCandidate(element, "data-test", 0.94));
  addCandidate(candidates, attributeCandidate(element, "data-cy", 0.94));
  addCandidate(
    candidates,
    ariaLabel ? { type: "aria-label", value: ariaLabel, confidence: 0.9 } : undefined
  );
  addCandidate(
    candidates,
    role && accessibleName
      ? { type: "role", value: { role, name: accessibleName }, confidence: 0.88 }
      : undefined
  );
  addCandidate(candidates, label ? { type: "label", value: label, confidence: 0.85 } : undefined);
  addCandidate(
    candidates,
    element.getAttribute("name")
      ? { type: "name", value: element.getAttribute("name") ?? "", confidence: 0.8 }
      : undefined
  );
  addCandidate(candidates, element.id ? { type: "id", value: element.id, confidence: 0.75 } : undefined);
  addCandidate(
    candidates,
    placeholder ? { type: "placeholder", value: placeholder, confidence: 0.7 } : undefined
  );
  addCandidate(candidates, text ? { type: "text", value: text, confidence: 0.6 } : undefined);
  addCandidate(candidates, { type: "css", value: createCssSelector(element), confidence: 0.5 });
  addCandidate(candidates, { type: "xpath", value: createXPath(element), confidence: 0.3 });

  return candidates;
}

function attributeCandidate(
  element: HTMLElement,
  attribute: "data-testid" | "data-test" | "data-cy",
  confidence: number
): SelectorCandidate | undefined {
  const value = element.getAttribute(attribute);
  return value ? { type: attribute, value, confidence } : undefined;
}

export function createTargetSnapshot(element: HTMLElement): TargetSnapshot {
  const rect = element.getBoundingClientRect();
  return {
    selectorCandidates: getSelectorCandidates(element),
    tagName: element.tagName.toLowerCase(),
    text: cleanText(element.innerText ?? element.textContent),
    ariaLabel: cleanText(element.getAttribute("aria-label")),
    role: getElementRole(element),
    name: element.getAttribute("name") ?? undefined,
    id: element.id || undefined,
    className: element.className || undefined,
    dataTestId: element.getAttribute("data-testid") ?? undefined,
    label: getElementLabel(element),
    placeholder: cleanText(element.getAttribute("placeholder")),
    inputType: element instanceof HTMLInputElement ? element.type : undefined,
    rect: {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    }
  };
}
