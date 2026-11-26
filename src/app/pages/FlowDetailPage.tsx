import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useParams, useNavigate } from "react-router";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Edge,
  type NodeTypes,
} from "@xyflow/react";
import type { Node as RFNode } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  ChevronLeft,
  GitBranch,
  Play,
  Pause,
  Check,
  AlertTriangle,
  Loader2,
  XCircle,
  Video,
  Square,
} from "lucide-react";
import { Layout } from "../components/Layout";
import { Button } from "../components/ui/button";
import {
  FlowScenariosContext,
  FlowScenarioNode,
} from "../components/flow/ScenarioFlowNodes";
import { ACTION_REGISTRY } from "../data";
import { getScenarios, getScenarioById } from "@/stores/scenarioStore";
import {
  getSavedFlowById,
  saveFlowToList,
  FLOW_DEFAULT_NAME,
  type SerializedFlow,
} from "@/stores/flowCompositionStore";
import { extractLinearScenarioOrderedIds } from "@/lib/flowLinearPath";
import { getStepDelayMs, getApiKey, getLlmProvider, readLlmRuntimeConfig } from "@/stores/settingsStore";
import { getActiveTabId } from "@/hooks/useActiveTabId";
import { useInspectedTabUrl } from "@/hooks/useInspectedTabUrl";
import { isActionImplemented } from "@/actions";
import type { Scenario, ScenarioStep } from "../data";
import type { RunnerState } from "@/engine/runner";
import { cn } from "@/lib/utils";

const EDGE_STYLE: React.CSSProperties = {
  stroke: "#94a3b8",
  strokeWidth: 1.75,
  strokeDasharray: "5 5",
};

function toReactNodes(flow: SerializedFlow): RFNode[] {
  return flow.nodes.map((n) => ({
    id: n.id,
    type: n.type,
    position: n.position,
    data: { ...n.data },
    selectable: false,
    draggable: false,
  }));
}

function toReactEdges(flow: SerializedFlow): Edge[] {
  return flow.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    style: { ...EDGE_STYLE },
  }));
}

const nodeTypes: NodeTypes = {
  flowScenario: FlowScenarioNode,
};

type StepStatus = "idle" | "running" | "success" | "failed" | "todo";

interface CombinedStep {
  scenarioId: string;
  scenarioTitle: string;
  step: ScenarioStep;
  globalIndex: number;
}

function isChromeExtension(): boolean {
  return typeof chrome !== "undefined" && !!chrome.runtime?.sendMessage;
}

function FlowDetailInner({
  flow,
  onFlowUpdated,
}: {
  flow: SerializedFlow;
  onFlowUpdated: (next: SerializedFlow) => void;
}) {
  const navigate = useNavigate();
  const scenarios = useMemo(() => getScenarios(), []);
  const { currentFullUrl } = useInspectedTabUrl();

  const [nodes] = useNodesState(toReactNodes(flow));
  const [edges] = useEdgesState(toReactEdges(flow));

  const scenarioPath = useMemo(
    () => extractLinearScenarioOrderedIds(flow.nodes, flow.edges),
    [flow.nodes, flow.edges],
  );

  const [headerNameDraft, setHeaderNameDraft] = useState(flow.name);
  useEffect(() => {
    setHeaderNameDraft(flow.name);
  }, [flow.id, flow.name]);

  const commitFlowName = useCallback(() => {
    const trimmed = headerNameDraft.trim() || FLOW_DEFAULT_NAME;
    if (trimmed === flow.name) return;
    const next = { ...flow, name: trimmed };
    saveFlowToList(next);
    onFlowUpdated(next);
  }, [flow, headerNameDraft, onFlowUpdated]);

  const pathScenarios: Scenario[] = useMemo(
    () =>
      scenarioPath
        .map((sid) => getScenarioById(sid))
        .filter((s): s is Scenario => s != null),
    [scenarioPath],
  );

  const combinedSteps: CombinedStep[] = useMemo(() => {
    const result: CombinedStep[] = [];
    let globalIdx = 0;
    for (const sc of pathScenarios) {
      for (const step of sc.steps) {
        result.push({
          scenarioId: sc.id,
          scenarioTitle: sc.title,
          step,
          globalIndex: globalIdx++,
        });
      }
    }
    return result;
  }, [pathScenarios]);

  const [stepStatuses, setStepStatuses] = useState<Record<string, StepStatus>>({});
  const [stepErrors, setStepErrors] = useState<Record<string, string>>({});
  const [currentStepIndex, setCurrentStepIndex] = useState(-1);
  const [isRunning, setIsRunning] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const cancelledRef = useRef(false);
  const stepRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const sendMessage = useCallback((msg: unknown): Promise<unknown> => {
    if (!isChromeExtension()) return Promise.resolve();
    try {
      return chrome.runtime.sendMessage(msg);
    } catch {
      return Promise.reject(new Error("Extension context invalidated"));
    }
  }, []);

  const handleRunnerStatus = useCallback((state: RunnerState) => {
    if (cancelledRef.current) return;

    setCurrentStepIndex(state.currentStepIndex);
    setLastError(state.error ?? null);

    const isActive = state.status === "running" || state.status === "paused";
    setIsRunning(state.status === "running");

    const currentScenario = pathScenarios.find((s) => s.id === state.scenarioId);
    if (!currentScenario) return;

    const newStatuses: Record<string, StepStatus> = { ...stepStatuses };
    const newStepErrors: Record<string, string> = { ...stepErrors };

    currentScenario.steps.forEach((step, i) => {
      const result = state.stepResults[i];
      if (result) {
        newStatuses[step.id] = result.status === "skipped" ? "todo" : result.status;
        if (result.status === "failed" && result.error) {
          newStepErrors[step.id] = result.error;
        }
      } else if (i === state.currentStepIndex && isActive) {
        newStatuses[step.id] = "running";
      }
    });

    setStepStatuses(newStatuses);
    setStepErrors(newStepErrors);
  }, [pathScenarios, stepStatuses, stepErrors]);

  useEffect(() => {
    if (!isChromeExtension()) return;
    const listener = (message: { type?: string; state?: RunnerState }) => {
      if (message.type === "RUNNER_STATUS" && message.state) {
        handleRunnerStatus(message.state);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => {
      try {
        chrome.runtime.onMessage.removeListener(listener);
      } catch {}
    };
  }, [handleRunnerStatus]);

  const handleStart = async () => {
    if (pathScenarios.length === 0) return;

    cancelledRef.current = false;
    setLastError(null);
    setStepStatuses({});
    setStepErrors({});
    setCurrentStepIndex(-1);

    if (!isChromeExtension()) return;

    const tabId = await getActiveTabId();
    if (!tabId) {
      alert(
        "실행할 탭을 찾을 수 없습니다. 개발자 도구에서 검사 중인 페이지가 있는지 확인해주세요.",
      );
      return;
    }

    const first = pathScenarios[0];
    try {
      await sendMessage({
        type: "RUN_SCENARIO",
        scenario: first,
        scenarios: pathScenarios,
        tabId,
        stepDelayMs: getStepDelayMs(),
        validationOnly: false,
        apiKey: getApiKey(),
        llmProvider: getLlmProvider(),
        llmConfig: readLlmRuntimeConfig(),
      });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "실행 시작에 실패했습니다.";
      alert(message);
    }
  };

  const handlePause = () => {
    sendMessage({ type: "PAUSE" });
    setIsRunning(false);
  };

  const handleResume = () => {
    cancelledRef.current = false;
    setIsRunning(true);
    sendMessage({ type: "RESUME" });
  };

  const handleCancel = () => {
    cancelledRef.current = true;
    sendMessage({ type: "CANCEL" });
    setIsRunning(false);
    setCurrentStepIndex(-1);
    setStepStatuses({});
    setStepErrors({});
  };

  const hasStarted = currentStepIndex >= 0 || Object.keys(stepStatuses).length > 0;
  const allDone = combinedSteps.length > 0 && combinedSteps.every(
    (cs) => stepStatuses[cs.step.id] === "success",
  );
  const hasFailed = combinedSteps.some(
    (cs) => stepStatuses[cs.step.id] === "failed",
  );
  const hasFinished = hasStarted && !isRunning && (lastError != null || allDone || hasFailed);

  return (
    <FlowScenariosContext.Provider value={scenarios}>
      <div className="flex flex-col min-h-0 flex-1 w-full h-full">
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-[var(--flux-border-light)] shrink-0 bg-white">
          <button
            type="button"
            onClick={() => navigate("/?tab=flows")}
            className="p-1 rounded hover:bg-[var(--flux-bg-subtle)] text-[var(--flux-text-muted)] hover:text-[var(--flux-text-default)] transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <GitBranch className="w-4 h-4 text-violet-500 shrink-0" />
          <input
            type="text"
            value={headerNameDraft}
            onChange={(e) => setHeaderNameDraft(e.target.value)}
            onBlur={commitFlowName}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            title="조합시나리오 이름 (저장: 포커스 해제 또는 Enter)"
            className="font-bold text-sm text-[var(--flux-text-default)] flex-1 min-w-0 bg-transparent border border-transparent rounded px-1 -mx-0.5 hover:border-[var(--flux-border-light)] focus:border-violet-400 focus:outline-none"
          />
        </div>

        <div className="flex-1 min-h-0 flex">
          <div className="w-80 shrink-0 relative border-r border-[var(--flux-border-light)]">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable={false}
              fitView
              fitViewOptions={{ padding: 0.3 }}
              proOptions={{ hideAttribution: true }}
            >
              <Background color="#e2e8f0" gap={16} />
              <Controls showInteractive={false} position="bottom-left" />
            </ReactFlow>
          </div>

          <div className="flex-1 min-w-0 flex flex-col bg-white relative">
            <div className="px-4 py-2.5 border-b border-[var(--flux-border-light)] bg-white">
              {isChromeExtension() && currentFullUrl && (
                <div className="text-[10px] text-gray-500">
                  실행 대상: <span className="font-medium text-gray-700">{currentFullUrl}</span>
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-4 pb-24 relative">
              {lastError && (
                <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">
                  <p className="font-semibold">실행 오류</p>
                  <p className="mt-1">{lastError}</p>
                </div>
              )}

              <div className="absolute left-6 top-4 bottom-4 w-0.5 bg-gray-100" />

              <div className="space-y-4 relative pl-1">
                {combinedSteps.map((cs, index) => {
                  const { step, scenarioTitle, globalIndex } = cs;
                  const status = stepStatuses[step.id] || "idle";
                  const actionDef = ACTION_REGISTRY[step.actionId];
                  const isMissing =
                    actionDef?.status === "missing" &&
                    !isActionImplemented(step.actionId);
                  const isActive = status === "running";
                  const showScenarioLabel =
                    index === 0 ||
                    combinedSteps[index - 1].scenarioId !== cs.scenarioId;

                  return (
                    <div key={`${cs.scenarioId}-${step.id}`}>
                      {showScenarioLabel && (
                        <div className="ml-8 mb-2 text-[10px] font-bold text-violet-600 bg-violet-50 px-2 py-1 rounded inline-block">
                          {scenarioTitle}
                        </div>
                      )}
                      <div
                        ref={(el) => {
                          if (el) stepRefs.current.set(globalIndex, el);
                          else stepRefs.current.delete(globalIndex);
                        }}
                        className={cn(
                          "relative pl-8 transition-all duration-300",
                          isActive
                            ? "opacity-100 scale-[1.01]"
                            : status === "idle"
                              ? "opacity-40 grayscale"
                              : "opacity-90",
                        )}
                      >
                        <div
                          className={cn(
                            "absolute left-0 top-1 w-5 h-5 rounded-full border-2 flex items-center justify-center z-10 transition-colors shadow-sm",
                            status === "success"
                              ? "border-green-500 bg-green-50 text-green-600"
                              : status === "running"
                                ? "border-[var(--flux-primary)] bg-[var(--flux-primary-muted)] text-[var(--flux-primary)] animate-pulse ring-4 ring-[var(--flux-primary-muted)]"
                                : status === "todo"
                                  ? "border-amber-500 bg-amber-50 text-amber-600"
                                  : status === "failed"
                                    ? "border-red-500 bg-red-50 text-red-600"
                                    : "border-gray-300 bg-white text-gray-300",
                          )}
                        >
                          {status === "success" && <Check className="w-3 h-3 stroke-[3]" />}
                          {status === "running" && <Loader2 className="w-3 h-3 animate-spin" />}
                          {status === "todo" && <AlertTriangle className="w-3 h-3" />}
                          {status === "failed" && <XCircle className="w-3 h-3" />}
                          {status === "idle" && <div className="w-1 h-1 bg-current rounded-full" />}
                        </div>

                        <div
                          className={cn(
                            "bg-white rounded-xl border p-3 transition-all shadow-sm",
                            status === "running"
                              ? "border-[var(--flux-primary)] ring-2 ring-[var(--flux-primary-muted)] shadow-md"
                              : status === "todo"
                                ? "border-amber-300 bg-amber-50/40"
                                : "border-gray-200",
                          )}
                        >
                          <div className="flex justify-between items-center mb-1">
                            <span className="text-[9px] font-mono font-bold text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded border border-gray-100">
                              Step {globalIndex + 1}
                            </span>
                            <span
                              className={cn(
                                "text-[9px] uppercase font-bold px-1.5 py-0.5 rounded tracking-wide",
                                isMissing
                                  ? "bg-amber-100 text-amber-700 border border-amber-200"
                                  : "bg-gray-100 text-gray-600 border border-gray-200",
                              )}
                            >
                              {actionDef?.name || step.actionId}
                            </span>
                          </div>

                          <p className="text-xs font-medium text-gray-800 leading-snug">
                            {step.description || actionDef?.description || "실행"}
                          </p>

                          {step.params && (
                            <div className="mt-2">
                              <div className="bg-gray-50 rounded-lg p-2 text-[9px] font-mono text-gray-500 border border-gray-100 overflow-x-auto whitespace-pre-wrap break-all">
                                {JSON.stringify(step.params, null, 2)
                                  .replace(/[{}"]/g, "")
                                  .trim()}
                              </div>
                            </div>
                          )}

                          {status === "failed" && stepErrors[step.id] && (
                            <div className="mt-2 p-2 rounded-lg bg-red-50 border border-red-100 text-[10px] text-red-700">
                              {stepErrors[step.id]}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}

                {combinedSteps.length === 0 && (
                  <div className="text-center py-8 text-[var(--flux-text-muted)] text-xs">
                    실행할 스텝이 없습니다. 플로우에 시나리오를 연결해주세요.
                  </div>
                )}
              </div>
            </div>

            <div className="absolute bottom-0 left-0 w-full bg-white/90 backdrop-blur-md border-t border-gray-200 p-3 pb-4 shadow-[0_-8px_16px_-4px_rgba(0,0,0,0.05)] z-30">
              <div className="flex items-center gap-2 max-w-lg mx-auto">
                {!isRunning ? (
                  hasFinished ? (
                    <button
                      type="button"
                      onClick={handleStart}
                      className="w-full py-2.5 rounded-xl font-medium text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98] border border-[var(--flux-primary)] text-[var(--flux-primary)] bg-transparent hover:bg-[var(--flux-primary-muted)]"
                    >
                      <Play className="w-4 h-4 fill-current" />
                      다시 실행
                    </button>
                  ) : !hasStarted ? (
                    <button
                      type="button"
                      onClick={handleStart}
                      disabled={combinedSteps.length === 0}
                      className="w-full py-2.5 rounded-xl font-medium text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98] border border-[var(--flux-primary)] text-[var(--flux-primary)] bg-transparent hover:bg-[var(--flux-primary-muted)] disabled:opacity-40"
                    >
                      <Play className="w-4 h-4 fill-current" />
                      시나리오 실행
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={handleResume}
                        className="flex-[2] py-2.5 rounded-xl font-medium text-sm flex items-center justify-center gap-2 border border-[var(--flux-primary)] text-[var(--flux-primary)] bg-transparent hover:bg-[var(--flux-primary-muted)]"
                      >
                        <Play className="w-4 h-4 fill-current" />
                        이어서 실행
                      </button>
                      <button
                        type="button"
                        onClick={handleCancel}
                        className="flex-1 py-2.5 rounded-xl font-medium text-sm border border-gray-200 text-gray-500 bg-transparent hover:bg-gray-50"
                      >
                        취소
                      </button>
                    </>
                  )
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={handlePause}
                      className="flex-[2] py-2.5 rounded-xl font-medium text-sm flex items-center justify-center gap-2 border border-[var(--flux-primary)] text-[var(--flux-primary)] bg-transparent hover:bg-[var(--flux-primary-muted)]"
                    >
                      <Pause className="w-4 h-4 fill-current" />
                      일시정지
                    </button>
                    <button
                      type="button"
                      onClick={handleCancel}
                      className="flex-1 py-2.5 rounded-xl font-medium text-sm border border-gray-200 text-gray-500 bg-transparent hover:bg-gray-50"
                    >
                      취소
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </FlowScenariosContext.Provider>
  );
}

export default function FlowDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [flow, setFlow] = useState<SerializedFlow | undefined>(() =>
    id ? getSavedFlowById(id) : undefined,
  );

  useEffect(() => {
    setFlow(id ? getSavedFlowById(id) : undefined);
  }, [id]);

  if (!flow) {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center flex-1 gap-3 text-[var(--flux-text-muted)]">
          <p className="text-sm">플로우를 찾을 수 없습니다.</p>
          <Button variant="outline" size="sm" onClick={() => navigate("/?tab=flows")}>
            <ChevronLeft className="w-3.5 h-3.5 mr-1" />
            목록으로
          </Button>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <ReactFlowProvider>
        <FlowDetailInner flow={flow} onFlowUpdated={setFlow} />
      </ReactFlowProvider>
    </Layout>
  );
}
