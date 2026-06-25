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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

describe("artifact module boundaries", () => {
  it("keeps app runtime code off the scenarioArtifacts compatibility barrel", () => {
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
    const staticPopupImportSpecifiers = [
      "../shared/playwrightGenerator",
      "../shared/scenarioImport",
      "../shared/scenarioSchema",
      "./downloads",
      "./zip",
    ];

    for (const path of ["src/popup/App.tsx", "src/popup/main.tsx"]) {
      const source = readSource(path);
      for (const specifier of staticPopupImportSpecifiers) {
        expect(source, `${path} should lazy-load ${specifier}`).not.toMatch(
          new RegExp(`import\\s+(?:[^"']+\\s+from\\s+)?["']${escapeRegExp(specifier)}["']`),
        );
      }
    }
  });
});
