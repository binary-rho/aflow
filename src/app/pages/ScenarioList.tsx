import React, { useState, useCallback, useEffect, useMemo } from "react";
import { useSearchParams, Link } from "react-router";
import {
  Globe,
  Search,
  Plus,
  FolderPlus,
  ChevronDown,
  Trash2,
  Loader2,
  GitBranch,
  MoreVertical,
} from "lucide-react";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import type { Scenario, ScenarioGroup } from "../data";
import { ScenarioCard } from "../components/ScenarioCard";
import { DraggableScenarioCard } from "../components/DraggableScenarioCard";
import { Layout } from "../components/Layout";
import { Section } from "../components/Section";
import { DrrInputBox } from "../components/DrrInputBox";
import { DrrResultView } from "../components/DrrResultView";
import { DrrThinkingView } from "../components/DrrThinkingView";
import { Button } from "../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import {
  getScenarios,
  getScenarioById,
  deleteScenario,
  saveScenario,
  reorderScenarios,
} from "@/stores/scenarioStore";
import { getGroups, createGroup, deleteGroup } from "@/stores/groupsStore";
import { generateDSL } from "@/services/llm";
import {
  getInspectedPageSummary,
  formatPageSummaryForLLM,
} from "@/services/domSnapshot";
import { getApiKey, getLlmProvider, readLlmRuntimeConfig } from "@/stores/settingsStore";
import { getActiveTabId } from "@/hooks/useActiveTabId";
import { buildScenarioRunChain } from "@/lib/scenarioChain";
import {
  getSavedFlowSummary,
  getSavedFlows,
  deleteFlowFromList,
  type SerializedFlow,
} from "@/stores/flowCompositionStore";
import { useInspectedTabUrl } from "@/hooks/useInspectedTabUrl";
import {
  scenarioMatchesInspectedHost,
  resolveUrlPatternFromDsl,
  normalizeScenarioHost,
} from "@/lib/scenarioHost";
import {
  normalizeUrlForCompare,
  getScenarioEffectiveUrl,
} from "@/services/urlMatch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/components/ui/select";

type TabId = "all" | "current" | string;

const TAB_PARAM = "tab";

function normalizeNavTarget(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";

  const withoutProtocol = trimmed.replace(/^https?:\/\//i, "");
  const slashIdx = withoutProtocol.indexOf("/");
  const looksLikeHostPath =
    slashIdx >= 0 && /\./.test(withoutProtocol.slice(0, slashIdx));

  if (looksLikeHostPath) {
    const pathWithQuery = withoutProtocol.slice(slashIdx);
    return pathWithQuery || "/";
  }

  return withoutProtocol.startsWith("/")
    ? withoutProtocol
    : `/${withoutProtocol}`;
}

export default function ScenarioList() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabFromUrl = searchParams.get(TAB_PARAM);

  const [scenarios, setScenarios] = useState<Scenario[]>(() => getScenarios());
  const [groups, setGroups] = useState<ScenarioGroup[]>(() => getGroups());
  const [savedFlows, setSavedFlows] = useState<SerializedFlow[]>(() =>
    getSavedFlows(),
  );
  const [activeTab, setActiveTabState] = useState<TabId>(
    () => tabFromUrl || "current",
  );
  const [searchTerm, setSearchTerm] = useState("");
  const [showAddToGroup, setShowAddToGroup] = useState(false);
  const [isCollectingScenario, setIsCollectingScenario] = useState(false);
  useEffect(() => {
    let t = tabFromUrl || "current";
    if (t === "domain") {
      t = "all";
      setSearchParams({ [TAB_PARAM]: "all" }, { replace: true });
    }
    setActiveTabState(t);
    if (tabFromUrl == null) {
      setSearchParams({ [TAB_PARAM]: "current" }, { replace: true });
    }
  }, [tabFromUrl, setSearchParams]);

  const setActiveTab = useCallback(
    (tab: TabId) => {
      setActiveTabState(tab);
      setSearchParams(tab === "current" ? {} : { [TAB_PARAM]: tab }, {
        replace: true,
      });
    },
    [setSearchParams],
  );

  const { currentDomain, currentFullUrl } = useInspectedTabUrl();

  /** 도메인 셀렉트로 이동을 요청한 직후, 폴링이 반영되기 전까지 쓰는 낙관적 도메인 */
  const [pendingDomain, setPendingDomain] = useState<string | null>(null);

  /** 목록 필터·셀렉트 표시의 기준 도메인 (이동 직후엔 pendingDomain 우선) */
  const effectiveDomain = pendingDomain ?? currentDomain;

  useEffect(() => {
    if (pendingDomain && normalizeScenarioHost(currentDomain) === pendingDomain) {
      setPendingDomain(null);
    }
  }, [currentDomain, pendingDomain]);

  const [drrInput, setDrrInput] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [drrResult, setDrrResult] = useState<string | null>(null);
  /** 변환 중 스트리밍되는 LLM 추론(reasoning) (입력창 자리에 실시간 표시) */
  const [streamingReasoning, setStreamingReasoning] = useState("");
  /** 진행 중인 변환 요청을 취소하기 위한 컨트롤러 */
  const analyzeAbortRef = React.useRef<AbortController | null>(null);

  /** 카드에서 '검증' 클릭 시 실행 페이지로 가지 않고 여기서 결과만 토스트로 표시 */
  const [validationToast, setValidationToast] = useState<{
    scenarioId: string;
    status: "done" | "error";
    successCount: number;
    totalSteps: number;
    failedStep?: number;
    error?: string;
  } | null>(null);
  const [validationProgress, setValidationProgress] = useState<{
    scenarioId: string;
    currentStep: number;
    totalSteps: number;
    status: "running" | "paused";
    currentStepLabel?: string;
  } | null>(null);
  const pendingValidationIdRef = React.useRef<string | null>(null);
  const pendingValidationScenarioRef = React.useRef<Scenario | null>(null);

  const handleRunValidation = useCallback(async (scenario: Scenario) => {
    const tabId = await getActiveTabId();
    if (!tabId) {
      alert(
        "활성 탭을 찾을 수 없습니다. 대상 페이지 탭을 선택한 뒤 다시 시도하세요.",
      );
      return;
    }
    pendingValidationIdRef.current = scenario.id;
    pendingValidationScenarioRef.current = scenario;
    setValidationProgress({
      scenarioId: scenario.id,
      currentStep: 0,
      totalSteps: scenario.steps.length,
      status: "running",
      currentStepLabel: "",
    });
    try {
      const chain = buildScenarioRunChain(scenario, getScenarioById);
      await chrome.runtime.sendMessage({
        type: "RUN_SCENARIO",
        scenario,
        scenarios: chain.length > 1 ? chain : undefined,
        tabId,
        stepDelayMs: 800,
        validationOnly: true,
        apiKey: getApiKey(),
        llmProvider: getLlmProvider(),
        llmConfig: readLlmRuntimeConfig(),
      });
    } catch (e) {
      pendingValidationIdRef.current = null;
      pendingValidationScenarioRef.current = null;
      setValidationProgress(null);
      setValidationToast({
        scenarioId: scenario.id,
        status: "error",
        successCount: 0,
        totalSteps: scenario.steps.length,
        failedStep: 1,
        error: e instanceof Error ? e.message : "실행 실패",
      });
      setTimeout(() => setValidationToast(null), 3000);
    }
  }, []);

  useEffect(() => {
    if (typeof chrome === "undefined" || !chrome.runtime?.onMessage) return;
    const listener = (message: {
      type?: string;
      state?: {
        scenarioId?: string;
        status?: string;
        currentStepIndex?: number;
        totalSteps?: number;
        stepResults?: { status: string }[];
        error?: string;
      };
    }) => {
      if (message.type !== "RUNNER_STATUS" || !message.state) return;
      const s = message.state;
      const id = pendingValidationIdRef.current;
      if (id == null || s.scenarioId !== id) return;
      if (s.status === "running" || s.status === "paused") {
        const runningScenario = pendingValidationScenarioRef.current;
        const totalSteps = s.totalSteps ?? runningScenario?.steps.length ?? 0;
        const currentStep = Math.max(0, (s.currentStepIndex ?? -1) + 1);
        const stepIndex = currentStep - 1;
        const currentStepLabel =
          stepIndex >= 0 && runningScenario?.steps?.[stepIndex]
            ? (
                runningScenario.steps[stepIndex].description ||
                runningScenario.steps[stepIndex].actionId ||
                ""
              ).trim()
            : "";
        setValidationProgress({
          scenarioId: id,
          currentStep,
          totalSteps,
          status: s.status,
          currentStepLabel,
        });
        return;
      }
      if (s.status !== "done" && s.status !== "error") return;
      pendingValidationIdRef.current = null;
      pendingValidationScenarioRef.current = null;
      setValidationProgress(null);
      const total = s.stepResults?.length ?? 0;
      const successCount =
        s.stepResults?.filter((r) => r.status === "success").length ?? 0;
      setValidationToast({
        scenarioId: id,
        status: s.status === "error" ? "error" : "done",
        successCount,
        totalSteps: total,
        failedStep:
          s.status === "error" && typeof s.currentStepIndex === "number"
            ? Math.max(1, s.currentStepIndex + 1)
            : undefined,
        error: s.error,
      });
      setTimeout(() => setValidationToast(null), 3000);
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => {
      try {
        chrome.runtime.onMessage.removeListener(listener);
      } catch {}
    };
  }, []);

  const refreshScenarios = useCallback(() => {
    setScenarios(getScenarios());
  }, []);

  const refreshGroups = useCallback(() => {
    setGroups(getGroups());
  }, []);

  /** 현재 검사 탭 호스트와 urlPattern이 맞는 시나리오 (「전체」 탭 목록) */
  const domainScenarios = scenarios.filter((s) =>
    scenarioMatchesInspectedHost(s.urlPattern, effectiveDomain),
  );

  /** 저장된 시나리오 호스트 ∪ 현재 도메인 (셀렉트 옵션) */
  const availableDomains = useMemo(() => {
    const set = new Set<string>();
    for (const s of scenarios) {
      const h = normalizeScenarioHost(s.urlPattern.split("/")[0]);
      if (h && h !== "localhost") set.add(h);
    }
    const cur = normalizeScenarioHost(effectiveDomain);
    if (cur && cur !== "localhost") set.add(cur);
    return Array.from(set).sort();
  }, [scenarios, effectiveDomain]);

  const handleSelectDomain = useCallback((host: string) => {
    setPendingDomain(normalizeScenarioHost(host));
    setActiveTab("all");
    try {
      chrome.runtime.sendMessage({
        type: "NAVIGATE_ACTIVE_TAB",
        url: `https://${host}/`,
      });
    } catch {}
  }, [setActiveTab]);

  const getFirstDepth = (fullUrl: string) => {
    const slashIdx = fullUrl.indexOf("/");
    if (slashIdx === -1) return fullUrl;
    const pathSegments = fullUrl
      .substring(slashIdx + 1)
      .split("/")
      .filter(Boolean);
    const host = fullUrl.substring(0, slashIdx);
    return host + "/" + (pathSegments[0] || "");
  };

  const currentPageScenarios = scenarios.filter((s) => {
    const scenarioUrl = getScenarioEffectiveUrl(s);
    const pattern = normalizeUrlForCompare(scenarioUrl);
    const current = normalizeUrlForCompare(currentFullUrl);
    return getFirstDepth(pattern) === getFirstDepth(current);
  });

  const listByTab: Scenario[] = (() => {
    if (activeTab === "all") return domainScenarios;
    if (activeTab === "current") return currentPageScenarios;
    return scenarios.filter(
      (s) =>
        s.groupIds?.includes(activeTab) || (s as any).groupId === activeTab,
    );
  })();

  const filteredList = searchTerm
    ? listByTab.filter(
        (s) =>
          s.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
          s.tags.some((t) =>
            t.toLowerCase().includes(searchTerm.toLowerCase()),
          ),
      )
    : listByTab;

  const savedFlowSummary = getSavedFlowSummary();

  const refreshFlows = useCallback(() => {
    setSavedFlows(getSavedFlows());
  }, []);

  const handleDeleteFlow = useCallback(
    (flowId: string) => {
      deleteFlowFromList(flowId);
      refreshFlows();
    },
    [refreshFlows],
  );

  const filteredFlows = searchTerm
    ? savedFlows.filter((f) =>
        f.name.toLowerCase().includes(searchTerm.toLowerCase()),
      )
    : savedFlows;

  const handleDeleteScenario = (id: string) => {
    deleteScenario(id);
    refreshScenarios();
  };

  const handleMoveScenario = useCallback(
    (fromIndex: number, toIndex: number) => {
      reorderScenarios(fromIndex, toIndex);
      setScenarios(getScenarios());
    },
    [],
  );

  const handleAddScenarioToGroup = useCallback(
    (scenarioId: string) => {
      if (activeTab === "all" || activeTab === "current") return;
      const s = scenarios.find((x) => x.id === scenarioId);
      if (!s) return;
      const prev =
        s.groupIds ?? ((s as any).groupId ? [(s as any).groupId] : []);
      if (prev.includes(activeTab)) return;
      saveScenario({ ...s, groupIds: [...prev, activeTab] });
      refreshScenarios();
      setShowAddToGroup(false);
    },
    [activeTab, scenarios],
  );

  const handleRemoveScenarioFromGroup = useCallback(
    (scenarioId: string, groupId: string) => {
      const s = scenarios.find((x) => x.id === scenarioId);
      if (!s) return;
      const prev =
        s.groupIds ?? ((s as any).groupId ? [(s as any).groupId] : []);
      const next = prev.filter((id) => id !== groupId);
      saveScenario({ ...s, groupIds: next });
      refreshScenarios();
    },
    [scenarios],
  );

  const handleAddGroup = () => {
    const name = prompt("그룹 이름을 입력하세요");
    if (name == null) return;
    const group = createGroup(name.trim() || "새 그룹");
    refreshGroups();
    setActiveTab(group.id);
  };

  const handleDeleteGroup = useCallback(
    (groupId: string) => {
      const g = groups.find((x) => x.id === groupId);
      if (!g) return;
      if (
        !confirm(
          `"${g.name}" 그룹을 삭제할까요?\n이 그룹에 속한 시나리오의 태그만 제거되고, 시나리오는 삭제되지 않습니다.`,
        )
      )
        return;
      deleteGroup(groupId);
      scenarios.forEach((s) => {
        const prev =
          s.groupIds ?? ((s as any).groupId ? [(s as any).groupId] : []);
        if (!prev.includes(groupId)) return;
        const next = prev.filter((id) => id !== groupId);
        saveScenario({ ...s, groupIds: next });
      });
      refreshScenarios();
      refreshGroups();
      setActiveTab("all");
    },
    [groups, scenarios],
  );

  const handleAnalyzeDRR = async () => {
    if (!drrInput.trim()) return;
    setIsAnalyzing(true);
    setStreamingReasoning("");
    const abortController = new AbortController();
    analyzeAbortRef.current = abortController;
    try {
      const apiKey = getApiKey();
      // 로컬 LLM은 키 없이 열린 서버가 많아 키를 필수로 요구하지 않는다.
      if (!apiKey && getLlmProvider() !== "local") {
        alert("설정에서 API 키를 먼저 입력해주세요.");
        return;
      }
      const currentPageSummary = await getInspectedPageSummary();
      const pageSummary = currentPageSummary
        ? `## 현재 페이지\n${formatPageSummaryForLLM(currentPageSummary)}`
        : null;
      const dsl = await generateDSL(drrInput, apiKey ?? "", {
        pageSummary,
        currentHost: currentDomain || undefined,
        onReasoning: (full) => setStreamingReasoning(full),
        signal: abortController.signal,
      });
      setDrrResult(JSON.stringify(dsl, null, 2));
    } catch (err: any) {
      // 사용자가 취소한 경우(AbortError)는 조용히 입력창으로 복귀한다.
      if (err?.name !== "AbortError") {
        alert(`변환 실패: ${err.message}`);
      }
    } finally {
      analyzeAbortRef.current = null;
      setIsAnalyzing(false);
      setStreamingReasoning("");
    }
  };

  const handleCancelAnalyze = () => {
    analyzeAbortRef.current?.abort();
  };

  const handleSaveDRR = () => {
    if (!drrResult) return;
    try {
      const dsl = JSON.parse(drrResult);
      const rawBase = (dsl.baseUrl || "").trim();
      const allSteps = [...(dsl.steps || []), ...(dsl.assertions || [])];
      const firstNav = allSteps.find(
        (x: { action?: string }) => x.action === "nav.goto",
      ) as { params?: Record<string, unknown> } | undefined;
      const firstNavRaw =
        firstNav?.params?.url != null ? String(firstNav.params.url) : "";
      const urlPattern = resolveUrlPatternFromDsl(
        rawBase,
        currentDomain,
        firstNavRaw || undefined,
      );
      /** nav.goto의 url에는 도메인을 제외한 상대 URL(path + query + hash)을 저장한다. */
      const steps = allSteps.map(
        (
          s: {
            action: string;
            params?: Record<string, unknown>;
            desc?: string;
          },
          i: number,
        ) => {
          const params = { ...s.params };
          if (s.action === "nav.goto") {
            let rawPath =
              params.path != null
                ? String(params.path).trim()
                : ((params.url as string)?.trim() ?? "");
            delete params.path;
            if (rawPath) {
              params.url = normalizeNavTarget(rawPath);
            }
          }
          return {
            id: `s${i + 1}`,
            actionId: s.action,
            params,
            description: s.desc,
          };
        },
      );
      const clarification =
        typeof dsl.drrClarification === "string"
          ? dsl.drrClarification.trim()
          : "";
      const scenario: Scenario = {
        id: `sc_${Date.now()}`,
        title: dsl.name || dsl.title || "새 시나리오",
        description: clarification || (dsl.description as string) || "",
        tags: [],
        urlPattern,
        steps,
        createdAt: new Date().toISOString().slice(0, 10),
      };
      saveScenario(scenario);
      refreshScenarios();
      setDrrResult(null);
      setDrrInput("");
    } catch {
      alert("DSL 파싱에 실패했습니다.");
    }
  };

  const handleManualCreate = () => {
    const run = async () => {
      const tabId = await getActiveTabId();
      if (!tabId) {
        alert("활성 탭을 찾을 수 없습니다.");
        return;
      }

      if (!isCollectingScenario) {
        const startRes = await chrome.runtime.sendMessage({
          type: "START_RECORDING",
          tabId,
        });
        if (!startRes?.ok) {
          alert(startRes?.error ?? "수집 시작에 실패했습니다.");
          return;
        }
        setIsCollectingScenario(true);
        return;
      }

      const stopRes = await chrome.runtime.sendMessage({
        type: "STOP_RECORDING",
        tabId,
      });
      if (!stopRes?.ok || !stopRes?.scenario) {
        alert(stopRes?.error ?? "수집 종료에 실패했습니다.");
        return;
      }
      saveScenario(stopRes.scenario);
      refreshScenarios();
      setIsCollectingScenario(false);
      setActiveTab("all");
      alert(
        `직접 생성 완료: ${stopRes.recordedCount ?? 0}개 동작으로 시나리오를 만들었습니다.`,
      );
    };
    run().catch((err: Error) => {
      alert(err?.message ?? "직접 생성 처리 중 오류가 발생했습니다.");
      setIsCollectingScenario(false);
    });
  };

  const activeGroup = groups.find((g) => g.id === activeTab);

  return (
    <Layout>
      {validationProgress && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2.5 rounded-lg shadow-lg border text-sm animate-in fade-in zoom-in-95 duration-200 bg-white max-w-[92vw] w-max">
          <Loader2 className="w-4 h-4 animate-spin text-[var(--flux-primary)]" />
          <span className="font-medium text-[var(--flux-text-default)] shrink-0">
            {Math.min(
              validationProgress.currentStep,
              validationProgress.totalSteps,
            )}
            /{validationProgress.totalSteps}
          </span>
          {validationProgress.currentStepLabel && (
            <span
              className="text-[var(--flux-text-muted)] truncate min-w-0 max-w-[56vw]"
              title={validationProgress.currentStepLabel}
            >
              {validationProgress.currentStepLabel}
            </span>
          )}
        </div>
      )}
      {validationToast && (
        <div
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-start gap-2 px-4 py-2.5 rounded-lg shadow-lg border text-sm animate-in fade-in zoom-in-95 duration-200 max-w-[92vw] w-max"
          style={{
            backgroundColor:
              validationToast.status === "done"
                ? "var(--flux-primary-muted)"
                : "#fef2f2",
            borderColor:
              validationToast.status === "done"
                ? "var(--flux-primary)"
                : "#fecaca",
            color:
              validationToast.status === "done"
                ? "var(--flux-primary)"
                : "#b91c1c",
          }}
        >
          {validationToast.status === "done" ? (
            <>
              <span className="font-medium whitespace-nowrap">검증 완료</span>
              <span>
                {validationToast.successCount}/{validationToast.totalSteps} 스텝
                성공
              </span>
            </>
          ) : (
            <>
              <span className="font-medium whitespace-nowrap">검증 실패</span>
              <span className="break-words">
                {validationToast.error ??
                  `${validationToast.failedStep ?? validationToast.successCount + 1}단계에서 실패 (${validationToast.successCount}/${validationToast.totalSteps})`}
              </span>
            </>
          )}
        </div>
      )}
      <DndProvider backend={HTML5Backend}>
        <div className="flex flex-col min-h-0 flex-1 w-full max-w-full h-full pb-safe px-0">
          <div className="bg-white/95 backdrop-blur-md border-b border-[var(--flux-border-light)] px-3 py-2.5 flex items-center gap-2 text-xs text-[var(--flux-text-muted)] shrink-0 z-30 transition-all mb-1 shadow-sm min-w-0">
            <Globe className="w-3.5 h-3.5 text-[var(--flux-primary)] shrink-0" />
            <Select
              value={normalizeScenarioHost(effectiveDomain)}
              onValueChange={handleSelectDomain}
            >
              <SelectTrigger
                className="h-auto min-w-0 flex-1 border-0 bg-transparent p-0 shadow-none text-[var(--flux-text-default)] font-mono text-xs font-medium focus:ring-0"
                title="로컬에 저장된 사이트로 이동"
              >
                <SelectValue className="truncate" placeholder={effectiveDomain || "도메인 선택"} />
              </SelectTrigger>
              <SelectContent>
                {availableDomains.map((host) => (
                  <SelectItem key={host} value={host} className="font-mono text-xs">
                    {host}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Section
            title="새 시나리오"
            icon={Plus}
            defaultOpen={true}
            headerAction={
              <button
                type="button"
                onClick={handleManualCreate}
                className={`inline-flex items-center gap-1 text-[11px] font-bold rounded active:scale-95 transition-colors px-2 py-1 border ${
                  isCollectingScenario
                    ? "text-red-600 bg-red-50 border-red-200 hover:bg-red-100 hover:border-red-300"
                    : "text-[var(--flux-text-muted)] hover:text-[var(--flux-primary)] bg-[var(--flux-bg-subtle)] hover:bg-[var(--flux-primary-muted)] border-[var(--flux-border)] hover:border-pink-200"
                }`}
                title={
                  isCollectingScenario
                    ? "수집 중입니다. 클릭하면 종료 후 시나리오를 생성합니다."
                    : "직접 생성 시작"
                }
              >
                {isCollectingScenario ? "기록 중..." : "직접 생성"}
              </button>
            }
          >
            <div className="flex flex-col gap-0">
              {(() => {
                if (drrResult) {
                  return (
                    <DrrResultView
                      result={drrResult}
                      onCancel={() => setDrrResult(null)}
                      onSave={handleSaveDRR}
                    />
                  );
                }
                if (isAnalyzing) {
                  return (
                    <DrrThinkingView
                      text={streamingReasoning}
                      onCancel={handleCancelAnalyze}
                    />
                  );
                }
                return (
                  <DrrInputBox
                    value={drrInput}
                    onChange={setDrrInput}
                    onConvert={handleAnalyzeDRR}
                    isAnalyzing={isAnalyzing}
                  />
                );
              })()}
            </div>
          </Section>

          <Section
            title="시나리오 목록"
            icon={Globe}
            count={listByTab.length}
            defaultOpen={true}
            fillRemaining
            headerAction={
              <Link
                to="/flow"
                className="inline-flex items-center gap-1 text-[11px] font-bold rounded active:scale-95 text-[var(--flux-text-muted)] hover:text-[var(--flux-primary)] bg-[var(--flux-bg-subtle)] hover:bg-[var(--flux-primary-muted)] border border-[var(--flux-border)] hover:border-pink-200 transition-colors px-2 py-1"
              >
                시나리오 조합
              </Link>
            }
          >
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setActiveTab("all")}
                  title={`검사 중 탭과 urlPattern이 맞는 시나리오 (${effectiveDomain || "…"})`}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-colors border ${
                    activeTab === "all"
                      ? "bg-[var(--flux-primary)] text-white border-[var(--flux-primary)]"
                      : "bg-white text-[var(--flux-text-muted)] border-[var(--flux-border)] hover:border-[var(--flux-primary)] hover:text-[var(--flux-primary)]"
                  }`}
                >
                  전체
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("current")}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-colors border ${
                    activeTab === "current"
                      ? "bg-[var(--flux-primary)] text-white border-[var(--flux-primary)]"
                      : "bg-white text-[var(--flux-text-muted)] border-[var(--flux-border)] hover:border-[var(--flux-primary)] hover:text-[var(--flux-primary)]"
                  }`}
                >
                  현재 페이지
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("flows")}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-colors border ${
                    activeTab === "flows"
                      ? "bg-[var(--flux-primary)] text-white border-[var(--flux-primary)]"
                      : "bg-white text-[var(--flux-text-muted)] border-[var(--flux-border)] hover:border-[var(--flux-primary)] hover:text-[var(--flux-primary)]"
                  }`}
                >
                  조합시나리오
                </button>
                {groups.map((g) => (
                  <div
                    key={g.id}
                    className="group/grp flex items-center gap-0.5 overflow-hidden"
                  >
                    <button
                      type="button"
                      onClick={() => setActiveTab(g.id)}
                      className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-colors border ${
                        activeTab === g.id
                          ? "bg-[var(--flux-primary)] text-white border-[var(--flux-primary)]"
                          : "bg-white text-[var(--flux-text-muted)] border-[var(--flux-border)] hover:border-[var(--flux-primary)] hover:text-[var(--flux-primary)]"
                      }`}
                    >
                      {g.name}
                    </button>
                    {activeTab === g.id && (
                      <button
                        type="button"
                        onClick={() => handleDeleteGroup(g.id)}
                        className="shrink-0 w-0 p-0 overflow-hidden opacity-0 group-hover/grp:w-auto group-hover/grp:opacity-100 group-hover/grp:p-1 rounded text-[var(--flux-text-muted)] hover:text-red-600 hover:bg-red-50 transition-all duration-150"
                        title="그룹 삭제"
                        aria-label="그룹 삭제"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={handleAddGroup}
                  className="px-2.5 py-1 rounded-md text-[11px] font-bold text-[var(--flux-text-muted)] border border-dashed border-[var(--flux-border)] hover:border-[var(--flux-primary)] hover:text-[var(--flux-primary)] transition-colors flex items-center gap-1"
                  title="그룹 추가"
                >
                  <FolderPlus className="w-3 h-3" /> 그룹
                </button>
              </div>

              <div className="relative group">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--flux-text-muted)] group-focus-within:text-[var(--flux-primary)] transition-colors" />
                <input
                  type="text"
                  placeholder={
                    activeTab === "flows"
                      ? "조합시나리오 이름 검색..."
                      : "제목, 태그 검색..."
                  }
                  className="w-full pl-9 pr-3 py-2 bg-[var(--flux-bg-subtle)] border border-[var(--flux-border)] focus:bg-white focus:border-[var(--flux-primary)] focus:ring-2 focus:ring-[var(--flux-ring)] rounded-lg text-xs transition-all outline-none placeholder:text-[var(--flux-text-muted)]"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>

              {activeGroup && activeTab !== "flows" && (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowAddToGroup((v) => !v)}
                    className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-dashed border-[var(--flux-border)] text-[var(--flux-text-muted)] hover:border-[var(--flux-primary)] hover:text-[var(--flux-primary)] text-xs font-bold transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    시나리오 추가
                    <ChevronDown
                      className={`w-3.5 h-3.5 transition-transform ${showAddToGroup ? "rotate-180" : ""}`}
                    />
                  </button>
                  {showAddToGroup && (
                    <div className="mt-1 p-2 bg-white border border-[var(--flux-border)] rounded-lg shadow-lg max-h-40 overflow-y-auto space-y-1">
                      {domainScenarios
                        .filter(
                          (s) =>
                            !s.groupIds?.includes(activeTab) &&
                            (s as any).groupId !== activeTab,
                        )
                        .map((s) => (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => handleAddScenarioToGroup(s.id)}
                            className="w-full text-left px-2 py-1.5 rounded text-xs text-[var(--flux-text-default)] hover:bg-[var(--flux-primary-muted)] truncate"
                          >
                            {s.title}
                          </button>
                        ))}
                      {domainScenarios.filter(
                        (s) =>
                          !s.groupIds?.includes(activeTab) &&
                          (s as any).groupId !== activeTab,
                      ).length === 0 && (
                        <p className="text-[10px] text-[var(--flux-text-muted)] px-2 py-1">
                          넣을 수 있는 시나리오가 없습니다.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {activeTab === "flows" ? (
                <div className="space-y-2">
                  {filteredFlows.length > 0 ? (
                    filteredFlows.map((flow) => (
                      <Link
                        key={flow.id}
                        to={`/flow/${flow.id}`}
                        className="block relative bg-white rounded-lg border border-[var(--flux-border-light)] hover:border-[var(--flux-primary)] transition-all p-3 shadow-[0_2px_8px_-4px_rgba(0,0,0,0.05)] hover:shadow-md group"
                      >
                        <div className="absolute right-2 top-2 z-10">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                type="button"
                                onClick={(e) => e.preventDefault()}
                                onPointerDown={(e) => e.stopPropagation()}
                                className="w-7 h-7 flex items-center justify-center rounded text-[var(--flux-text-muted)] hover:text-[var(--flux-primary)] hover:bg-[var(--flux-primary-muted)] transition-colors"
                                title="메뉴"
                                aria-label="메뉴"
                              >
                                <MoreVertical className="w-3.5 h-3.5 stroke-[2.5]" />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent
                              align="end"
                              onClick={(e) => e.stopPropagation()}
                              className="text-xs min-w-[8rem]"
                            >
                              <DropdownMenuItem
                                variant="destructive"
                                className="text-xs py-1.5"
                                onSelect={(e) => {
                                  e.preventDefault();
                                  if (
                                    !confirm(
                                      `"${flow.name}" 플로우를 삭제할까요?`,
                                    )
                                  )
                                    return;
                                  handleDeleteFlow(flow.id!);
                                }}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                플로우 삭제
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>

                        <h3
                          className="font-semibold text-[var(--flux-text-default)] text-sm leading-snug truncate pr-10"
                          title={flow.name}
                        >
                          {flow.name}
                        </h3>

                        <div className="flex items-center gap-1.5 min-w-0 text-[11px] text-[var(--flux-text-muted)] font-mono mt-1 mb-2 group-hover:text-gray-600 transition-colors">
                          <Globe className="w-3 h-3 shrink-0" />
                          <span className="truncate min-w-0">
                            노드 {flow.nodes.length}개 · 연결{" "}
                            {flow.edges.length}개
                          </span>
                        </div>

                        <div className="flex flex-wrap gap-1.5 mt-2 pt-2 border-t border-[var(--flux-border-light)]">
                          <span className="text-[10px] text-[var(--flux-text-muted)] bg-[var(--flux-bg-subtle)] px-1.5 py-0.5 rounded border border-[var(--flux-border-light)] group-hover:bg-[var(--flux-primary-muted)] group-hover:text-[var(--flux-primary)] transition-colors">
                            플로우
                          </span>
                          {flow.createdAt && (
                            <span className="text-[10px] text-[var(--flux-text-muted)] bg-[var(--flux-bg-subtle)] px-1.5 py-0.5 rounded border border-[var(--flux-border-light)]">
                              {flow.createdAt}
                            </span>
                          )}
                        </div>
                      </Link>
                    ))
                  ) : (
                    <div className="text-center py-8 text-[var(--flux-text-muted)] text-xs flex flex-col items-center gap-1.5 opacity-60">
                      <Search className="w-5 h-5 mb-0.5 opacity-50" />
                      <span className="whitespace-pre-line">
                        {searchTerm
                          ? "검색 결과가 없습니다."
                          : "저장된 조합시나리오가 없습니다.\n우측 상단 '시나리오 조합'을 눌러 시나리오를 조합해보세요."}
                      </span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredList.length > 0 ? (
                    filteredList.map((scenario) =>
                      searchTerm ? (
                        <ScenarioCard
                          key={scenario.id}
                          scenario={scenario}
                          onDelete={handleDeleteScenario}
                          onRemoveFromGroup={handleRemoveScenarioFromGroup}
                          onRunValidation={handleRunValidation}
                          groups={groups}
                          activeGroupId={
                            activeTab !== "all" && activeTab !== "current"
                              ? activeTab
                              : null
                          }
                          linkState={{ fromTab: activeTab }}
                          validationProgress={
                            validationProgress?.scenarioId === scenario.id
                              ? validationProgress
                              : null
                          }
                        />
                      ) : (
                        <DraggableScenarioCard
                          key={scenario.id}
                          scenario={scenario}
                          index={scenarios.indexOf(scenario)}
                          onDelete={handleDeleteScenario}
                          onMove={handleMoveScenario}
                          onRemoveFromGroup={handleRemoveScenarioFromGroup}
                          onRunValidation={handleRunValidation}
                          groups={groups}
                          activeGroupId={
                            activeTab !== "all" && activeTab !== "current"
                              ? activeTab
                              : null
                          }
                          linkState={{ fromTab: activeTab }}
                          validationProgress={
                            validationProgress?.scenarioId === scenario.id
                              ? validationProgress
                              : null
                          }
                        />
                      ),
                    )
                  ) : (
                    <div className="text-center py-8 text-[var(--flux-text-muted)] text-xs flex flex-col items-center gap-1.5 opacity-60">
                      <Search className="w-5 h-5 mb-0.5 opacity-50" />
                      <span className="whitespace-pre-line">
                        {searchTerm
                          ? "검색 결과가 없습니다."
                          : activeTab === "current"
                            ? "이 페이지에 저장된 시나리오가 없습니다."
                            : activeTab === "all"
                              ? "현재 도메인에 저장된 시나리오가 없습니다."
                              : activeGroup
                                ? `"${activeGroup.name}" 그룹에 시나리오가 없습니다.\n위에서 시나리오 추가로 넣어보세요.`
                                : "시나리오가 없습니다."}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </Section>

          <div className="h-6" />
        </div>
      </DndProvider>
    </Layout>
  );
}
