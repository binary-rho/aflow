import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useSearchParams } from "react-router";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  Panel,
  useNodesState,
  useEdgesState,
  addEdge,
  useReactFlow,
  type Connection,
  type Edge,
  type NodeTypes,
} from "@xyflow/react";
import type { Node as RFNode } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ChevronLeft, GitBranch, Link2 } from "lucide-react";
import { Toaster, toast } from "sonner";
import { Layout } from "../components/Layout";
import {
  FlowScenariosContext,
  FlowScenarioNode,
} from "../components/flow/ScenarioFlowNodes";
import {
  getScenarios,
  saveScenario,
  getScenarioById,
} from "@/stores/scenarioStore";
import {
  loadSerializedFlow,
  saveSerializedFlow,
  saveFlowToList,
  DEFAULT_SERIALIZED_FLOW,
  FLOW_DEFAULT_NAME,
  type SerializedFlow,
} from "@/stores/flowCompositionStore";
import { useInspectedTabUrl } from "@/hooks/useInspectedTabUrl";
import { scenarioMatchesInspectedHost } from "@/lib/scenarioHost";
import {
  deriveDefaultFlowName,
  extractLinearScenarioOrderedIds,
} from "@/lib/flowLinearPath";
import { layoutScenarioSiblingsUnderParents } from "../components/flow/flowSiblingLayout";

const SCENARIO_SCOPE_KEY = "flux_flow_scenario_scope";

type ScenarioScope = "all" | "domain";

const CHAIN_GUARD_MAX = 32;

const EDGE_STYLE: React.CSSProperties = {
  stroke: "#94a3b8",
  strokeWidth: 1.75,
  strokeDasharray: "5 5",
};

function wouldCreateCycle(
  fromScenarioId: string,
  toScenarioId: string,
): boolean {
  let cur: string | undefined = toScenarioId;
  const seen = new Set<string>();
  while (cur && seen.size < CHAIN_GUARD_MAX) {
    if (cur === fromScenarioId) return true;
    if (seen.has(cur)) break;
    seen.add(cur);
    cur = getScenarioById(cur)?.followUpScenarioId?.trim();
  }
  return false;
}

function toReactNodes(flow: SerializedFlow): RFNode[] {
  return flow.nodes.map((n) => ({
    id: n.id,
    type: n.type,
    position: n.position,
    data: { ...n.data },
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

function FlowCanvasInner({
  startUrl,
  onStartUrlChange,
  flowName,
  setFlowName,
  flowNameUserLocked,
  setFlowNameUserLocked,
  onRegisterSave,
}: {
  startUrl: string;
  onStartUrlChange: (v: string) => void;
  flowName: string;
  setFlowName: (v: string) => void;
  flowNameUserLocked: boolean;
  setFlowNameUserLocked: (v: boolean) => void;
  onRegisterSave: (save: (() => void) | null) => void;
}) {
  const initialFlow = useMemo(
    () => loadSerializedFlow() ?? DEFAULT_SERIALIZED_FLOW,
    [],
  );
  const [nodes, setNodes, onNodesChange] = useNodesState(
    toReactNodes(initialFlow),
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState(
    toReactEdges(initialFlow),
  );
  const { fitView, getNodes } = useReactFlow();
  const [searchParams] = useSearchParams();
  const focusScenarioId = searchParams.get("focus") ?? undefined;

  useEffect(() => {
    const t = window.setTimeout(() => fitView({ padding: 0.2 }), 120);
    return () => clearTimeout(t);
  }, [fitView]);

  useEffect(() => {
    if (!focusScenarioId) return;
    setNodes((nds) =>
      nds.map((n) => {
        if (n.type !== "flowScenario") return { ...n, selected: false };
        const sid = String((n.data as { scenarioId?: string }).scenarioId ?? "");
        return { ...n, selected: sid === focusScenarioId };
      }),
    );
  }, [focusScenarioId, setNodes]);

  const onConnect = useCallback(
    (p: Connection) =>
      setEdges((eds) =>
        addEdge(
          {
            ...p,
            style: { ...EDGE_STYLE },
          },
          eds,
        ),
      ),
    [setEdges],
  );

  const flowIdRef = useRef<string | undefined>(
    loadSerializedFlow()?.id,
  );

  const handlePersistLayout = useCallback(() => {
    const flowId = flowIdRef.current || `flow_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    flowIdRef.current = flowId;

    const f: SerializedFlow = {
      id: flowId,
      version: 1,
      name: flowName.trim() || FLOW_DEFAULT_NAME,
      startUrl: startUrl.trim(),
      nodes: getNodes().map((n) => ({
        id: n.id,
        type: n.type ?? "flowScenario",
        position: { ...n.position },
        data: { ...(n.data as Record<string, unknown>) },
      })),
      edges: edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
      })),
    };
    saveSerializedFlow(f);
    saveFlowToList(f);
    toast.success("플로우 저장됨 · 목록에 추가됨");
  }, [flowName, startUrl, getNodes, edges]);

  useEffect(() => {
    onRegisterSave(() => handlePersistLayout());
    return () => onRegisterSave(null);
  }, [onRegisterSave, handlePersistLayout]);

  useLayoutEffect(() => {
    setNodes((prev) => layoutScenarioSiblingsUnderParents(prev, edges));
  }, [edges, setNodes]);

  const linearScenarioIds = useMemo(
    () =>
      extractLinearScenarioOrderedIds(
        nodes.map((n) => ({
          id: n.id,
          type: n.type ?? "flowScenario",
          position: { x: n.position.x, y: n.position.y },
          data: { ...(n.data as Record<string, unknown>) },
        })),
        edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
        })),
      ),
    [nodes, edges],
  );

  useEffect(() => {
    if (flowNameUserLocked) return;
    setFlowName(deriveDefaultFlowName(linearScenarioIds, getScenarioById));
  }, [linearScenarioIds, flowNameUserLocked, setFlowName]);

  const applyFollowUpsFromEdges = useCallback(() => {
    const byId = new Map(getNodes().map((n) => [n.id, n]));
    const scenarioEdges = edges.filter((e) => {
      const a = byId.get(e.source);
      const b = byId.get(e.target);
      return a?.type === "flowScenario" && b?.type === "flowScenario";
    });
    const bySource = new Map<string, Edge[]>();
    for (const e of scenarioEdges) {
      const src = byId.get(e.source);
      if (!src || src.type !== "flowScenario") continue;
      const fromSid = String(
        (src.data as { scenarioId?: string }).scenarioId ?? "",
      ).trim();
      if (!fromSid) continue;
      if (!bySource.has(e.source)) bySource.set(e.source, []);
      bySource.get(e.source)!.push(e);
    }
    let applied = 0;
    let branchSkipped = 0;
    for (const [, outs] of bySource) {
      outs.sort((a, b) => a.id.localeCompare(b.id));
      const srcNode = byId.get(outs[0].source)!;
      const fromSid = String(
        (srcNode.data as { scenarioId?: string }).scenarioId ?? "",
      ).trim();
      if (!fromSid) continue;
      const targets = outs
        .map((e) => byId.get(e.target))
        .filter((n): n is RFNode => n != null && n.type === "flowScenario")
        .map((n) =>
          String((n.data as { scenarioId?: string }).scenarioId ?? "").trim(),
        )
        .filter(Boolean);
      if (targets.length === 0) continue;
      if (targets.length > 1) branchSkipped += 1;
      const toSid = targets[0];
      if (wouldCreateCycle(fromSid, toSid)) {
        toast.error(`순환: "${getScenarioById(fromSid)?.title ?? fromSid}" 연결 건너뜀`);
        continue;
      }
      const s = getScenarioById(fromSid);
      if (s) {
        saveScenario({ ...s, followUpScenarioId: toSid });
        applied += 1;
      }
    }
    if (applied > 0) {
      toast.success(
        `시나리오 후속 연결 ${applied}곳 반영됨` +
          (branchSkipped > 0
            ? ` · 분기 ${branchSkipped}곳은 첫 연결만 반영`
            : ""),
      );
    } else {
      toast.message("반영할 연결이 없습니다. 노드에 시나리오를 고르고 선으로 이어주세요.");
    }
  }, [edges, getNodes]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "SELECT" ||
        target.tagName === "TEXTAREA"
      )
        return;
      const sel = getNodes().filter((n) => n.selected && n.id !== "start");
      if (sel.length === 0) return;
      e.preventDefault();
      const remove = new Set(sel.map((n) => n.id));
      setNodes((nds) => nds.filter((n) => !remove.has(n.id)));
      setEdges((eds) =>
        eds.filter((e) => !remove.has(e.source) && !remove.has(e.target)),
      );
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [getNodes, setNodes, setEdges]);

  return (
    <div className="flex-1 min-h-0 w-full h-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.35}
        maxZoom={1.35}
        defaultEdgeOptions={{ style: EDGE_STYLE }}
        proOptions={{ hideAttribution: true }}
        className="bg-slate-50"
      >
        <Background gap={14} size={1} color="#cbd5e1" />
        <Controls
          className="!shadow-md !border !border-[var(--flux-border)] !rounded-lg overflow-hidden"
          showInteractive={false}
        />
        <MiniMap
          nodeStrokeWidth={2}
          zoomable
          pannable
          className="!rounded-lg !border !border-[var(--flux-border)] !bg-white/90"
          maskColor="rgba(148, 163, 184, 0.12)"
        />
        <Panel
          position="top-left"
          className="m-2 flex flex-col gap-2 max-w-[min(100%,360px)]"
        >
          <div className="rounded-xl border border-[var(--flux-border)] bg-white/95 backdrop-blur shadow-sm p-3 space-y-2">
            <label className="text-[10px] font-bold text-[var(--flux-text-muted)] uppercase tracking-wide">
              테스트 시작 URL (참고용)
            </label>
            <input
              type="url"
              value={startUrl}
              onChange={(e) => onStartUrlChange(e.target.value)}
              placeholder="https://"
              className="w-full text-xs border border-[var(--flux-border)] rounded-lg px-2.5 py-2 outline-none focus:border-[var(--flux-primary)]"
            />
            <label className="text-[10px] font-bold text-[var(--flux-text-muted)]">
              조합시나리오 이름
            </label>
            <input
              type="text"
              value={flowName}
              onChange={(e) => {
                setFlowNameUserLocked(true);
                setFlowName(e.target.value);
              }}
              className="w-full text-xs border border-[var(--flux-border)] rounded-lg px-2.5 py-2 outline-none focus:border-[var(--flux-primary)]"
            />
            <p className="text-[9px] text-[var(--flux-text-muted)] leading-snug">
              이름을 직접 수정하면 그래프를 바꿔도 자동 제목이 갱신되지 않습니다.
            </p>
          </div>
        </Panel>
        <Panel
          position="top-right"
          className="m-2 flex flex-col gap-2 items-end"
        >
          <button
            type="button"
            onClick={applyFollowUpsFromEdges}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-violet-300 bg-violet-50 text-violet-800 text-[11px] font-bold hover:bg-violet-100"
            title="차트의 연결을 각 시나리오의 후속 실행 ID로 저장합니다. 한 노드에서 여러 갈래면 첫 연결만 반영됩니다."
          >
            <Link2 className="w-3.5 h-3.5" />
            실행용 후속 연결 반영
          </button>
        </Panel>
      </ReactFlow>
    </div>
  );
}

function readScenarioScope(): ScenarioScope {
  try {
    const v = localStorage.getItem(SCENARIO_SCOPE_KEY);
    if (v === "all" || v === "domain") return v;
  } catch {
    /* ignore */
  }
  return "domain";
}

function readInitialFlowDraft() {
  return loadSerializedFlow() ?? DEFAULT_SERIALIZED_FLOW;
}

export default function ScenarioFlowPage() {
  const { currentDomain } = useInspectedTabUrl();
  const [scenarios, setScenarios] = useState(() => getScenarios());
  const [startUrl, setStartUrl] = useState(() => readInitialFlowDraft().startUrl);
  const [flowNameUserLocked, setFlowNameUserLocked] = useState(() => {
    const l = readInitialFlowDraft();
    const n = l.name?.trim() || "";
    return n.length > 0 && n !== FLOW_DEFAULT_NAME;
  });
  const [flowName, setFlowName] = useState(() => {
    const l = readInitialFlowDraft();
    const n = l.name?.trim() || "";
    if (n && n !== FLOW_DEFAULT_NAME) return n;
    return deriveDefaultFlowName(
      extractLinearScenarioOrderedIds(l.nodes, l.edges),
      getScenarioById,
    );
  });
  const [scenarioScope, setScenarioScope] = useState<ScenarioScope>(
    readScenarioScope,
  );
  const saveFlowRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    setScenarios(getScenarios());
  }, []);

  const setScope = useCallback((scope: ScenarioScope) => {
    setScenarioScope(scope);
    try {
      localStorage.setItem(SCENARIO_SCOPE_KEY, scope);
    } catch {
      /* ignore */
    }
  }, []);

  const scenarioOptions = useMemo(() => {
    if (scenarioScope === "all") return scenarios;
    return scenarios.filter((s) =>
      scenarioMatchesInspectedHost(s.urlPattern, currentDomain),
    );
  }, [scenarios, scenarioScope, currentDomain]);

  return (
    <Layout>
      <Toaster position="top-center" richColors closeButton />
      <div className="flex flex-col h-full min-h-0 bg-[var(--flux-bg-subtle)]">
        <header className="shrink-0 flex items-center gap-2 px-3 py-2.5 border-b border-[var(--flux-border)] bg-white z-10">
          <Link
            to="/"
            className="p-1.5 rounded-lg hover:bg-[var(--flux-primary-muted)] text-[var(--flux-text-muted)] shrink-0"
            title="목록"
          >
            <ChevronLeft className="w-5 h-5" />
          </Link>
          <div className="min-w-0 flex-1 flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <GitBranch className="w-5 h-5 text-[var(--flux-primary)] shrink-0 hidden sm:block" />
              <h1 className="text-sm font-bold text-[var(--flux-text-default)] truncate">
                시나리오 조합하기
              </h1>
            </div>
            <p className="text-[10px] text-[var(--flux-text-muted)] sm:truncate">
              「저장」해야 이 브라우저에 남습니다. 플로우는 시나리오 목록 카드와 별개예요.
            </p>
            <select
              value={scenarioScope}
              onChange={(e) => setScope(e.target.value as ScenarioScope)}
              className="shrink-0 text-[11px] font-semibold border border-[var(--flux-border)] rounded-lg px-2 py-1.5 bg-white text-[var(--flux-text-default)] outline-none focus:border-[var(--flux-primary)] max-w-[140px]"
              title="목록에 넣을 시나리오 범위"
            >
              <option value="domain">이 도메인만</option>
              <option value="all">전체 시나리오</option>
            </select>
          </div>
          <button
            type="button"
            onClick={() => saveFlowRef.current?.()}
            className="shrink-0 px-3 py-1.5 rounded-lg bg-[var(--flux-primary)] text-white text-xs font-bold hover:opacity-95"
          >
            저장
          </button>
        </header>

        <div className="flex-1 min-h-0 w-full">
          <FlowScenariosContext.Provider value={scenarioOptions}>
            <ReactFlowProvider>
              <FlowCanvasInner
                startUrl={startUrl}
                onStartUrlChange={setStartUrl}
                flowName={flowName}
                setFlowName={setFlowName}
                flowNameUserLocked={flowNameUserLocked}
                setFlowNameUserLocked={setFlowNameUserLocked}
                onRegisterSave={(fn) => {
                  saveFlowRef.current = fn;
                }}
              />
            </ReactFlowProvider>
          </FlowScenariosContext.Provider>
        </div>
      </div>
    </Layout>
  );
}
