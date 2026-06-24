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

function scenario(id: string, name: string, updatedAt = "2026-06-23T10:00:00.000Z"): Scenario {
  return {
    schemaVersion: "scenario-recorder/v1",
    id,
    name,
    createdAt: "2026-06-23T10:00:00.000Z",
    updatedAt,
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
    storage.set(STORAGE_KEYS.SCENARIOS, [
      scenario("existing", "existing", "2026-06-24T10:00:00.000Z"),
      scenario("replace", "old local", "2026-06-23T10:00:00.000Z")
    ]);

    const scenarios = await importScenarios([
      scenario("existing", "older import", "2026-06-23T10:00:00.000Z"),
      scenario("replace", "new import", "2026-06-24T10:00:00.000Z"),
      scenario("duplicate", "first", "2026-06-23T10:00:00.000Z"),
      scenario("duplicate", "last", "2026-06-23T10:00:00.000Z")
    ]);

    const expectedScenarios = [
      ["replace", "new import"],
      ["duplicate", "last"],
      ["existing", "existing"]
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
