import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function readSource(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

function sourceFilesUnder(path: string): string[] {
  const absolutePath = resolve(root, path);
  return readdirSync(absolutePath, { withFileTypes: true }).flatMap((entry) => {
    const childPath = join(absolutePath, entry.name);
    if (entry.isDirectory()) {
      return sourceFilesUnder(relative(root, childPath));
    }
    if (!entry.isFile() || !/\.(tsx?|mts)$/.test(entry.name) || entry.name.includes(".test.")) {
      return [];
    }
    return [relative(root, childPath)];
  });
}

describe("artifact module boundaries", () => {
  it("keeps app entrypoints off the combined artifact implementation module", () => {
    const appSources = [
      ...sourceFilesUnder("src/background"),
      ...sourceFilesUnder("src/content"),
      ...sourceFilesUnder("src/popup"),
    ];

    for (const path of appSources) {
      expect(readSource(path), `${path} should import focused artifact modules instead`).not.toContain("scenarioArtifacts");
    }
  });

  it("keeps popup startup code from statically importing heavy artifact modules", () => {
    const staticPopupImports = [
      "from \"../shared/playwrightGenerator\"",
      "from \"../shared/scenarioImport\"",
      "from \"../shared/scenarioSchema\"",
      "from \"./downloads\"",
      "from \"./zip\"",
    ];

    for (const path of ["src/popup/App.tsx", "src/popup/main.tsx"]) {
      const source = readSource(path);
      for (const importText of staticPopupImports) {
        expect(source, `${path} should lazy-load ${importText}`).not.toContain(importText);
      }
    }
  });
});
