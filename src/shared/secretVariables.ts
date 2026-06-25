import { MASK_VARIABLES } from "./scenarioConstants";
import type { Scenario } from "./types";

export function withDerivedSecretVariables(scenario: Scenario): Scenario {
  const variables = { ...scenario.variables };
  for (const step of scenario.steps) {
    const values = Array.isArray(step.value) ? step.value : [step.value];
    for (const value of values) {
      if (typeof value !== "string") {
        continue;
      }
      for (const [mask, variable] of Object.entries(MASK_VARIABLES)) {
        const existing = variables[variable.name];
        if (value.includes(mask) && (!existing || (existing.secret && existing.defaultValue === undefined))) {
          variables[variable.name] = {
            ...existing,
            type: "string",
            defaultValue: mask,
            secret: variable.secret
          };
        }
      }
    }
  }
  return { ...scenario, variables };
}
