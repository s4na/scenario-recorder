import type { ScenarioStep, TargetSnapshot } from "./types";

const SECRET_URL_KEYS = [
  "access_token",
  "api_key",
  "apikey",
  "auth",
  "authorization",
  "client_secret",
  "code",
  "credential",
  "id_token",
  "key",
  "otp",
  "password",
  "refresh_token",
  "secret",
  "session",
  "signature",
  "state",
  "ticket",
  "token"
];

const SECRET_PATH_MARKERS = [
  "auth",
  "confirm",
  "confirmation",
  "invite",
  "invitation",
  "magic-link",
  "magic_link",
  "password",
  "reset",
  "reset-password",
  "reset_password",
  "session",
  "ticket",
  "token",
  "verify",
  "verification"
];

export function createId(prefix: string): string {
  const random = crypto.getRandomValues(new Uint32Array(2));
  return `${prefix}_${Date.now().toString(36)}_${Array.from(random)
    .map((value) => value.toString(36))
    .join("")}`;
}

export function createStepId(): string {
  return createId("step");
}

export function toIsoNow(): string {
  return new Date().toISOString();
}

export function formatTimestampForFile(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join("");
}

export function formatTimestampForScenarioName(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    "-",
    pad(date.getMonth() + 1),
    "-",
    pad(date.getDate()),
    "--",
    pad(date.getHours()),
    "-",
    pad(date.getMinutes()),
    "-",
    pad(date.getSeconds())
  ].join("");
}

export function sanitizeFilePart(value: string): string {
  const normalized = value
    .trim()
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || "scenario";
}

export function downloadJson(filename: string, payload: unknown): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json;charset=utf-8"
  });
  downloadBlob(filename, blob);
}

export function downloadText(filename: string, text: string, type = "text/plain;charset=utf-8"): void {
  downloadBlob(filename, new Blob([text], { type }));
}

function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function getPrimarySelectorKey(target?: TargetSnapshot): string | undefined {
  const candidate = target?.selectorCandidates[0];
  if (!candidate) {
    return undefined;
  }
  return `${candidate.type}:${JSON.stringify(candidate.value)}`;
}

export function shouldReplaceFillStep(previous: ScenarioStep, next: ScenarioStep): boolean {
  if (previous.type !== "fill" || next.type !== "fill") {
    return false;
  }
  return getPrimarySelectorKey(previous.target) === getPrimarySelectorKey(next.target);
}

export function sanitizeUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.username = "";
    url.password = "";
    for (const key of Array.from(url.searchParams.keys())) {
      const value = url.searchParams.get(key) ?? "";
      if (isSecretUrlKey(key) || shouldRedactUrlValue(value)) {
        url.searchParams.set(key, "{{SECRET}}");
      }
    }

    url.pathname = sanitizePath(url.pathname);

    const sanitizedHash = sanitizeHash(url.hash);
    if (sanitizedHash !== url.hash) {
      url.hash = sanitizedHash;
    }

    return url.toString();
  } catch {
    return rawUrl;
  }
}

function shouldRedactUrlValue(value: string): boolean {
  const decoded = safeDecode(value);
  return (
    containsSecretUrlParam(decoded) ||
    containsJwt(decoded) ||
    /\bBearer\s+[A-Za-z0-9._~+/=-]+/i.test(decoded)
  );
}

function containsSecretUrlParam(value: string): boolean {
  const params = value.matchAll(/(?:^|[?&#;])([^=&#;?]+)=/g);
  for (const match of params) {
    if (isSecretUrlKey(match[1])) {
      return true;
    }
  }
  return false;
}

function containsJwt(value: string): boolean {
  return /\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/.test(value);
}

function isSecretUrlKey(key: string): boolean {
  const normalized = normalizeUrlKey(key);
  return normalized
    .split(/[/?#&;=]+/)
    .some((part) =>
      SECRET_URL_KEYS.some(
        (secretKey) => part === secretKey || part.endsWith(`_${secretKey}`),
      ),
    );
}

function normalizeUrlKey(key: string): string {
  const decoded = safeDecode(key);
  return decoded
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[-.]/g, "_");
}

function sanitizeHash(hash: string): string {
  if (!hash) {
    return hash;
  }

  const rawHash = hash.slice(1);
  const queryIndex = rawHash.indexOf("?");
  const hashPath = queryIndex >= 0 ? rawHash.slice(0, queryIndex) : rawHash;
  if (shouldRedactHashPath(hashPath)) {
    return "#{{SECRET}}";
  }
  const paramText = queryIndex >= 0 ? rawHash.slice(queryIndex + 1) : rawHash;
  if (!paramText.includes("=")) {
    return hash;
  }

  const hashParams = new URLSearchParams(paramText);
  let changed = false;
  for (const key of Array.from(hashParams.keys())) {
    const value = hashParams.get(key) ?? "";
    if (isSecretUrlKey(key) || shouldRedactUrlValue(value)) {
      hashParams.set(key, "{{SECRET}}");
      changed = true;
    }
  }

  if (!changed) {
    return hash;
  }

  const sanitizedParams = hashParams.toString();
  return queryIndex >= 0
    ? `#${rawHash.slice(0, queryIndex)}?${sanitizedParams}`
    : `#${sanitizedParams}`;
}

function sanitizePath(pathname: string): string {
  const segments = pathname.split("/");
  let redactingTail = false;
  return segments.map((segment) => {
    if (!segment) {
      return segment;
    }
    if (redactingTail) {
      return "{{SECRET}}";
    }
    if (isSecretPathMarker(segment)) {
      redactingTail = true;
      return segment;
    }
    return segment;
  }).join("/");
}

function isSecretPathMarker(segment: string): boolean {
  const normalized = safeDecode(segment).toLowerCase();
  return SECRET_PATH_MARKERS.includes(normalized);
}

function shouldRedactHashPath(rawHash: string): boolean {
  const normalized = safeDecode(rawHash).toLowerCase();
  const segments = normalized.split(/[/?#&=]+/);
  return segments.some((segment) =>
    SECRET_PATH_MARKERS.includes(segment)
  );
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
