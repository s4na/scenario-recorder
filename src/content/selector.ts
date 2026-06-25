import type { SelectorCandidate, TargetContext, TargetContextSummary, TargetSnapshot } from "../shared/types";
import { shouldMaskValue } from "./masking";

const MAX_TEXT_LENGTH = 120;
const MAX_CONTEXT_ITEMS = 6;
const MAX_CONTEXT_DEPTH = 5;
const MAX_NEARBY_ITEMS = 4;
const MAX_NEARBY_CONTROLS = 6;
const SECRET_TEXT_PATTERNS = [
  /sk_(live|test)_[A-Za-z0-9_=-]+/gi,
  /bearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
  /\b(?:access[_-]?token|api[_-]?key|client[_-]?secret|id[_-]?token|refresh[_-]?token|secret|token|password|otp|credential|authorization|session|signature|ticket|auth[_-]?code|verification[_-]?code|reset[_-]?code|one[_-]?time[_-]?code)[_-][A-Za-z0-9._~+/=-]+/gi,
  /\b(?:access[_-]?token|api[_-]?key|client[_-]?secret|id[_-]?token|refresh[_-]?token|secret|token|password|otp|credential|authorization|session|signature|ticket|code)[=:]\s*(?:bearer\s+)?[^"'&<>]+/gi
];
const CONTEXT_TEXT_PATTERNS = [
  { pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, replacement: "{{EMAIL}}" },
  { pattern: /\b(?:\+?\d[\d\s().-]{7,}\d)\b/g, replacement: "{{PHONE_OR_ID}}" },
  { pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, replacement: "{{ID}}" },
  { pattern: /\b[A-Za-z0-9_-]{24,}\b/g, replacement: "{{ID}}" },
  { pattern: /\b(?:otp|code|pin|verification)\s*[:#-]?\s*\d{4,8}\b/gi, replacement: "{{SECRET}}" }
];

function cleanText(value: string | null | undefined): string | undefined {
  const text = redactSecretText(value)?.replace(/\s+/g, " ").trim();
  if (!text) {
    return undefined;
  }
  return text.slice(0, MAX_TEXT_LENGTH);
}

function cleanContextText(value: string | null | undefined): string | undefined {
  const text = cleanText(value);
  if (!text) {
    return undefined;
  }
  return CONTEXT_TEXT_PATTERNS.reduce(
    (current, { pattern, replacement }) => current.replace(pattern, replacement),
    text
  );
}

function redactSecretText(value: string | null | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  return SECRET_TEXT_PATTERNS.reduce(
    (current, pattern) => current.replace(pattern, "{{SECRET}}"),
    value
  );
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
  const labelledBy = getAriaLabelledByText(element);
  if (labelledBy) {
    return labelledBy;
  }

  return getNativeLabelText(element);
}

function getAriaLabelledByText(element: HTMLElement): string | undefined {
  const labelledBy = element.getAttribute("aria-labelledby");
  if (!labelledBy) {
    return undefined;
  }
  const text = labelledBy
    .split(/\s+/)
    .map((id) => cleanText(document.getElementById(id)?.innerText))
    .filter(Boolean)
    .join(" ");
  return cleanText(text);
}

function getNativeLabelText(element: HTMLElement): string | undefined {
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

  return undefined;
}

function getAccessibleName(element: HTMLElement): string | undefined {
  const stableName =
    getAriaLabelledByText(element) ??
    cleanText(element.getAttribute("aria-label")) ??
    getNativeLabelText(element);
  if (shouldMaskValue(element)) {
    return stableName;
  }

  return (
    stableName ??
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
      parts.unshift(`${tagName}#${CSS.escape(redactSecretText(current.id) ?? current.id)}`);
      break;
    }

    const classNames = Array.from(current.classList)
      .slice(0, 2)
      .map((className) => `.${CSS.escape(redactSecretText(className) ?? className)}`)
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

  return redactSecretText(parts.join(" > ")) ?? parts.join(" > ");
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
  const text = shouldMaskValue(element) ? undefined : cleanText(element.innerText ?? element.textContent);

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
      ? { type: "name", value: cleanText(element.getAttribute("name")) ?? "", confidence: 0.8 }
      : undefined
  );
  addCandidate(candidates, element.id ? { type: "id", value: cleanText(element.id) ?? "", confidence: 0.75 } : undefined);
  addCandidate(
    candidates,
    placeholder ? { type: "placeholder", value: placeholder, confidence: 0.7 } : undefined
  );
  addCandidate(candidates, text ? { type: "text", value: text, confidence: 0.6 } : undefined);
  addCandidate(candidates, { type: "css", value: createCssSelector(element), confidence: 0.5 });
  addCandidate(candidates, { type: "xpath", value: createXPath(element), confidence: 0.3 });

  return candidates;
}

type TargetSnapshotOptions = {
  includeContext?: boolean;
};

function attributeCandidate(
  element: HTMLElement,
  attribute: "data-testid" | "data-test" | "data-cy",
  confidence: number
): SelectorCandidate | undefined {
  const value = element.getAttribute(attribute);
  return value ? { type: attribute, value: cleanText(value) ?? "", confidence } : undefined;
}

export function createTargetSnapshot(
  element: HTMLElement,
  options: TargetSnapshotOptions = {},
): TargetSnapshot {
  const rect = element.getBoundingClientRect();
  const text = shouldMaskValue(element) ? undefined : cleanText(element.innerText ?? element.textContent);
  return {
    selectorCandidates: getSelectorCandidates(element),
    tagName: element.tagName.toLowerCase(),
    text,
    ariaLabel: cleanText(element.getAttribute("aria-label")),
    role: getElementRole(element),
    name: cleanText(element.getAttribute("name")),
    id: cleanText(element.id) || undefined,
    className: cleanText(element.className) || undefined,
    dataTestId: cleanText(element.getAttribute("data-testid")),
    label: getElementLabel(element),
    placeholder: cleanText(element.getAttribute("placeholder")),
    inputType: element instanceof HTMLInputElement ? element.type : undefined,
    rect: {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    },
    context: options.includeContext ? getTargetContext(element) : undefined,
    contextSummary: options.includeContext ? getTargetContextSummary(element) : undefined
  };
}

function getTargetContext(element: HTMLElement): TargetContext[] {
  const context: TargetContext[] = [];
  addContext(context, element, "self", 0);
  let current = element.parentElement;
  let depth = 1;
  while (current && current !== document.body && context.length < MAX_CONTEXT_ITEMS && depth <= MAX_CONTEXT_DEPTH) {
    if (isMeaningfulContextElement(current)) {
      addContext(context, current, "ancestor", depth);
    }
    current = current.parentElement;
    depth += 1;
  }
  return context;
}

function addContext(
  context: TargetContext[],
  element: HTMLElement,
  relation: TargetContext["relation"],
  depth: number,
): void {
  const item: TargetContext = {
    tagName: element.tagName.toLowerCase(),
    role: getElementRole(element),
    text: shouldMaskValue(element) ? undefined : cleanContextText(element.innerText ?? element.textContent),
    ariaLabel: cleanContextText(element.getAttribute("aria-label")),
    id: cleanContextText(element.id) || undefined,
    className: cleanContextText(element.className) || undefined,
    dataTestId: cleanContextText(element.getAttribute("data-testid")),
    label: cleanContextText(getElementLabel(element)),
    relation,
    depth,
  };
  if (
    item.text ||
    item.ariaLabel ||
    item.id ||
    item.className ||
    item.dataTestId ||
    item.label ||
    item.role ||
    relation === "self"
  ) {
    context.push(item);
  }
}

function isMeaningfulContextElement(element: HTMLElement): boolean {
  const tagName = element.tagName.toLowerCase();
  const role = getElementRole(element);
  return (
    ["article", "aside", "fieldset", "form", "li", "main", "nav", "section", "td", "th", "tr"].includes(tagName) ||
    ["article", "cell", "form", "gridcell", "group", "listitem", "main", "navigation", "region", "row", "rowgroup"].includes(role ?? "") ||
    element.hasAttribute("aria-label") ||
    element.hasAttribute("data-testid") ||
    element.hasAttribute("data-test") ||
    element.hasAttribute("data-cy") ||
    /\b(card|item|panel|row|section|table|list|dialog|modal)\b/i.test(element.className)
  );
}

function getTargetContextSummary(element: HTMLElement): TargetContextSummary | undefined {
  const scope = findContextScope(element);
  const sameLabel = getSameLabelPosition(element);
  const summary: TargetContextSummary = {
    scope: scope?.scope,
    heading: findContextHeading(scope?.element ?? element),
    nearbyText: scope ? getNearbyText(scope.element, element) : undefined,
    nearbyControls: scope ? getNearbyControls(scope.element, element) : undefined,
    sameLabel,
  };
  if (
    summary.scope ||
    summary.heading ||
    summary.nearbyText?.length ||
    summary.nearbyControls?.length ||
    summary.sameLabel
  ) {
    return summary;
  }
  return undefined;
}

function findContextScope(element: HTMLElement): { element: HTMLElement; scope: TargetContextSummary["scope"] } | undefined {
  const candidates: Array<[string, TargetContextSummary["scope"]]> = [
    ["tr,[role='row']", "tableRow"],
    ["form,[role='form']", "form"],
    ["dialog,[role='dialog'],[aria-modal='true'],.dialog,.modal", "dialog"],
    ["article,.card,.panel,[data-testid*='card'],[data-test*='card'],[data-cy*='card']", "card"],
    ["li,[role='listitem']", "listItem"],
    ["section,[role='region'],main", "section"],
  ];
  for (const [selector, scope] of candidates) {
    const match = element.closest(selector);
    if (match instanceof HTMLElement && isVisibleElement(match)) {
      return { element: match, scope };
    }
  }
  const ancestor = element.parentElement;
  return ancestor && ancestor !== document.body ? { element: ancestor, scope: "ancestor" } : undefined;
}

function findContextHeading(scope: HTMLElement): string | undefined {
  const ownHeading = firstCleanText(
    Array.from(scope.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6,[role='heading']")).map((item) => item.innerText),
  );
  if (ownHeading) {
    return ownHeading;
  }
  const labelledBy = getAriaLabelledByText(scope);
  if (labelledBy) {
    return labelledBy;
  }
  const ariaLabel = cleanContextText(scope.getAttribute("aria-label"));
  if (ariaLabel) {
    return ariaLabel;
  }
  let current = scope.parentElement;
  let depth = 0;
  while (current && current !== document.body && depth < MAX_CONTEXT_DEPTH) {
    const heading = firstCleanText(
      Array.from(current.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6,[role='heading']")).map((item) => item.innerText),
    );
    if (heading) {
      return heading;
    }
    const labelledBy = getAriaLabelledByText(current);
    if (labelledBy) {
      return labelledBy;
    }
    const ariaLabel = cleanContextText(current.getAttribute("aria-label"));
    if (ariaLabel) {
      return ariaLabel;
    }
    current = current.parentElement;
    depth += 1;
  }
  return undefined;
}

function getNearbyText(scope: HTMLElement, target: HTMLElement): string[] | undefined {
  const values: string[] = [];
  const candidates = Array.from(scope.querySelectorAll<HTMLElement>("label,legend,caption,th,td,p,dt,dd,li,h1,h2,h3,h4,h5,h6"));
  for (const item of candidates) {
    if (values.length >= MAX_NEARBY_ITEMS) {
      break;
    }
    if (item === target || item.contains(target) || !isVisibleElement(item)) {
      continue;
    }
    addUniqueText(values, item.innerText ?? item.textContent);
  }
  return values.length ? values : undefined;
}

function getNearbyControls(scope: HTMLElement, target: HTMLElement): string[] | undefined {
  const values: string[] = [];
  const controls = Array.from(scope.querySelectorAll<HTMLElement>("button,a[href],input,select,textarea,[role='button'],[role='link']"));
  for (const control of controls) {
    if (values.length >= MAX_NEARBY_CONTROLS) {
      break;
    }
    if (control === target || !isVisibleElement(control)) {
      continue;
    }
    addUniqueText(values, getAccessibleName(control) ?? control.getAttribute("value"));
  }
  return values.length ? values : undefined;
}

function getSameLabelPosition(element: HTMLElement): TargetContextSummary["sameLabel"] | undefined {
  const value = getAccessibleName(element);
  if (!value) {
    return undefined;
  }
  const role = getElementRole(element);
  const tagName = element.tagName.toLowerCase();
  const same = Array.from(document.querySelectorAll<HTMLElement>(tagName))
    .filter((candidate) =>
      isVisibleElement(candidate) &&
      getElementRole(candidate) === role &&
      getAccessibleName(candidate) === value
    );
  if (same.length <= 1) {
    return undefined;
  }
  const index = same.indexOf(element);
  return index >= 0 ? { value, index: index + 1, count: same.length } : undefined;
}

function firstCleanText(values: Array<string | null | undefined>): string | undefined {
  for (const value of values) {
    const text = cleanContextText(value);
    if (text) {
      return text;
    }
  }
  return undefined;
}

function addUniqueText(values: string[], value: string | null | undefined): void {
  const text = cleanContextText(value);
  if (text && !values.includes(text)) {
    values.push(text);
  }
}

function isVisibleElement(element: HTMLElement): boolean {
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    if (current.getAttribute("aria-hidden") === "true" || current.hidden) {
      return false;
    }
    const style = window.getComputedStyle(current);
    if (style.display === "none") {
      return false;
    }
  }
  return window.getComputedStyle(element).visibility !== "hidden";
}
