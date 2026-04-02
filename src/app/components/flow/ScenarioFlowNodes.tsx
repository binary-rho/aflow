import { createContext, useContext, useCallback, useMemo } from "react";
import { flushSync } from "react-dom";
import {
  Handle,
  Position,
  type NodeProps,
  useReactFlow,
  useStore,
} from "@xyflow/react";
import type { Edge, Node as RFNode } from "@xyflow/react";
import type { Scenario } from "@/app/data";
import {
  layoutScenarioSiblingsUnderParents,
} from "./flowSiblingLayout";

export const FlowScenariosContext = createContext<Scenario[]>([]);

const HIDDEN_HANDLE =
  "!w-0 !h-0 !min-w-0 !min-h-0 !border-0 !bg-transparent !opacity-0 !pointer-events-auto";

const CHILD_OFFSET_Y = 96;

/** 엣지보다 흐린 공통 톤 (+ / − 동일) */
const FLOW_SOFT_ICON =
  "text-[15px] font-extralight leading-none tracking-tight text-[#c5cdd8] hover:text-gray-400 transition-colors select-none";

const PLUS_STYLE = `nodrag absolute -bottom-[26px] ${FLOW_SOFT_ICON} active:text-[var(--flux-primary)]`;

function countScenarioChildren(
  parentId: string,
  edges: Edge[],
  nodeIdsByTarget: Map<string, string | undefined>,
): number {
  let n = 0;
  for (const e of edges) {
    if (e.source !== parentId) continue;
    if (nodeIdsByTarget.get(e.target) === "flowScenario") n += 1;
  }
  return n;
}

function useAddChildNode(parentId: string) {
  const { setNodes, setEdges, getNode, getEdges, getNodes } = useReactFlow();

  return useCallback(() => {
    const parent = getNode(parentId);
    if (!parent) return;
    flushSync(() => {
      const edges = getEdges();
      const nodes = getNodes();
      const typeById = new Map(nodes.map((n) => [n.id, n.type]));
      const siblingNodes = edges
        .filter((e) => e.source === parentId)
        .map((e) => nodes.find((n) => n.id === e.target))
        .filter((n): n is RFNode => Boolean(n && n.type === "flowScenario"));

      const baseY =
        siblingNodes.length > 0
          ? siblingNodes[0].position.y
          : parent.position.y + CHILD_OFFSET_Y;

      const childId = `n_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const nextEdges = [
        ...edges,
        {
          id: `e_${parentId}_${childId}`,
          source: parentId,
          target: childId,
          style: {
            stroke: "#94a3b8",
            strokeWidth: 1.75,
            strokeDasharray: "5 5",
          },
        },
      ];
      const nextNodes = [
        ...nodes,
        {
          id: childId,
          type: "flowScenario",
          position: { x: parent.position.x, y: baseY },
          data: { scenarioId: "" },
        },
      ];
      const laidOut = layoutScenarioSiblingsUnderParents(nextNodes, nextEdges);
      setNodes(laidOut);
      setEdges(nextEdges);
    });
  }, [parentId, getNode, getEdges, getNodes, setNodes, setEdges]);
}

function useScenarioChildCount(nodeId: string): number {
  return useStore(
    useMemo(
      () => (s) => {
        const typeById = new Map(s.nodes.map((n) => [n.id, n.type]));
        return countScenarioChildren(nodeId, s.edges, typeById);
      },
      [nodeId],
    ),
  );
}

export function FlowScenarioNode({ id, data, selected }: NodeProps) {
  const scenarios = useContext(FlowScenariosContext);
  const { setNodes, setEdges, getEdges, getNodes } = useReactFlow();
  const scenarioId =
    typeof data === "object" && data && "scenarioId" in data
      ? String((data as { scenarioId?: string }).scenarioId ?? "")
      : "";
  const addChild = useAddChildNode(id);
  const scenarioChildCount = useScenarioChildCount(id);
  const hasDownstream = scenarioChildCount > 0;

  const handleDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      flushSync(() => {
        const nodes = getNodes().filter((n) => n.id !== id);
        const eds = getEdges().filter(
          (edge) => edge.source !== id && edge.target !== id,
        );
        setNodes(layoutScenarioSiblingsUnderParents(nodes, eds));
        setEdges(eds);
      });
    },
    [id, getNodes, getEdges, setNodes, setEdges],
  );

  return (
    <div className="relative flex flex-row items-center gap-0">
      <div
        className={`relative rounded-xl border bg-white shadow-sm w-[176px] shrink-0 transition-shadow ${
          selected
            ? "border-[var(--flux-primary)] ring-2 ring-[var(--flux-ring)]"
            : "border-gray-200"
        }`}
      >
        <Handle
          type="target"
          position={Position.Top}
          className={HIDDEN_HANDLE}
        />

        <div
          className="nodrag nowheel px-2 py-2"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <label className="sr-only">시나리오 선택</label>
          <select
            value={scenarioId}
            onChange={(e) => {
              const v = e.target.value;
              setNodes((nds) =>
                nds.map((n) =>
                  n.id === id
                    ? { ...n, data: { ...n.data, scenarioId: v } }
                    : n,
                ),
              );
            }}
            className="w-full text-[10px] font-medium border border-gray-200 rounded-md px-1.5 py-1.5 bg-white text-[var(--flux-text-default)] outline-none focus:border-[var(--flux-primary)] focus:ring-1 focus:ring-[var(--flux-ring)] appearance-none cursor-pointer leading-snug"
            style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
              backgroundRepeat: "no-repeat",
              backgroundPosition: "right 6px center",
              paddingRight: "22px",
            }}
          >
            <option value="">시나리오 / 테스트 선택</option>
            {scenarios.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
        </div>

        <Handle
          type="source"
          position={Position.Bottom}
          id="out"
          className={HIDDEN_HANDLE}
        />

        {!hasDownstream ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              addChild();
            }}
            className={`${PLUS_STYLE} left-1/2 -translate-x-1/2`}
            title="다음 단계 추가"
          >
            +
          </button>
        ) : (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              addChild();
            }}
            className={`${PLUS_STYLE} right-2 left-auto`}
            title="갈래 추가 (분기)"
          >
            +
          </button>
        )}
      </div>

      <button
        type="button"
        onClick={handleDelete}
        className={`nodrag shrink-0 w-5 flex items-center justify-center self-center ${FLOW_SOFT_ICON} active:text-red-400`}
        title="노드 삭제"
      >
        −
      </button>
    </div>
  );
}
