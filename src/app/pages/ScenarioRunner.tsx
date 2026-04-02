import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate, useLocation, useSearchParams } from "react-router";
import {
  Play,
  Pause,
  ChevronLeft,
  Check,
  AlertTriangle,
  XCircle,
  Loader2,
  Code2,
  Video,
  Square,
  SkipForward,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { ACTION_REGISTRY } from "../data";
import { Layout } from "../components/Layout";
import { getScenarioById, getScenarios, saveScenario } from "@/stores/scenarioStore";
import { buildScenarioRunChain } from "@/lib/scenarioChain";
import {
  getStepDelayPreset,
  setStepDelayPreset,
  getStepDelayMs,
  getApiKey,
  getLlmProvider,
  STEP_DELAY_PRESETS,
  type StepDelayPreset,
} from "@/stores/settingsStore";
import { isActionImplemented } from "@/actions";
import type { RunnerState } from "@/engine/runner";
import type { Scenario as ScenarioType } from "../data";
import { useInspectedTabUrl } from "@/hooks/useInspectedTabUrl";
import { getActiveTabId } from "@/hooks/useActiveTabId";
import { useRunButton } from "@/app/contexts/RunButtonContext";

type StepStatus = "idle" | "running" | "success" | "failed" | "todo";

function isChromeExtension(): boolean {
  return typeof chrome !== "undefined" && !!chrome.runtime?.sendMessage;
}

const EXTENSION_CONTEXT_INVALIDATED =
  "Extension context invalidated.";

function isContextInvalidated(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.message === EXTENSION_CONTEXT_INVALIDATED ||
      err.message.includes("Extension context invalidated"))
  );
}

function showContextInvalidatedAlert(): void {
  alert(
    "확장 프로그램이 새로고침된 것 같습니다.\n\n개발자 도구를 닫았다가 다시 열고, flux 탭을 다시 클릭해주세요.",
  );
}

export default function ScenarioRunner() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [scenario, setScenario] = useState(() =>
    id ? getScenarioById(id) : undefined,
  );

  const fromTab = (location.state as { fromTab?: string } | null)?.fromTab;
  const goBack = () =>
    navigate(fromTab != null ? `/?tab=${encodeURIComponent(fromTab)}` : "/");

  const handleTitleChange = (newTitle: string) => {
    if (!scenario || !newTitle.trim()) return;
    const updated = { ...scenario, title: newTitle.trim() };
    saveScenario(updated);
    setScenario(updated);
  };

  const [currentStepIndex, setCurrentStepIndex] = useState(-1);
  const [stepStatuses, setStepStatuses] = useState<Record<string, StepStatus>>(
    () => {
      if (!scenario) return {};
      const initial: Record<string, StepStatus> = {};
      scenario.steps.forEach((step) => {
        initial[step.id] = "idle";
      });
      return initial;
    },
  );
  const [isRunning, setIsRunning] = useState(false);
  const [contextInvalidated, setContextInvalidated] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [stepErrors, setStepErrors] = useState<Record<string, string>>({});
  const [speedPreset, setSpeedPreset] = useState<StepDelayPreset>(() =>
    getStepDelayPreset(),
  );
  const [validationOnly, setValidationOnly] = useState(false);
  const [displayScenario, setDisplayScenario] = useState(() =>
    id ? getScenarioById(id) : undefined,
  );
  const [chainMeta, setChainMeta] = useState<{ part: number; total: number } | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const cancelledRef = useRef(false);
  const runChainRef = useRef<ScenarioType[]>([]);
  const { currentFullUrl } = useInspectedTabUrl();
  const stepRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const { registerRun } = useRunButton();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const fromUrl = searchParams.get("validationOnly");
    if (fromUrl === "1" || fromUrl === "true") setValidationOnly(true);
  }, [searchParams]);

  useEffect(() => {
    if (!scenario) return;
    setDisplayScenario(scenario);
    setChainMeta(null);
  }, [scenario?.id]);

  const handleStartRef = useRef<(startFromIndex?: number) => void>(() => {});
  const didAutoStartValidation = useRef(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordedChunksRef = useRef<BlobPart[]>([]);

  const getInspectedTabId = useCallback(async (): Promise<number | null> => {
    return getActiveTabId();
  }, []);

  const downloadRecordedVideo = useCallback(
    (chunks: BlobPart[]) => {
      if (chunks.length === 0) return;
      const blob = new Blob(chunks, { type: "video/webm" });
      if (blob.size <= 0) return;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const safeTitle = scenario?.title?.replace(/[\\/:*?"<>|]/g, "_").trim() || "scenario";
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      anchor.href = url;
      anchor.download = `flux-${safeTitle}-${timestamp}.webm`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    [scenario?.title],
  );

  const stopRecording = useCallback(
    (download = true) => {
      const recorder = mediaRecorderRef.current;
      const stream = mediaStreamRef.current;
      if (recorder && recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {
          // ignore recorder stop errors
        }
      }
      if (stream) {
        stream.getTracks().forEach((track) => {
          try {
            track.stop();
          } catch {
            // ignore track stop errors
          }
        });
      }
      mediaRecorderRef.current = null;
      mediaStreamRef.current = null;
      if (download) downloadRecordedVideo(recordedChunksRef.current);
      recordedChunksRef.current = [];
      setIsRecording(false);
    },
    [downloadRecordedVideo],
  );

  const startRecording = useCallback(async () => {
    if (!isChromeExtension()) return;
    const tabId = await getInspectedTabId();
    if (!tabId) {
      alert("녹화할 탭을 찾을 수 없습니다.");
      return;
    }

    const resp = await chrome.runtime.sendMessage({
      type: "GET_TAB_CAPTURE_STREAM_ID",
      tabId,
    }) as { ok: boolean; streamId?: string; error?: string };
    if (!resp?.ok || !resp.streamId) {
      throw new Error(resp?.error || "탭 캡처 ID를 가져오지 못했습니다.");
    }
    const streamId = resp.streamId;

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: "tab",
          chromeMediaSourceId: streamId,
          maxWidth: 1920,
          maxHeight: 1080,
          maxFrameRate: 30,
        },
      } as any,
    });

    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
      ? "video/webm;codecs=vp9"
      : "video/webm";
    const recorder = new MediaRecorder(stream, { mimeType });
    recordedChunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        recordedChunksRef.current.push(event.data);
      }
    };
    recorder.start(1000);
    mediaRecorderRef.current = recorder;
    mediaStreamRef.current = stream;
    setIsRecording(true);
  }, [getInspectedTabId]);

  const handleToggleRecording = useCallback(async () => {
    try {
      if (isRecording) {
        stopRecording(true);
      } else {
        await startRecording();
      }
    } catch (err: any) {
      alert(err?.message ?? "녹화를 시작할 수 없습니다.");
      stopRecording(false);
    }
  }, [isRecording, startRecording, stopRecording]);

  const handleRunnerStatus = useCallback(
    (state: RunnerState) => {
      if (!scenario) return;
      if (cancelledRef.current) return;

      const chain = runChainRef.current;
      const active =
        chain.find((s) => s.id === state.scenarioId) ?? scenario;
      setDisplayScenario(active);
      if (state.chainPart != null && state.chainTotal != null) {
        setChainMeta({ part: state.chainPart, total: state.chainTotal });
      }

      setCurrentStepIndex(state.currentStepIndex);
      setLastError(state.error ?? null);

      const isActive = state.status === "running" || state.status === "paused";
      setIsRunning(state.status === "running");
      if ((state.status === "done" || state.status === "error") && isRecording) {
        stopRecording(true);
      }

      const newStatuses: Record<string, StepStatus> = {};
      const newStepErrors: Record<string, string> = {};
      active.steps.forEach((step, i) => {
        const result = state.stepResults[i];
        if (result) {
          newStatuses[step.id] =
            result.status === "skipped" ? "todo" : result.status;
          if (result.status === "failed" && result.error) {
            newStepErrors[step.id] = result.error;
          }
        } else if (i === state.currentStepIndex && isActive) {
          newStatuses[step.id] = "running";
        } else {
          newStatuses[step.id] = "idle";
        }
      });
      setStepStatuses(newStatuses);
      setStepErrors(newStepErrors);
    },
    [scenario, isRecording, stopRecording],
  );

  useEffect(() => {
    if (!isChromeExtension()) return;

    try {
      const listener = (message: any) => {
        if (message.type === "RUNNER_STATUS") {
          handleRunnerStatus(message.state);
        }
      };
      chrome.runtime.onMessage.addListener(listener);
      return () => {
        try {
          chrome.runtime.onMessage.removeListener(listener);
        } catch {
          // context invalidated during cleanup
        }
      };
    } catch (err) {
      if (isContextInvalidated(err)) setContextInvalidated(true);
    }
  }, [handleRunnerStatus]);

  const sendMessage = (msg: any): Promise<unknown> => {
    if (!isChromeExtension()) return Promise.resolve();
    try {
      return chrome.runtime.sendMessage(msg);
    } catch (err) {
      if (isContextInvalidated(err)) setContextInvalidated(true);
      return Promise.reject(err);
    }
  };

  const handleStart = async (startFromIndex?: number) => {
    if (!scenario) return;

    cancelledRef.current = false;
    setLastError(null);
    setStepErrors({});
    const chain = buildScenarioRunChain(scenario, getScenarioById);
    runChainRef.current = chain;
    setDisplayScenario(scenario);
    setChainMeta(
      chain.length > 1 ? { part: 1, total: chain.length } : null,
    );

    if (isChromeExtension()) {
      try {
        const tabId = await getInspectedTabId();
        if (!tabId) {
          alert("실행할 탭을 찾을 수 없습니다. 개발자 도구에서 검사 중인 페이지가 있는지 확인해주세요.");
          return;
        }
        await sendMessage({
          type: "RUN_SCENARIO",
          scenario,
          scenarios: chain.length > 1 ? chain : undefined,
          tabId,
          stepDelayMs: getStepDelayMs(),
          validationOnly,
          apiKey: getApiKey(),
          llmProvider: getLlmProvider(),
          startFromIndex,
        });
      } catch (err) {
        if (isContextInvalidated(err)) {
          showContextInvalidatedAlert();
          return;
        }
        throw err;
      }
    } else {
      runMockExecution();
    }
  };

  useEffect(() => {
    handleStartRef.current = handleStart;
  });

  useEffect(() => {
    if (!scenario) return;
    return registerRun(() => {
      handleStartRef.current?.();
    });
  }, [scenario, registerRun]);

  useEffect(() => {
    if (validationOnly && scenario && !didAutoStartValidation.current) {
      didAutoStartValidation.current = true;
      const t = setTimeout(() => handleStartRef.current?.(), 400);
      return () => clearTimeout(t);
    }
  }, [validationOnly, scenario]);

  useEffect(() => {
    if (currentStepIndex < 0) return;
    const el = stepRefs.current.get(currentStepIndex);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [currentStepIndex]);

  const handlePause = () => {
    if (isChromeExtension()) {
      sendMessage({ type: "PAUSE" });
    }
    setIsRunning(false);
  };

  const handleResume = () => {
    cancelledRef.current = false;
    setIsRunning(true);
    if (isChromeExtension()) {
      sendMessage({ type: "RESUME" }).catch((err) => {
        if (isContextInvalidated(err)) showContextInvalidatedAlert();
      });
    }
  };

  const handleReset = () => {
    cancelledRef.current = true;
    if (isChromeExtension()) {
      sendMessage({ type: "CANCEL" }).catch((err) => {
        if (isContextInvalidated(err)) showContextInvalidatedAlert();
      });
    }
    if (isRecording) stopRecording(true);
    setIsRunning(false);
    setCurrentStepIndex(-1);
    setLastError(null);
    setStepErrors({});
    setStepStatuses((prev) => {
      const reset = { ...prev };
      Object.keys(reset).forEach((k) => (reset[k] = "idle"));
      return reset;
    });
  };

  useEffect(() => {
    return () => {
      stopRecording(false);
    };
  }, [stopRecording]);

  const runMockExecution = () => {
    if (!scenario) return;
    setIsRunning(true);
    if (currentStepIndex === -1) setCurrentStepIndex(0);

    let stepIdx = currentStepIndex === -1 ? 0 : currentStepIndex;
    const MOCK_STEP_DURATION_MS = 1000;

    const runStep = () => {
      if (stepIdx >= scenario.steps.length) {
        setIsRunning(false);
        return;
      }

      const step = scenario.steps[stepIdx];
      const actionDef = ACTION_REGISTRY[step.actionId];
      setCurrentStepIndex(stepIdx);
      setStepStatuses((prev) => ({ ...prev, [step.id]: "running" }));

      const isImplemented = isActionImplemented(step.actionId);
      if (!isImplemented && actionDef?.status === "missing") {
        setIsRunning(false);
        setStepStatuses((prev) => ({ ...prev, [step.id]: "todo" }));
        return;
      }

      setTimeout(() => {
        setStepStatuses((prev) => ({ ...prev, [step.id]: "success" }));
        stepIdx++;
        runStep();
      }, MOCK_STEP_DURATION_MS);
    };

    runStep();
  };

  if (!scenario)
    return (
      <div className="p-4 text-center">시나리오를 찾을 수 없습니다.</div>
    );

  if (contextInvalidated)
    return (
      <div className="p-6 text-center text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg mx-4 mt-4">
        <p className="font-semibold mb-2">확장 컨텍스트가 만료되었습니다.</p>
        <p className="text-gray-600">
          개발자 도구를 닫았다가 다시 열고, flux 탭을 다시 클릭해주세요.
        </p>
      </div>
    );

  const stepsForUi = displayScenario?.steps ?? scenario.steps;
  const hasStarted = currentStepIndex >= 0;
  const lastStepId = stepsForUi[stepsForUi.length - 1]?.id;
  const lastStepStatus = lastStepId ? stepStatuses[lastStepId] : null;
  const hasFinished =
    hasStarted &&
    !isRunning &&
    (lastError != null ||
      lastStepStatus === "success" ||
      lastStepStatus === "failed");
  const canStartFromStep = hasFinished || (hasStarted && !isRunning);

  const handleRestart = () => {
    cancelledRef.current = false;
    setLastError(null);
    setStepErrors({});
    setCurrentStepIndex(-1);
    setDisplayScenario(scenario);
    setChainMeta(null);
    setStepStatuses((prev) => {
      const next: Record<string, StepStatus> = {};
      (scenario?.steps ?? []).forEach((step) => {
        next[step.id] = "idle";
      });
      return next;
    });
    handleStart();
  };

  return (
    <Layout>
      <div className="flex flex-col h-full bg-white relative">
        <div className="p-4 pt-3 border-b border-gray-100 bg-white sticky top-0 z-20 shadow-sm space-y-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => goBack()}
              className="p-1.5 hover:bg-gray-100 rounded-full transition-colors shrink-0"
              title="뒤로"
            >
              <ChevronLeft className="w-5 h-5 text-gray-500" />
            </button>
            <input
              type="text"
              defaultValue={scenario.title}
              onBlur={(e) => handleTitleChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
              className="font-bold text-gray-800 text-sm leading-tight bg-transparent outline-none flex-1 min-w-0 border-b border-transparent hover:border-[var(--flux-border)] focus:border-[var(--flux-primary)] transition-colors px-0 py-0.5 rounded-none"
              title="클릭하여 제목 수정"
            />
          </div>
          {chainMeta && chainMeta.total > 1 && (
            <div className="pl-9 text-[11px] text-violet-600 font-semibold">
              체인 {chainMeta.part}/{chainMeta.total} · {displayScenario?.title}
            </div>
          )}
          <div className="flex items-center gap-2 pl-9">
            {isRunning ? (
              <>
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse ring-2 ring-green-100" />
                <span className="text-xs text-gray-500">실행 중...</span>
              </>
            ) : (
              (["slow", "normal", "fast"] as const).map((preset) => {
                const label = { slow: "느리게", normal: "보통", fast: "빠르게" }[preset];
                const ms = STEP_DELAY_PRESETS[preset];
                const isActive = speedPreset === preset;
                return (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => {
                      setStepDelayPreset(preset);
                      setSpeedPreset(preset);
                    }}
                    className={cn(
                      "px-2 py-1 rounded border text-xs font-medium transition-colors",
                      isActive
                        ? "bg-[var(--flux-primary)] text-white border-[var(--flux-primary)]"
                        : "bg-white text-gray-500 border-gray-200 hover:border-[var(--flux-primary)] hover:text-[var(--flux-primary)]",
                    )}
                    title={`스텝 간격 ${ms}ms`}
                  >
                    {label}
                  </button>
                );
              })
            )}
          </div>
          {isChromeExtension() && currentFullUrl && (
            <div className="pl-9 text-[10px] text-gray-500">
              <span title="실행은 검사 중인 이 탭에서 이루어집니다.">
                실행 대상: <span className="font-medium text-gray-700">{currentFullUrl}</span>
              </span>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4 pb-24 relative">
          {lastError && (
            <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">
              <p className="font-semibold">실행 오류</p>
              <p className="mt-1">{lastError}</p>
              {lastError.includes("일반 웹페이지") && (
                <p className="mt-2 text-xs text-red-600">
                  개발자 도구를 열고, 주소창이 https:// 로 시작하는 일반 웹페이지 탭을 먼저 선택한 뒤 flux에서 실행해주세요.
                </p>
              )}
            </div>
          )}
          <div className="absolute left-6 top-4 bottom-4 w-0.5 bg-gray-100" />

          <div className="space-y-6 relative pl-1">
            {stepsForUi.map((step, index) => {
              const status = stepStatuses[step.id] || "idle";
              const actionDef = ACTION_REGISTRY[step.actionId];
              const isMissing =
                actionDef?.status === "missing" &&
                !isActionImplemented(step.actionId);
              const isActive = index === currentStepIndex;

              return (
                <div
                  key={step.id}
                  ref={(el) => {
                    if (el) stepRefs.current.set(index, el);
                    else stepRefs.current.delete(index);
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
                      "absolute left-0 top-1 w-6 h-6 rounded-full border-2 flex items-center justify-center z-10 transition-colors shadow-sm",
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
                    {status === "success" && (
                      <Check className="w-3.5 h-3.5 stroke-[3]" />
                    )}
                    {status === "running" && (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    )}
                    {status === "todo" && (
                      <AlertTriangle className="w-3.5 h-3.5" />
                    )}
                    {status === "failed" && (
                      <XCircle className="w-3.5 h-3.5" title={stepErrors[step.id]} />
                    )}
                    {status === "idle" && (
                      <div className="w-1.5 h-1.5 bg-current rounded-full" />
                    )}
                  </div>

                  <div
                    className={cn(
                      "bg-white rounded-xl border p-3.5 transition-all shadow-sm group",
                      status === "running"
                        ? "border-[var(--flux-primary)] ring-2 ring-[var(--flux-primary-muted)] shadow-md transform translate-x-1"
                        : status === "todo"
                          ? "border-amber-300 bg-amber-50/40"
                          : "border-gray-200 hover:border-gray-300",
                    )}
                  >
                    <div className="flex justify-between items-center mb-1.5">
                      <span className="text-[10px] font-mono font-bold text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded border border-gray-100">
                        Step {index + 1}
                      </span>
                      <span
                        className={cn(
                          "text-[10px] uppercase font-bold px-1.5 py-0.5 rounded tracking-wide",
                          isMissing
                            ? "bg-amber-100 text-amber-700 border border-amber-200"
                            : "bg-gray-100 text-gray-600 border border-gray-200",
                        )}
                      >
                        {actionDef?.name || step.actionId}
                      </span>
                    </div>

                    <p className="text-sm font-medium text-gray-800 leading-snug">
                      {step.description || actionDef?.description || "실행"}
                    </p>

                    {step.params && (
                      <div className="mt-2.5 space-y-1">
                        <div className="bg-gray-50 rounded-lg p-2 text-[10px] font-mono text-gray-500 border border-gray-100 overflow-x-auto whitespace-pre-wrap break-all">
                          {JSON.stringify(step.params, null, 2)
                            .replace(/[{}"]/g, "")
                            .trim()}
                        </div>
                      </div>
                    )}

                    {status === "failed" && stepErrors[step.id] && (
                      <div className="mt-3 p-2.5 rounded-lg bg-red-50 border border-red-100 text-xs text-red-700">
                        {stepErrors[step.id]}
                      </div>
                    )}

                    {status === "todo" && (
                      <div className="mt-3 pt-2 border-t border-amber-200/50 flex items-center justify-between animate-in fade-in zoom-in-95 duration-300">
                        <span className="text-xs text-amber-700 font-semibold flex items-center gap-1.5">
                          <AlertTriangle className="w-3.5 h-3.5" /> 구현 필요
                        </span>
                        <button className="text-[11px] bg-white border border-amber-300 hover:bg-amber-50 text-amber-800 px-2.5 py-1.5 rounded-lg transition-colors font-bold shadow-sm flex items-center gap-1">
                          <Code2 className="w-3 h-3" /> 코드 생성
                        </button>
                      </div>
                    )}

                    {canStartFromStep && (
                      <div className="mt-2 pt-2 border-t border-gray-100 flex justify-end">
                        <button
                          type="button"
                          onClick={() => handleStart(index)}
                          className="text-[11px] text-[var(--flux-primary)] hover:bg-[var(--flux-primary-muted)] px-2 py-1 rounded-md transition-colors font-medium flex items-center gap-1"
                        >
                          <SkipForward className="w-3 h-3" />
                          이 스텝부터 실행
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="absolute bottom-0 left-0 w-full bg-white/90 backdrop-blur-md border-t border-gray-200 p-4 pb-6 shadow-[0_-8px_16px_-4px_rgba(0,0,0,0.05)] z-30">
          <div className="flex items-center gap-3 max-w-xl mx-auto">
            {!isRunning ? (
              hasFinished ? (
                <button
                  type="button"
                  onClick={handleRestart}
                  className="w-full py-3 rounded-xl font-medium text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98] border border-[var(--flux-primary)] text-[var(--flux-primary)] bg-transparent hover:bg-[var(--flux-primary-muted)] hover:border-[var(--flux-primary-hover)]"
                >
                  <Play className="w-4 h-4 fill-current" />
                  다시 실행
                </button>
              ) : !hasStarted ? (
                <button
                  type="button"
                  onClick={() => handleStart()}
                  className="w-full py-3 rounded-xl font-medium text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98] border border-[var(--flux-primary)] text-[var(--flux-primary)] bg-transparent hover:bg-[var(--flux-primary-muted)] hover:border-[var(--flux-primary-hover)]"
                >
                  <Play className="w-4 h-4 fill-current" />
                  시나리오 실행
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={handleResume}
                    className="flex-[2] min-w-0 py-3 rounded-xl font-medium text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98] border border-[var(--flux-primary)] text-[var(--flux-primary)] bg-transparent hover:bg-[var(--flux-primary-muted)] hover:border-[var(--flux-primary-hover)]"
                  >
                    <Play className="w-4 h-4 fill-current" />
                    이어서 실행
                  </button>
                  <button
                    type="button"
                    onClick={handleReset}
                    className="flex-1 min-w-0 py-3 rounded-xl font-medium text-sm border border-[var(--flux-border)] text-[var(--flux-text-muted)] bg-transparent hover:bg-[var(--flux-bg-subtle)] hover:border-[var(--flux-code-border)] transition-all"
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
                  className="flex-[2] min-w-0 py-3 rounded-xl font-medium text-sm flex items-center justify-center gap-2 transition-all border border-[var(--flux-primary)] text-[var(--flux-primary)] bg-transparent hover:bg-[var(--flux-primary-muted)] hover:border-[var(--flux-primary-hover)]"
                >
                  <Pause className="w-4 h-4 fill-current" />
                  일시정지
                </button>
                <button
                  type="button"
                  onClick={handleReset}
                  className="flex-1 min-w-0 py-3 rounded-xl font-medium text-sm border border-[var(--flux-border)] text-[var(--flux-text-muted)] bg-transparent hover:bg-[var(--flux-bg-subtle)] hover:border-[var(--flux-code-border)] hover:text-[var(--flux-text-default)] transition-all"
                >
                  취소
                </button>
              </>
            )}
            <button
              type="button"
              onClick={handleToggleRecording}
              className={cn(
                "min-w-[104px] py-3 rounded-xl font-medium text-sm border transition-all flex items-center justify-center gap-1.5",
                isRecording
                  ? "border-red-300 text-red-600 bg-red-50 hover:bg-red-100"
                  : "border-[var(--flux-border)] text-[var(--flux-text-muted)] bg-transparent hover:bg-[var(--flux-bg-subtle)] hover:border-[var(--flux-code-border)]",
              )}
              title={isRecording ? "녹화 중지 후 파일 저장" : "검사 탭 화면 녹화 시작"}
            >
              {isRecording ? (
                <>
                  <Square className="w-3.5 h-3.5 fill-current" />
                  녹화중
                </>
              ) : (
                <>
                  <Video className="w-3.5 h-3.5" />
                  녹화
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </Layout>
  );
}
