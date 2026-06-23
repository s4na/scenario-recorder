const SECRET_MARKER_PATTERNS = [
  /(^|[^a-z0-9])access[_\s-]*token([^a-z0-9]|$)/,
  /(^|[^a-z0-9])authorization([^a-z0-9]|$)/,
  /(^|[^a-z0-9])auth(?:entication)?([^a-z0-9]|$)/,
  /(^|[^a-z0-9])client[_\s-]*secret([^a-z0-9]|$)/,
  /(^|[^a-z0-9])credentials?([^a-z0-9]|$)/,
  /(^|[^a-z0-9])csrf[_\s-]*token([^a-z0-9]|$)/,
  /(^|[^a-z0-9])id[_\s-]*token([^a-z0-9]|$)/,
  /(^|[^a-z0-9])key([^a-z0-9]|$)/,
  /(^|[^a-z0-9])otp([^a-z0-9]|$)/,
  /(^|[^a-z0-9])password([^a-z0-9]|$)/,
  /(^|[^a-z0-9])pass([^a-z0-9]|$)/,
  /(^|[^a-z0-9])refresh[_\s-]*token([^a-z0-9]|$)/,
  /(^|[^a-z0-9])session([^a-z0-9]|$)/,
  /(^|[^a-z0-9])signature([^a-z0-9]|$)/,
  /(^|[^a-z0-9])api[_\s-]*key([^a-z0-9]|$)/,
  /(^|[^a-z0-9])apikey([^a-z0-9]|$)/,
  /(^|[^a-z0-9])secret([^a-z0-9]|$)/,
  /(^|[^a-z0-9])ticket([^a-z0-9]|$)/,
  /(^|[^a-z0-9])token([^a-z0-9]|$)/,
  /(^|[^a-z0-9])credit([^a-z0-9]|$)/,
  /(^|[^a-z0-9])creditcard(?:number)?([^a-z0-9]|$)/,
  /(^|[^a-z0-9])card([^a-z0-9]|$)/,
  /(^|[^a-z0-9])cardnumber([^a-z0-9]|$)/,
  /(^|[^a-z0-9])csc([^a-z0-9]|$)/,
  /(^|[^a-z0-9])csccode([^a-z0-9]|$)/,
  /(^|[^a-z0-9])cvc([^a-z0-9]|$)/,
  /(^|[^a-z0-9])cvccode([^a-z0-9]|$)/,
  /(^|[^a-z0-9])cvv([^a-z0-9]|$)/,
  /(^|[^a-z0-9])cvvcode([^a-z0-9]|$)/
];

const SECRET_CODE_PATTERNS = [
  /\bauth(?:entication)?[_\s-]*code\b/,
  /\bverification[_\s-]*code\b/,
  /\bone[_\s-]*code\b/,
  /\bone[_\s-]*time[_\s-]*code\b/,
  /\botp[_\s-]*code\b/,
  /\bmfa[_\s-]*code\b/,
  /\b2fa[_\s-]*code\b/,
  /\btotp[_\s-]*code\b/,
  /\btwo[_\s-]*factor[_\s-]*code\b/,
  /\btwofactorcode\b/,
  /\btwo[_\s-]*step[_\s-]*code\b/
];

const PASSWORD_AUTOCOMPLETE_VALUES = new Set([
  "current-password",
  "new-password",
  "one-time-code",
  "cc-number",
  "cc-csc",
  "cc-exp",
  "cc-exp-month",
  "cc-exp-year"
]);

function searchableAttributes(element: HTMLElement): string {
  return [
    element.getAttribute("name"),
    element.getAttribute("id"),
    element.getAttribute("placeholder"),
    element.getAttribute("aria-label"),
    getAriaLabelledByText(element),
    getLabelText(element)
  ]
    .filter((value): value is string => Boolean(value))
    .flatMap((value) => [value, splitCamelCase(value)])
    .join(" ")
    .toLowerCase();
}

function splitCamelCase(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
}

function hasSecretMarker(haystack: string): boolean {
  return SECRET_MARKER_PATTERNS.some((pattern) => pattern.test(haystack));
}

function hasCreditCardMarker(haystack: string): boolean {
  return (
    /(^|[^a-z0-9])credit([^a-z0-9]|$)/.test(haystack) ||
    /(^|[^a-z0-9])creditcard(?:number)?([^a-z0-9]|$)/.test(haystack) ||
    /(^|[^a-z0-9])card([^a-z0-9]|$)/.test(haystack) ||
    /(^|[^a-z0-9])cardnumber([^a-z0-9]|$)/.test(haystack) ||
    /(^|[^a-z0-9])csc(?:code)?([^a-z0-9]|$)/.test(haystack) ||
    /(^|[^a-z0-9])cvc(?:code)?([^a-z0-9]|$)/.test(haystack) ||
    /(^|[^a-z0-9])cvv(?:code)?([^a-z0-9]|$)/.test(haystack) ||
    /(^|[^a-z0-9])security[_\s-]*code([^a-z0-9]|$)/.test(haystack) ||
    /(^|[^a-z0-9])securitycode([^a-z0-9]|$)/.test(haystack)
  );
}

function getAriaLabelledByText(element: HTMLElement): string | undefined {
  const ids = element.getAttribute("aria-labelledby")?.split(/\s+/) ?? [];
  const text = ids
    .map((id) => document.getElementById(id)?.textContent?.trim())
    .filter(Boolean)
    .join(" ");
  return text || undefined;
}

function getLabelText(element: HTMLElement): string | undefined {
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement
  ) {
    const labels = Array.from(element.labels ?? []);
    const text = labels
      .map((label) => label.textContent?.trim())
      .filter(Boolean)
      .join(" ");
    return text || undefined;
  }
  return undefined;
}

export function shouldMaskValue(element: HTMLElement): boolean {
  if (element instanceof HTMLInputElement && element.type.toLowerCase() === "password") {
    return true;
  }

  const autocompleteTokens = element.getAttribute("autocomplete")?.toLowerCase().split(/\s+/) ?? [];
  if (
    autocompleteTokens.some(
      (token) => PASSWORD_AUTOCOMPLETE_VALUES.has(token) || token.startsWith("cc-")
    )
  ) {
    return true;
  }

  const haystack = searchableAttributes(element);
  return (
    hasSecretMarker(haystack) ||
    SECRET_CODE_PATTERNS.some((pattern) => pattern.test(haystack))
  );
}

export function maskValue(element: HTMLElement, value: string | string[]): string | string[] {
  if (!shouldMaskValue(element)) {
    return value;
  }

  const haystack = searchableAttributes(element);
  if (hasCreditCardMarker(haystack)) {
    return "{{CREDIT_CARD}}";
  }
  if (
    hasSecretMarker(haystack) ||
    SECRET_CODE_PATTERNS.some((pattern) => pattern.test(haystack)) ||
    /(^|[^a-z0-9])api([^a-z0-9]|$)/.test(haystack)
  ) {
    return "{{SECRET}}";
  }
  return "{{PASSWORD}}";
}
