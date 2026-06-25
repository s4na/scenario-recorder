import type { SelectorCandidateType } from "./types";

export const MASK_VARIABLES: Record<string, { name: string; secret: boolean }> = {
  "{{PASSWORD}}": { name: "password", secret: true },
  "{{SECRET}}": { name: "secret", secret: true },
  "{{CREDIT_CARD}}": { name: "creditCard", secret: true }
};
export const MASK_ENV_NAMES: Record<string, string> = {
  "{{PASSWORD}}": "SCENARIO_RECORDER_PASSWORD",
  "{{SECRET}}": "SCENARIO_RECORDER_SECRET",
  "{{CREDIT_CARD}}": "SCENARIO_RECORDER_CREDIT_CARD"
};
export const MASK_TOKENS = Object.keys(MASK_VARIABLES);
export const MASK_PATTERNS = MASK_TOKENS.flatMap((mask) => [mask, encodeURIComponent(mask)]);
export const RESERVED_IDENTIFIERS = new Set([
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "import",
  "implements",
  "in",
  "interface",
  "instanceof",
  "let",
  "new",
  "null",
  "package",
  "private",
  "protected",
  "public",
  "return",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "undefined",
  "var",
  "void",
  "while",
  "with",
  "yield"
]);

export const SELECTOR_CANDIDATE_TYPES: SelectorCandidateType[] = [
  "data-testid",
  "data-test",
  "data-cy",
  "aria-label",
  "role",
  "label",
  "name",
  "id",
  "placeholder",
  "text",
  "css",
  "xpath"
];
