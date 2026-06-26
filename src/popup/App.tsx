import { useEffect, useMemo, useState } from "react";
import type { ContentMessage } from "../shared/messages";
import { sendRuntimeMessage } from "../shared/messages";
import { describeStep, pageLabel } from "../shared/stepSummary";
import type { RecorderState, Scenario, ScenarioRecorderSettings, ScenarioStep } from "../shared/types";
import { downloadBlob } from "../shared/utils";

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
        <span>{steps.length} ステップ</span>
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
      {remainingCount > 0 ? <p className="moreSteps">ほか {remainingCount} ステップ</p> : null}
    </section>
  );
}

function ScenarioLatestStep({ scenario }: { scenario: Scenario }) {
  const lastStep = scenario.steps.at(-1);
  if (!lastStep) {
    return null;
  }
  return (
    <p className="scenarioLatestStep">
      <span>最新</span>
      <strong>{describeStep(lastStep)}</strong>
    </p>
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
  const [notice, setNotice] = useState<Notice | undefined>();
  const [isBusy, setIsBusy] = useState(false);

  const canStart = state.status === "idle" && state.currentSteps.length === 0;
  const canDiscard = state.status !== "idle" || state.currentSteps.length > 0;
  const canSave = state.currentSteps.length > 0;
  const canExportAll = scenarios.length > 0;
  const latestScenario = useMemo(() => scenarios[0], [scenarios]);
  const statusTone = state.status === "paused" ? "recording" : state.status;
  const statusLabel = useMemo(() => {
    if (state.status === "recording" || state.status === "paused") return "録画中";
    return state.currentSteps.length > 0 ? "保存待ち" : "待機中";
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

  async function downloadAllScenariosZip(): Promise<void> {
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
  }

  async function saveCurrentRecording(): Promise<void> {
    await flushActiveTabInputs();
    await sendRuntimeMessage<"SAVE_SCENARIO">({
      type: "SAVE_SCENARIO",
      payload: { name: "" }
    });
  }

  async function discardCurrentRecording(): Promise<void> {
    await sendRuntimeMessage<"CLEAR_RECORDING">({ type: "CLEAR_RECORDING" });
  }

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => {
      void refresh();
    }, 1000);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <main className="app">
      <header className="header">
        <div>
          <h1>シナリオレコーダー</h1>
          <p className={`status status-${statusTone}`}>{statusLabel}</p>
        </div>
        <div className="counter">
          <span>{state.currentSteps.length}</span>
          <small>ステップ</small>
        </div>
      </header>

      {notice ? <p className={`notice ${notice.kind}`}>{notice.text}</p> : null}

      <section className="section recorderPanel">
        <div className="sectionHeader">
          <div>
            <h2>録画</h2>
            <p>Chromeで操作すると右下にステップが積み上がります。</p>
          </div>
        </div>
        <div className="primaryActions">
          {canStart ? (
            <button
              data-testid="start-recording"
              className="primary recordButton"
              disabled={isBusy}
              onClick={() => runAction(() => sendRuntimeMessage<"START_RECORDING">({ type: "START_RECORDING" }).then(setState), "録画を開始しました")}
            >
              録画開始
            </button>
          ) : null}
          {canSave ? (
            <button
              data-testid="save-scenario"
              className="primary saveButton"
              disabled={isBusy}
              onClick={() => runAction(saveCurrentRecording, "シナリオを保存しました")}
            >
              保存
            </button>
          ) : null}
          {canDiscard ? (
            <button
              className="danger subtleDanger discardButton"
              disabled={isBusy}
              onClick={() => {
                if (window.confirm("作業中の録画を破棄しますか？")) {
                  void runAction(discardCurrentRecording, "録画を破棄しました");
                }
              }}
            >
              破棄
            </button>
          ) : null}
        </div>
        <StepSummaryList title="作業中のステップ" steps={state.currentSteps} newestFirst limit={6} />
      </section>

      <section className="section scenarioList">
        <div className="sectionHeader">
          <div>
            <h2>シナリオ一覧</h2>
            <p>{latestScenario ? `最新: ${latestScenario.name}` : "保存したシナリオがここに並びます。"}</p>
          </div>
          <div className="sectionTools">
            <span>{scenarios.length}件</span>
            {canExportAll ? (
              <button
                className="secondary compactButton"
                disabled={isBusy}
                onClick={() => runAction(downloadAllScenariosZip, "全シナリオをエクスポートしました")}
              >
                全件エクスポート
              </button>
            ) : null}
          </div>
        </div>

        {scenarios.length === 0 ? (
          <p className="empty">上の「録画開始」から最初のシナリオを作れます。</p>
        ) : (
          <ul>
            {scenarios.map((scenario) => (
              <li key={scenario.id} className="scenarioItem">
                <div className="scenarioMeta">
                  <strong>{scenario.name}</strong>
                  <span>{scenario.steps.length} ステップ</span>
                  <small>{new Date(scenario.createdAt).toLocaleString()}</small>
                  <ScenarioLatestStep scenario={scenario} />
                </div>
                <div className="scenarioActions">
                  <button
                    className="primary"
                    disabled={isBusy}
                    onClick={() => runAction(() => downloadScenarioZip(scenario), "シナリオをエクスポートしました")}
                  >
                    エクスポート
                  </button>
                  <button
                    className="danger"
                    disabled={isBusy}
                    onClick={() => {
                      if (!window.confirm("このシナリオを削除しますか？")) {
                        return;
                      }
                      void runAction(
                        async () => {
                          const response = await sendRuntimeMessage<"DELETE_SCENARIO">({
                            type: "DELETE_SCENARIO",
                            payload: { scenarioId: scenario.id }
                          });
                          setScenarios(response.scenarios);
                        },
                        "シナリオを削除しました"
                      );
                    }}
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
