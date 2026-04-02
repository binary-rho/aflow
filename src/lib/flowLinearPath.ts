import type { Scenario } from "@/app/data";
import type {
  SerializedFlowEdge,
  SerializedFlowNode,
} from "@/stores/flowCompositionStore";
import { FLOW_DEFAULT_NAME } from "@/stores/flowCompositionStore";

const DEFAULT_FLOW_NAME_MAX_LEN = 120;

/**
 * 플로우 그래프에서 루트에서 첫 번째 outgoing 엣지만 따라가며 시나리오 ID 순서를 만든다.
 * (분기가 있으면 첫 연결만 사용 — FlowDetail 실행과 동일)
 */
export function extractLinearScenarioOrderedIds(
  nodes: SerializedFlowNode[],
  edges: SerializedFlowEdge[],
): string[] {
  const scenarioNodes = nodes.filter((n) => n.type === "flowScenario");
  if (scenarioNodes.length === 0) return [];

  const hasIncoming = new Set(edges.map((e) => e.target));
  const roots = scenarioNodes.filter((n) => !hasIncoming.has(n.id));
  const startNode = roots.length > 0 ? roots[0] : scenarioNodes[0];

  const edgeMap = new Map<string, string[]>();
  for (const e of edges) {
    if (!edgeMap.has(e.source)) edgeMap.set(e.source, []);
    edgeMap.get(e.source)!.push(e.target);
  }

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const path: string[] = [];
  const visited = new Set<string>();
  let current: string | undefined = startNode.id;

  while (current && !visited.has(current)) {
    visited.add(current);
    const node = nodeById.get(current);
    if (node?.type === "flowScenario") {
      const sid = (node.data as { scenarioId?: string }).scenarioId;
      if (sid) path.push(sid);
    }
    const nexts = edgeMap.get(current);
    current = nexts?.[0];
  }

  return path;
}

/** 연결된 시나리오 제목을 화살표로 이은 기본 플로우 이름 */
export function deriveDefaultFlowName(
  scenarioIds: string[],
  getById: (id: string) => Scenario | undefined,
): string {
  const titles = scenarioIds
    .map((id) => getById(id)?.title?.trim())
    .filter((t): t is string => !!t);
  if (titles.length === 0) return FLOW_DEFAULT_NAME;
  const joined = titles.join(" → ");
  if (joined.length <= DEFAULT_FLOW_NAME_MAX_LEN) return joined;
  return `${joined.slice(0, DEFAULT_FLOW_NAME_MAX_LEN - 1)}…`;
}
