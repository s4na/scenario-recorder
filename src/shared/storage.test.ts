import { describe, expect, it, vi } from "vitest";
import type { Scenario } from "./types";
import { getScenarios, getSettings, importScenarios, setSettings, STORAGE_KEYS } from "./storage";

const storage = new Map<string, unknown>();

vi.stubGlobal("chrome", {
  storage: {
    local: {
      async get(key: string) {
        return { [key]: storage.get(key) };
      },
      async set(values: Record<string, unknown>) {
        for (const [key, value] of Object.entries(values)) {
          storage.set(key, value);
        }
      }
    }
  }
});

function scenario(id: string, name: string): Scenario {
  return {
    schemaVersion: "scenario-recorder/v1",
    id,
    name,
    createdAt: "2026-06-23T10:00:00.000Z",
    updatedAt: "2026-06-23T10:00:00.000Z",
    recording: { sessions: [] },
    steps: [],
    metadata: {
      userAgent: "test",
      extensionVersion: "0.1.0",
      recordedBy: "scenario-recorder"
    }
  };
}

describe("storage", () => {
  it("deduplicates imported scenarios by id before saving", async () => {
    storage.clear();
    storage.set(STORAGE_KEYS.SCENARIOS, [scenario("existing", "existing")]);

    const scenarios = await importScenarios([
      scenario("existing", "imported existing"),
      scenario("duplicate", "first"),
      scenario("duplicate", "last")
    ]);

    const expectedScenarios = [
      ["existing", "imported existing"],
      ["duplicate", "last"],
    ];

    expect(scenarios.map((item) => [item.id, item.name])).toEqual(expectedScenarios);
    expect((await getScenarios()).map((item) => [item.id, item.name])).toEqual(expectedScenarios);
  });

  it("persists target-domain settings and defaults to no restrictions", async () => {
    storage.clear();

    await expect(getSettings()).resolves.toEqual({ allowedOrigins: [] });

    await setSettings({ allowedOrigins: ["https://example.com"] });

    await expect(getSettings()).resolves.toEqual({ allowedOrigins: ["https://example.com"] });
  });
});
