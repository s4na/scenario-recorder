const SECRET_MARKERS = [
  "access_token",
  "authorization",
  "auth",
  "client_secret",
  "credential",
  "id_token",
  "key",
  "otp",
  "password",
  "pass",
  "refresh_token",
  "session",
  "signature",
  "api_key",
  "apikey",
  "secret",
  "ticket",
  "token",
  "credit",
  "card",
  "cvc",
  "cvv"
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
    element.getAttribute("aria-label")
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
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
    SECRET_MARKERS.some((marker) => haystack.includes(marker)) ||
    SECRET_CODE_PATTERNS.some((pattern) => pattern.test(haystack))
  );
}

export function maskValue(element: HTMLElement, value: string | string[]): string | string[] {
  if (!shouldMaskValue(element)) {
    return value;
  }

  const haystack = searchableAttributes(element);
  if (haystack.includes("credit") || haystack.includes("card")) {
    return "{{CREDIT_CARD}}";
  }
  if (
    haystack.includes("token") ||
    haystack.includes("secret") ||
    haystack.includes("api") ||
    haystack.includes("otp") ||
    SECRET_CODE_PATTERNS.some((pattern) => pattern.test(haystack)) ||
    haystack.includes("credential") ||
    haystack.includes("key") ||
    haystack.includes("authorization") ||
    haystack.includes("auth") ||
    haystack.includes("session") ||
    haystack.includes("signature")
  ) {
    return "{{SECRET}}";
  }
  return "{{PASSWORD}}";
}
