import { scenarioToPlaywright } from "../shared/playwrightGenerator";
import { scenarioToJsonl } from "../shared/scenarioJsonl";
import type { Scenario, ScenarioRecorderSettings } from "../shared/types";
import { formatTimestampForFile, sanitizeFilePart } from "../shared/utils";

export type DownloadPayload = {
  filename: string;
  text: string;
  type: string;
};

export type ScenarioZipEntry = {
  name: string;
  text: string;
};

export function playwrightDownloadPayload(
  scenario: Scenario,
  settings: ScenarioRecorderSettings,
): DownloadPayload {
  return {
    filename: `${sanitizeFilePart(scenario.name)}.spec.ts`,
    text: scenarioToPlaywright(scenario, { allowedOrigins: settings.allowedOrigins }),
    type: "text/typescript;charset=utf-8"
  };
}

export function scenarioZipFileName(scenario: Scenario): string {
  return `${sanitizeFilePart(scenario.name)}.zip`;
}

export function allScenariosZipFileName(date = new Date()): string {
  return `scenario-records-${formatTimestampForFile(date)}.zip`;
}

export function scenarioZipEntries(
  scenario: Scenario,
  settings: ScenarioRecorderSettings,
  directory?: string,
): ScenarioZipEntry[] {
  const baseName = sanitizeFilePart(scenario.name);
  const prefix = directory ? `${sanitizeFilePart(directory)}/` : "";
  return [
    {
      name: `${prefix}${baseName}.spec.ts`,
      text: scenarioToPlaywright(scenario, { allowedOrigins: settings.allowedOrigins }),
    },
    {
      name: `${prefix}${baseName}.jsonl`,
      text: scenarioToJsonl(scenario),
    },
  ];
}

export function allScenariosZipEntries(
  scenarios: Scenario[],
  settings: ScenarioRecorderSettings,
): ScenarioZipEntry[] {
  const usedDirectories = new Set<string>();
  return scenarios.flatMap((scenario) => scenarioZipEntries(
    scenario,
    settings,
    uniqueScenarioDirectoryName(scenario, usedDirectories),
  ));
}

function uniqueScenarioDirectoryName(scenario: Scenario, usedDirectories: Set<string>): string {
  const baseName = sanitizeFilePart(scenario.name);
  let directory = baseName;
  let index = 2;
  while (usedDirectories.has(directory)) {
    directory = `${baseName}-${index}`;
    index += 1;
  }
  usedDirectories.add(directory);
  return directory;
}
