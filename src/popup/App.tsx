import { useEffect, useMemo, useRef, useState } from "react";
import type { ContentMessage } from "../shared/messages";
import { sendRuntimeMessage } from "../shared/messages";
import type { RecorderState, Scenario, ScenarioRecorderSettings, ScenarioStep } from "../shared/types";
import { downloadBlob, downloadJson } from "../shared/utils";

const EMPTY_STATE: RecorderState = {
  status: "idle",
  currentSteps: [],
  recordingSessions: []
};

const EMPTY_SETTINGS: ScenarioRecorderSettings = {
  allowedOrigins: [],
  recordingDetailLevel: "context"
};

type Notice = {
  kind: "success" | "error";
  text: string;
};

function truncateText(value: string, maxLength = 34): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}...` : normalized;
}

function pageLabel(url: string | undefined, title?: string): string {
  const cleanTitle = title?.trim();
  if (cleanTitle) {
    return `${truncateText(cleanTitle, 26)}ページ`;
  }
  if (!url) {
    return "現在のページ";
  }
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/^\/|\/$/g, "");
    return `${truncateText(path || parsed.host, 26)}ページ`;
  } catch {
    return "現在のページ";
  }
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
      return `${pageLabel(step.toUrl ?? step.url, step.title)}へ移動`;
    case "goto":
      return `${pageLabel(step.toUrl ?? step.url, step.title)}へ移動`;
    case "wait":
      return "ページの読み込みを待機";
    case "assert":
      return step.assertion?.kind === "title" ? "タイトルを確認" : "URLを確認";
    default:
      return "操作を記録";
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
    <section className="stepPreview" aria-label={title}>
      <div className="sectionHeader compact">
        <h3>{title}</h3>
        <span>{steps.length} steps</span>
      </div>
      <ol className="stepFlow">
        {visibleSteps.map((step, index) => (
          <li key={step.id}>
            <span aria-hidden="true">{newestFirst ? steps.length - index : index + 1}</span>
            <div>
              <small>{pageLabel(step.url, step.title)}</small>
              <strong>{describeStep(step)}</strong>
            </div>
          </li>
        ))}
      </ol>
      {remainingCount > 0 ? <p className="moreSteps">ほか {remainingCount} steps</p> : null}
    </section>
  );
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
  const [lastSavedScenarioId, setLastSavedScenarioId] = useState<string | undefined>();
  const [notice, setNotice] = useState<Notice | undefined>();
  const [isBusy, setIsBusy] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  const canStart = state.status === "idle" && state.currentSteps.length === 0;
  const canPause = state.status === "recording";
  const canResume = state.status === "paused";
  const canStop = state.status === "recording" || state.status === "paused";
  const canClear = state.currentSteps.length > 0 && state.status !== "idle" ? true : state.currentSteps.length > 0;
  const canSave = state.currentSteps.length > 0;
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

  async function runAction(action: () => Promise<void> | void, successText?: string) {
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
    const { parseScenarioImportText } = await import("../shared/scenarioImport");
    const importedScenarios = parseScenarioImportText(text);
    const response = await sendRuntimeMessage<"IMPORT_SCENARIOS">({
      type: "IMPORT_SCENARIOS",
      payload: { scenarios: importedScenarios }
    });
    setScenarios(response.scenarios);
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

  async function downloadScenarioZip(scenario: Scenario): Promise<void> {
    const [{ scenarioZipEntries, scenarioZipFileName }, { createZipBlob }] = await Promise.all([
      import("./downloads"),
      import("./zip"),
    ]);
    downloadBlob(
      scenarioZipFileName(scenario),
      createZipBlob(scenarioZipEntries(scenario, settings)),
    );
  }

  async function saveCurrentRecording(): Promise<void> {
    await flushActiveTabInputs();
    const response = await sendRuntimeMessage<"SAVE_SCENARIO">({
      type: "SAVE_SCENARIO",
      payload: { name: scenarioName.trim() }
    });
    await downloadScenarioZip(response.scenario);
    setLastSavedScenarioId(response.scenario.id);
    setScenarioName("");
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
            <p>いま開いているタブの作業を記録</p>
          </div>
          <span>周辺情報あり</span>
        </div>

        <label className="field">
          <span>記録名</span>
          <input
            data-testid="scenario-name"
            value={scenarioName}
            onChange={(event) => setScenarioName(event.target.value)}
            placeholder="空なら日時とURLで保存"
          />
        </label>

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

        {state.currentSteps.length > 0 ? (
          <div className="savePanel">
            <button
              data-testid="save-scenario"
              className="primary"
              disabled={!canSave || isBusy}
              onClick={() =>
                runAction(
                  saveCurrentRecording,
                  state.status === "idle"
                    ? "記録を保存してzipをダウンロードしました"
                    : "保存して終了し、zipをダウンロードしました",
                )
              }
            >
              {state.status === "idle" ? "保存してzipダウンロード" : "保存して終了しzipダウンロード"}
            </button>
          </div>
        ) : null}
      </section>

      {latestScenario ? (
        <section className="section handoffPanel">
          <div className="sectionHeader">
            <div>
              <h2>エクスポート</h2>
              <p>{latestScenario.name}</p>
            </div>
            <span>{latestScenario.steps.length} steps</span>
          </div>
          <StepSummaryList title="記録の流れ" steps={latestScenario.steps} limit={8} />
          <button
            className="primary"
            onClick={() => runAction(() => downloadScenarioZip(latestScenario), "この記録をエクスポートしました")}
          >
            この記録をzipでエクスポート
          </button>
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
                  const [{ allScenariosZipEntries, allScenariosZipFileName }, { createZipBlob }] = await Promise.all([
                    import("./downloads"),
                    import("./zip"),
                  ]);
                  downloadBlob(
                    allScenariosZipFileName(),
                    createZipBlob(allScenariosZipEntries(exportPayload.scenarios, settings)),
                  );
                }, "全記録をエクスポートしました")
              }
            >
              全記録をzipでエクスポート
            </button>
            <button disabled={isBusy} onClick={() => importInputRef.current?.click()}>
              インポート
            </button>
            <button
              disabled={isBusy}
              onClick={() =>
                runAction(async () => {
                  const { SCENARIO_JSON_SCHEMA } = await import("../shared/scenarioSchema");
                  downloadJson("scenario-recorder.schema.json", SCENARIO_JSON_SCHEMA);
                }, "JSON Schemaをダウンロードしました")
              }
            >
              JSON Schema
            </button>
          </div>
          <input
            ref={importInputRef}
            className="hiddenInput"
            type="file"
            accept="application/json,application/x-ndjson,.json,.jsonl,.jsonls"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) {
                return;
              }
              void runAction(() => importScenarioFile(file), "記録をインポートしました");
            }}
          />
        </div>
      </details>

      <section className="section scenarioList">
        <div className="sectionHeader">
          <div>
            <h2>記録一覧</h2>
            <p>保存済みの記録を確認、ダウンロード、削除</p>
          </div>
          <span>{scenarios.length}</span>
        </div>

        {scenarios.length === 0 ? (
          <p className="empty">保存済みの記録はありません。</p>
        ) : (
          <ul>
            {scenarios.map((scenario) => (
              <li key={scenario.id} className="scenarioItem">
                <div className="scenarioMeta">
                  <strong>{scenario.name}</strong>
                  <span>{scenario.steps.length} steps</span>
                  <small>作成: {new Date(scenario.createdAt).toLocaleString()}</small>
                  <StepSummaryList title="記録の流れ" steps={scenario.steps} limit={4} />
                </div>
                <div className="scenarioActions">
                  <button
                    className="primary"
                    onClick={() => runAction(() => downloadScenarioZip(scenario), "記録をダウンロードしました")}
                  >
                    zipダウンロード
                  </button>
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
                        "記録を削除しました"
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
