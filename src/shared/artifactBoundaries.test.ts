import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function readSource(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

describe("artifact module boundaries", () => {
  it("keeps app entrypoints off the combined artifact implementation module", () => {
    const directConsumers = [
      "src/background/index.ts",
      "src/popup/App.tsx",
      "src/popup/downloads.ts",
    ];

    for (const path of directConsumers) {
      expect(readSource(path), `${path} should import focused artifact modules instead`).not.toContain("scenarioArtifacts");
    }
  });
});
