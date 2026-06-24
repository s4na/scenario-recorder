import { useEffect, useMemo, useRef, useState } from "react";
import type { ContentMessage } from "../shared/messages";
import { sendRuntimeMessage } from "../shared/messages";
import { parseScenarioImportText, scenarioToJsonl, SCENARIO_JSON_SCHEMA } from "../shared/scenarioArtifacts";
import type { RecorderState, Scenario, ScenarioRecorderSettings } from "../shared/types";
import { downloadJson, downloadText, formatTimestampForFile, sanitizeFilePart } from "../shared/utils";
import { playwrightDownloadPayload } from "./downloads";

const EMPTY_STATE: RecorderState = {
  status: "idle",
  currentSteps: [],
  recordingSessions: []
};

const EMPTY_SETTINGS: ScenarioRecorderSettings = {
  allowedOrigins: [],
  recordingDetailLevel: "minimal"
};

type Notice = {
  kind: "success" | "error";
  text: string;
};

function scenarioFileName(scenario: Scenario): string {
  return `scenario-${sanitizeFilePart(scenario.name)}-${formatTimestampForFile(
    new Date(scenario.updatedAt)
  )}.json`;
}

function allScenariosFileName(): string {
  return `scenario-recorder-export-${formatTimestampForFile()}.json`;
}

function isContentScriptUnavailableError(message: string): boolean {
  return (
    message.includes("Could not establish connection") ||
    message.includes("Receiving end does not exist") ||
    message.includes("Cannot access") ||
    message.includes("No tab with id")
  );
}

export default function App() {
  const [state, setState] = useState<RecorderState>(EMPTY_STATE);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [settings, setSettings] = useState<ScenarioRecorderSettings>(EMPTY_SETTINGS);
  const [scenarioName, setScenarioName] = useState("");
  const [allowedOriginsText, setAllowedOriginsText] = useState("");
  const [isEditingAllowedOrigins, setIsEditingAllowedOrigins] = useState(false);
  const [editingScenarioId, setEditingScenarioId] = useState<string | undefined>();
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editTags, setEditTags] = useState("");
  const [notice, setNotice] = useState<Notice | undefined>();
  const [isBusy, setIsBusy] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  const canStart = state.status === "idle" && state.currentSteps.length === 0;
  const canPause = state.status === "recording";
  const canResume = state.status === "paused";
  const canStop = state.status === "recording" || state.status === "paused";
  const canClear = state.currentSteps.length > 0 && state.status !== "idle" ? true : state.currentSteps.length > 0;
  const canSave =
    state.status === "idle" && state.currentSteps.length > 0 && scenarioName.trim().length > 0;
  const canDownloadCurrent = state.currentSteps.length > 0;
  const canExportAll = scenarios.length > 0;

  const statusLabel = useMemo(() => {
    if (state.status === "recording") return "recording";
    if (state.status === "paused") return "paused";
    return "idle";
  }, [state.status]);

  async function refresh() {
    const [nextState, scenariosResponse, nextSettings] = await Promise.all([
      sendRuntimeMessage<"GET_RECORDER_STATE">({ type: "GET_RECORDER_STATE" }),
      sendRuntimeMessage<"GET_SCENARIOS">({ type: "GET_SCENARIOS" }),
      sendRuntimeMessage<"GET_SETTINGS">({ type: "GET_SETTINGS" })
    ]);
    setState(nextState);
    setScenarios(scenariosResponse.scenarios);
    setSettings(nextSettings);
  }

  async function runAction(action: () => Promise<void>, successText?: string) {
    setIsBusy(true);
    setNotice(undefined);
    try {
      await action();
      await refresh();
      if (successText) {
        setNotice({ kind: "success", text: successText });
      }
    } catch (error) {
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "操作に失敗しました"
      });
    } finally {
      setIsBusy(false);
    }
  }

  async function importScenarioFile(file: File): Promise<void> {
    const text = await file.text();
    const importedScenarios = parseScenarioImportText(text);
    const response = await sendRuntimeMessage<"IMPORT_SCENARIOS">({
      type: "IMPORT_SCENARIOS",
      payload: { scenarios: importedScenarios }
    });
    setScenarios(response.scenarios);
  }

  function beginEditScenario(scenario: Scenario): void {
    setEditingScenarioId(scenario.id);
    setEditName(scenario.name);
    setEditDescription(scenario.description ?? "");
    setEditTags((scenario.tags ?? []).join(", "));
  }

  async function saveScenarioEdits(scenario: Scenario): Promise<void> {
    const response = await sendRuntimeMessage<"UPDATE_SCENARIO">({
      type: "UPDATE_SCENARIO",
      payload: {
        scenarioId: scenario.id,
        name: editName.trim() || scenario.name,
        description: editDescription.trim(),
        tags: editTags.split(",").map((tag) => tag.trim()).filter(Boolean)
      }
    });
    setScenarios(response.scenarios);
    setEditingScenarioId(undefined);
  }

  async function flushActiveTabInputs(): Promise<void> {
    let tabId = state.targetTabId;
    if (tabId === undefined) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      tabId = tab.id;
    }
    if (tabId === undefined) {
      return;
    }
    try {
      const message: ContentMessage<"FLUSH_PENDING_INPUTS"> = { type: "FLUSH_PENDING_INPUTS" };
      const response = await chrome.tabs.sendMessage(tabId, message);
      if (response && typeof response === "object" && "error" in response) {
        throw new Error(String(response.error));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isContentScriptUnavailableError(message)) {
        return;
      }
      throw error;
    }
  }

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => {
      void refresh();
    }, 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!isEditingAllowedOrigins) {
      setAllowedOriginsText(settings.allowedOrigins.join("\n"));
    }
  }, [isEditingAllowedOrigins, settings]);

  return (
    <main className="app">
      <header className="header">
        <div>
          <h1>シナリオレコーダー</h1>
          <p className={`status status-${state.status}`}>{statusLabel}</p>
        </div>
        <div className="counter">
          <span>{state.currentSteps.length}</span>
          <small>steps</small>
        </div>
      </header>

      {notice ? <p className={`notice ${notice.kind}`}>{notice.text}</p> : null}

      <section className="section">
        <label className="field">
          <span>シナリオ名</span>
          <input
            value={scenarioName}
            onChange={(event) => setScenarioName(event.target.value)}
            placeholder="例: 予約作成"
          />
        </label>

        <div className="actions">
          <button disabled={!canStart || isBusy} onClick={() => runAction(() => sendRuntimeMessage<"START_RECORDING">({ type: "START_RECORDING" }).then(setState), "記録を開始しました")}>
            記録開始
          </button>
          <button disabled={!canPause || isBusy} onClick={() => runAction(async () => {
            await flushActiveTabInputs();
            setState(await sendRuntimeMessage<"PAUSE_RECORDING">({ type: "PAUSE_RECORDING" }));
          }, "一時停止しました")}>
            一時停止
          </button>
          <button disabled={!canResume || isBusy} onClick={() => runAction(() => sendRuntimeMessage<"RESUME_RECORDING">({ type: "RESUME_RECORDING" }).then(setState), "再開しました")}>
            再開
          </button>
          <button disabled={!canStop || isBusy} onClick={() => runAction(async () => {
            await flushActiveTabInputs();
            setState(await sendRuntimeMessage<"STOP_RECORDING">({ type: "STOP_RECORDING" }));
          }, "停止しました")}>
            停止
          </button>
          <button disabled={!canClear || isBusy} onClick={() => runAction(() => sendRuntimeMessage<"CLEAR_RECORDING">({ type: "CLEAR_RECORDING" }).then(setState), "現在の記録をクリアしました")}>
            クリア
          </button>
          <button
            disabled={!canSave || isBusy}
            onClick={() =>
              runAction(async () => {
                await flushActiveTabInputs();
                await sendRuntimeMessage<"SAVE_SCENARIO">({
                  type: "SAVE_SCENARIO",
                  payload: { name: scenarioName.trim() }
                });
                setScenarioName("");
              }, "シナリオを保存しました")
            }
          >
            保存
          </button>
        </div>

        <div className="exportActions">
          <button
            disabled={!canDownloadCurrent || isBusy}
            onClick={() =>
              runAction(async () => {
                await flushActiveTabInputs();
                const latestState = await sendRuntimeMessage<"GET_RECORDER_STATE">({
                  type: "GET_RECORDER_STATE"
                });
                setState(latestState);
                const filename = `current-recording-${formatTimestampForFile()}.json`;
                downloadJson(filename, {
                  schemaVersion: "scenario-recorder/current/v1",
                  exportedAt: new Date().toISOString(),
                  state: latestState
                });
              }, "現在の記録をダウンロードしました")
            }
          >
            現在の記録をJSONでダウンロード
          </button>
          <button
            disabled={!canExportAll || isBusy}
            onClick={() =>
              runAction(async () => {
                const exportPayload = await sendRuntimeMessage<"EXPORT_ALL_SCENARIOS">({
                  type: "EXPORT_ALL_SCENARIOS"
                });
                downloadJson(allScenariosFileName(), exportPayload);
              }, "全シナリオをエクスポートしました")
            }
          >
            全シナリオを一括エクスポート
          </button>
          <button disabled={isBusy} onClick={() => importInputRef.current?.click()}>
            シナリオJSON/JSONLをインポート
          </button>
          <button
            disabled={isBusy}
            onClick={() =>
              downloadJson("scenario-recorder.schema.json", SCENARIO_JSON_SCHEMA)
            }
          >
            JSON Schemaをダウンロード
          </button>
          <input
            ref={importInputRef}
            className="hiddenInput"
            type="file"
            accept="application/json,application/x-ndjson,.json,.jsonl"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) {
                return;
              }
              void runAction(() => importScenarioFile(file), "シナリオをインポートしました");
            }}
          />
        </div>
      </section>

      <section className="section">
        <div className="sectionHeader">
          <h2>対象ドメイン</h2>
          <span>{settings.allowedOrigins.length || "all"}</span>
        </div>
        <label className="field">
          <span>1行に1 origin。空なら全HTTP/HTTPSページを対象にします。</span>
          <textarea
            value={allowedOriginsText}
            onChange={(event) => {
              setIsEditingAllowedOrigins(true);
              setAllowedOriginsText(event.target.value);
            }}
            placeholder="https://staging.example.com"
          />
        </label>
        <button
          disabled={isBusy}
          onClick={() =>
            runAction(async () => {
              const nextSettings = await sendRuntimeMessage<"UPDATE_SETTINGS">({
                type: "UPDATE_SETTINGS",
                payload: {
                  allowedOrigins: allowedOriginsText.split("\n"),
                  recordingDetailLevel: settings.recordingDetailLevel
                }
              });
              setSettings(nextSettings);
              setAllowedOriginsText(nextSettings.allowedOrigins.join("\n"));
              setIsEditingAllowedOrigins(false);
            }, "対象ドメインを保存しました")
          }
        >
          対象ドメインを保存
        </button>
        <label className="field">
          <span>記録の詳細度</span>
          <select
            value={settings.recordingDetailLevel}
            onChange={(event) =>
              runAction(async () => {
                const nextSettings = await sendRuntimeMessage<"UPDATE_SETTINGS">({
                  type: "UPDATE_SETTINGS",
                  payload: {
                    allowedOrigins: settings.allowedOrigins,
                    recordingDetailLevel: event.target.value === "context" ? "context" : "minimal"
                  }
                });
                setSettings(nextSettings);
              }, "記録の詳細度を保存しました")
            }
            disabled={isBusy}
          >
            <option value="minimal">minimal: 対象要素だけ</option>
            <option value="context">context: 周辺文脈も保存</option>
          </select>
        </label>
      </section>

      <section className="section">
        <div className="sectionHeader">
          <h2>assertion</h2>
          <span>{state.currentSteps.filter((step) => step.type === "assert").length}</span>
        </div>
        <div className="scenarioActions">
          <button
            disabled={state.status === "idle" || isBusy}
            onClick={() =>
              runAction(async () => {
                setState(await sendRuntimeMessage<"ADD_ASSERTION_STEP">({
                  type: "ADD_ASSERTION_STEP",
                  payload: { kind: "url" }
                }));
              }, "URL assertionを追加しました")
            }
          >
            現在URLをassert
          </button>
          <button
            disabled={state.status === "idle" || isBusy}
            onClick={() =>
              runAction(async () => {
                setState(await sendRuntimeMessage<"ADD_ASSERTION_STEP">({
                  type: "ADD_ASSERTION_STEP",
                  payload: { kind: "title" }
                }));
              }, "タイトル assertionを追加しました")
            }
          >
            タイトルをassert
          </button>
        </div>
      </section>

      <section className="section scenarioList">
        <div className="sectionHeader">
          <h2>保存済みシナリオ</h2>
          <span>{scenarios.length}</span>
        </div>

        {scenarios.length === 0 ? (
          <p className="empty">保存済みシナリオはありません。</p>
        ) : (
          <ul>
            {scenarios.map((scenario) => (
              <li key={scenario.id} className="scenarioItem">
                <div className="scenarioMeta">
                  {editingScenarioId === scenario.id ? (
                    <div className="editFields">
                      <input value={editName} onChange={(event) => setEditName(event.target.value)} />
                      <textarea
                        value={editDescription}
                        onChange={(event) => setEditDescription(event.target.value)}
                        placeholder="説明"
                      />
                      <input value={editTags} onChange={(event) => setEditTags(event.target.value)} placeholder="tag-a, tag-b" />
                    </div>
                  ) : (
                    <>
                      <strong>{scenario.name}</strong>
                      {scenario.description ? <small>{scenario.description}</small> : null}
                      {scenario.tags?.length ? <small>{scenario.tags.join(", ")}</small> : null}
                    </>
                  )}
                  <span>{scenario.steps.length} steps</span>
                  <span>{Object.keys(scenario.variables ?? {}).length} variables</span>
                  <small>作成: {new Date(scenario.createdAt).toLocaleString()}</small>
                  <small>更新: {new Date(scenario.updatedAt).toLocaleString()}</small>
                </div>
                <div className="scenarioActions">
                  <button onClick={() => downloadText(`${sanitizeFilePart(scenario.name)}.jsonl`, scenarioToJsonl(scenario), "application/x-ndjson;charset=utf-8")}>
                    JSONLエクスポート
                  </button>
                  <button onClick={() => downloadJson(scenarioFileName(scenario), scenario)}>
                    JSON
                  </button>
                  <button
                    onClick={() =>
                      runAction(async () => {
                        const payload = playwrightDownloadPayload(scenario, settings);
                        downloadText(payload.filename, payload.text, payload.type);
                      })
                    }
                  >
                    Playwright
                  </button>
                  {editingScenarioId === scenario.id ? (
                    <button
                      onClick={() =>
                        runAction(() => saveScenarioEdits(scenario), "シナリオを更新しました")
                      }
                    >
                      編集保存
                    </button>
                  ) : (
                    <button onClick={() => beginEditScenario(scenario)}>編集</button>
                  )}
                  <button
                    className="danger"
                    onClick={() =>
                      runAction(
                        async () => {
                          const response = await sendRuntimeMessage<"DELETE_SCENARIO">({
                            type: "DELETE_SCENARIO",
                            payload: { scenarioId: scenario.id }
                          });
                          setScenarios(response.scenarios);
                        },
                        "シナリオを削除しました"
                      )
                    }
                  >
                    削除
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
