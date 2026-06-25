import { useEffect, useMemo, useRef, useState } from "react";
import type { ContentMessage } from "../shared/messages";
import { sendRuntimeMessage } from "../shared/messages";
import { parseScenarioImportText, scenarioToJsonl, SCENARIO_JSON_SCHEMA } from "../shared/scenarioArtifacts";
import type { RecorderState, Scenario, ScenarioRecorderSettings, ScenarioStep } from "../shared/types";
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
  return `${sanitizeFilePart(scenario.name)}.json`;
}

function allScenariosFileName(): string {
  return `scenario-recorder-export-${formatTimestampForFile()}.json`;
}

function scenarioJsonlFileName(scenario: Scenario): string {
  return `${sanitizeFilePart(scenario.name)}.jsonl`;
}

function scenarioPlaywrightFileName(scenario: Scenario): string {
  return `${sanitizeFilePart(scenario.name)}.spec.ts`;
}

function truncateText(value: string, maxLength = 34): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}...` : normalized;
}

function describeStep(step: ScenarioStep): string {
  const targetName = step.target?.label ?? step.target?.ariaLabel ?? step.target?.text ?? step.target?.placeholder;
  const target = targetName ? `「${targetName}」` : step.target?.tagName?.toLowerCase();
  switch (step.type) {
    case "click":
      return target ? `${target}をクリック` : "クリック";
    case "fill":
      return target ? `${target}に入力` : "入力";
    case "select":
      return target ? `${target}を選択` : "選択";
    case "selection":
      return typeof step.value === "string" ? `「${truncateText(step.value)}」を文字選択` : "文字選択";
    case "submit":
      return target ? `${target}を送信` : "送信";
    case "navigation":
      return "ページ遷移";
    case "assert":
      return step.assertion?.kind === "title" ? "タイトルを確認" : "URLを確認";
    default:
      return step.type;
  }
}

function StepSummaryList({
  title,
  steps,
  newestFirst = false,
  limit = 5,
}: {
  title: string;
  steps: ScenarioStep[];
  newestFirst?: boolean;
  limit?: number;
}) {
  const visibleSteps = newestFirst ? steps.slice(-limit).reverse() : steps.slice(0, limit);
  const remainingCount = Math.max(steps.length - visibleSteps.length, 0);
  if (steps.length === 0) {
    return null;
  }
  return (
    <div className="stepPreview" aria-label={title}>
      <div className="sectionHeader compact">
        <h3>{title}</h3>
        <span>{steps.length} steps</span>
      </div>
      <ol>
        {visibleSteps.map((step, index) => (
          <li key={step.id}>
            <span>{newestFirst ? steps.length - index : index + 1}</span>
            <strong>{describeStep(step)}</strong>
            <small>{step.type}</small>
          </li>
        ))}
      </ol>
      {remainingCount > 0 ? <p className="moreSteps">ほか {remainingCount} steps</p> : null}
    </div>
  );
}

function detailLevelLabel(detailLevel: ScenarioRecorderSettings["recordingDetailLevel"]): string {
  return detailLevel === "context" ? "Codex向け" : "軽量";
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
  const [lastSavedScenarioId, setLastSavedScenarioId] = useState<string | undefined>();
  const [notice, setNotice] = useState<Notice | undefined>();
  const [isBusy, setIsBusy] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  const canStart = state.status === "idle" && state.currentSteps.length === 0;
  const canPause = state.status === "recording";
  const canResume = state.status === "paused";
  const canStop = state.status === "recording" || state.status === "paused";
  const canClear = state.currentSteps.length > 0 && state.status !== "idle" ? true : state.currentSteps.length > 0;
  const canSave = state.status === "idle" && state.currentSteps.length > 0;
  const canExportAll = scenarios.length > 0;
  const latestScenario = useMemo(
    () => scenarios.find((scenario) => scenario.id === lastSavedScenarioId) ?? scenarios[0],
    [lastSavedScenarioId, scenarios],
  );
  const statusLabel = useMemo(() => {
    if (state.status === "recording") return "記録中";
    if (state.status === "paused") return "一時停止";
    return state.currentSteps.length > 0 ? "確認待ち" : "待機中";
  }, [state.currentSteps.length, state.status]);

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

  async function executeScenario(scenario: Scenario): Promise<void> {
    await sendRuntimeMessage<"EXECUTE_SCENARIO">({
      type: "EXECUTE_SCENARIO",
      payload: { scenarioId: scenario.id }
    });
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
          <small>記録</small>
        </div>
      </header>

      {notice ? <p className={`notice ${notice.kind}`}>{notice.text}</p> : null}

      <section className="section focusPanel">
        <div className="sectionHeader">
          <div>
            <h2>作る</h2>
            <p>いま開いているタブの操作を記録</p>
          </div>
          <span>{detailLevelLabel(settings.recordingDetailLevel)}</span>
        </div>

        <label className="field">
          <span>シナリオ名</span>
          <input
            data-testid="scenario-name"
            value={scenarioName}
            onChange={(event) => setScenarioName(event.target.value)}
            placeholder="空なら日時とURLで保存"
          />
        </label>

        <div className="modeGroup" aria-label="記録の詳細度">
          <button
            data-testid="mode-context"
            aria-pressed={settings.recordingDetailLevel === "context"}
            className={settings.recordingDetailLevel === "context" ? "selected" : ""}
            disabled={isBusy}
            onClick={() =>
              runAction(async () => {
                const nextSettings = await sendRuntimeMessage<"UPDATE_SETTINGS">({
                  type: "UPDATE_SETTINGS",
                  payload: {
                    allowedOrigins: settings.allowedOrigins,
                    recordingDetailLevel: "context"
                  }
                });
                setSettings(nextSettings);
              }, "記録の詳細度を保存しました")
            }
          >
            Codex向け
          </button>
          <button
            data-testid="mode-minimal"
            aria-pressed={settings.recordingDetailLevel === "minimal"}
            className={settings.recordingDetailLevel === "minimal" ? "selected" : ""}
            disabled={isBusy}
            onClick={() =>
              runAction(async () => {
                const nextSettings = await sendRuntimeMessage<"UPDATE_SETTINGS">({
                  type: "UPDATE_SETTINGS",
                  payload: {
                    allowedOrigins: settings.allowedOrigins,
                    recordingDetailLevel: "minimal"
                  }
                });
                setSettings(nextSettings);
              }, "記録の詳細度を保存しました")
            }
          >
            軽量
          </button>
        </div>

        <div className="primaryActions">
          {canStart ? (
            <button
              data-testid="start-recording"
              className="primary"
              disabled={isBusy}
              onClick={() => runAction(() => sendRuntimeMessage<"START_RECORDING">({ type: "START_RECORDING" }).then(setState), "記録を開始しました")}
            >
              記録開始
            </button>
          ) : null}
          {canPause ? (
            <button data-testid="pause-recording" className="primary" disabled={isBusy} onClick={() => runAction(async () => {
              await flushActiveTabInputs();
              setState(await sendRuntimeMessage<"PAUSE_RECORDING">({ type: "PAUSE_RECORDING" }));
            }, "一時停止しました")}>
              一時停止
            </button>
          ) : null}
          {canResume ? (
            <button data-testid="resume-recording" className="primary" disabled={isBusy} onClick={() => runAction(() => sendRuntimeMessage<"RESUME_RECORDING">({ type: "RESUME_RECORDING" }).then(setState), "再開しました")}>
              再開
            </button>
          ) : null}
          {canStop ? (
            <button data-testid="stop-recording" disabled={isBusy} onClick={() => runAction(async () => {
              await flushActiveTabInputs();
              setState(await sendRuntimeMessage<"STOP_RECORDING">({ type: "STOP_RECORDING" }));
            }, "確認へ進みます")}>
              停止して確認
            </button>
          ) : null}
        </div>

        <div className="supportActions">
          <button
            disabled={state.status === "idle" || isBusy}
            onClick={() =>
              runAction(async () => {
                setState(await sendRuntimeMessage<"ADD_ASSERTION_STEP">({
                  type: "ADD_ASSERTION_STEP",
                  payload: { kind: "url" }
                }));
              }, "URL確認を追加しました")
            }
          >
            URL確認を追加
          </button>
          <button
            disabled={state.status === "idle" || isBusy}
            onClick={() =>
              runAction(async () => {
                setState(await sendRuntimeMessage<"ADD_ASSERTION_STEP">({
                  type: "ADD_ASSERTION_STEP",
                  payload: { kind: "title" }
                }));
              }, "タイトル確認を追加しました")
            }
          >
            タイトル確認を追加
          </button>
          <button disabled={!canClear || isBusy} onClick={() => runAction(() => sendRuntimeMessage<"CLEAR_RECORDING">({ type: "CLEAR_RECORDING" }).then(setState), "現在の記録をクリアしました")}>
            クリア
          </button>
        </div>

        <StepSummaryList title="今回の記録" steps={state.currentSteps} newestFirst />

        {state.status === "idle" && state.currentSteps.length > 0 ? (
          <div className="savePanel">
            <button
              data-testid="save-scenario"
              className="primary"
              disabled={!canSave || isBusy}
              onClick={() =>
                runAction(async () => {
                  await flushActiveTabInputs();
                  const response = await sendRuntimeMessage<"SAVE_SCENARIO">({
                    type: "SAVE_SCENARIO",
                    payload: { name: scenarioName.trim() }
                  });
                  setLastSavedScenarioId(response.scenario.id);
                  setScenarioName("");
                }, "シナリオを保存しました")
              }
            >
              保存してJSONLへ進む
            </button>
          </div>
        ) : null}
      </section>

      {latestScenario ? (
        <section className="section handoffPanel">
          <div className="sectionHeader">
            <div>
              <h2>渡す</h2>
              <p>{latestScenario.name}</p>
            </div>
            <span>{latestScenario.steps.length} steps</span>
          </div>
          <button
            className="primary"
            onClick={() => downloadText(scenarioJsonlFileName(latestScenario), scenarioToJsonl(latestScenario), "application/x-ndjson;charset=utf-8")}
          >
            Codex用JSONLをダウンロード
          </button>
          <div className="supportActions">
            <button
              onClick={() =>
                runAction(() => executeScenario(latestScenario), "シナリオを実行しました")
              }
            >
              実行
            </button>
            <button onClick={() => downloadJson(scenarioFileName(latestScenario), latestScenario)}>
              JSONをダウンロード
            </button>
            <button
              onClick={() =>
                runAction(async () => {
                  const payload = playwrightDownloadPayload(latestScenario, settings);
                  downloadText(scenarioPlaywrightFileName(latestScenario), payload.text, payload.type);
                })
              }
            >
              Playwrightをダウンロード
            </button>
          </div>
          <StepSummaryList title="ステップ概要" steps={latestScenario.steps} limit={6} />
        </section>
      ) : null}

      <details className="section settingsPanel">
        <summary>対象と管理</summary>
        <div className="detailsBody">
          <div className="sectionHeader">
            <h2>対象 origin</h2>
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
              }, "対象 originを保存しました")
            }
          >
              対象 originを保存
          </button>

          <div className="managementActions">
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
              全シナリオをエクスポート
            </button>
            <button disabled={isBusy} onClick={() => importInputRef.current?.click()}>
              インポート
            </button>
            <button
              disabled={isBusy}
              onClick={() =>
                downloadJson("scenario-recorder.schema.json", SCENARIO_JSON_SCHEMA)
              }
            >
              JSON Schema
            </button>
          </div>
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
      </details>

      <section className="section scenarioList">
        <div className="sectionHeader">
          <div>
            <h2>シナリオ一覧</h2>
            <p>保存済みシナリオを実行、個別ダウンロード、編集</p>
          </div>
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
                  <StepSummaryList title="ステップ概要" steps={scenario.steps} limit={4} />
                </div>
                <div className="scenarioActions">
                  <button
                    className="primary"
                    onClick={() =>
                      runAction(() => executeScenario(scenario), "シナリオを実行しました")
                    }
                  >
                    実行
                  </button>
                  <button onClick={() => downloadText(scenarioJsonlFileName(scenario), scenarioToJsonl(scenario), "application/x-ndjson;charset=utf-8")}>
                    JSONLをダウンロード
                  </button>
                  <button onClick={() => downloadJson(scenarioFileName(scenario), scenario)}>
                    JSONをダウンロード
                  </button>
                  <button
                    onClick={() =>
                      runAction(async () => {
                        const payload = playwrightDownloadPayload(scenario, settings);
                        downloadText(scenarioPlaywrightFileName(scenario), payload.text, payload.type);
                      })
                    }
                  >
                    Playwrightをダウンロード
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
