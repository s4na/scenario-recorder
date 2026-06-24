import { scenarioToPlaywright } from "../shared/scenarioArtifacts";
import type { Scenario, ScenarioRecorderSettings } from "../shared/types";
import { sanitizeFilePart } from "../shared/utils";

export function playwrightDownloadPayload(
  scenario: Scenario,
  settings: ScenarioRecorderSettings,
): { filename: string; text: string; type: string } {
  return {
    filename: `${sanitizeFilePart(scenario.name)}.spec.ts`,
    text: scenarioToPlaywright(scenario, { allowedOrigins: settings.allowedOrigins }),
    type: "text/typescript;charset=utf-8"
  };
}
