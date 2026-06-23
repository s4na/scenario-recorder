const SECRET_MARKERS = [
  "access_token",
  "authorization",
  "auth",
  "client_secret",
  "code",
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

const PASSWORD_AUTOCOMPLETE_VALUES = new Set([
  "current-password",
  "new-password",
  "cc-number",
  "cc-csc",
  "cc-exp"
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

  const autocomplete = element.getAttribute("autocomplete")?.toLowerCase();
  if (autocomplete && PASSWORD_AUTOCOMPLETE_VALUES.has(autocomplete)) {
    return true;
  }

  const haystack = searchableAttributes(element);
  return SECRET_MARKERS.some((marker) => haystack.includes(marker));
}

export function maskValue(element: HTMLElement, value: string): string {
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
    haystack.includes("code") ||
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
