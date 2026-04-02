import type { Edge, Node as RFNode } from "@xyflow/react";

/** 카드(176px) + 오른쪽 − 영역 */
export const SCENARIO_NODE_OUTER_WIDTH = 200;
export const SIBLING_HORIZONTAL_GAP = 28;

/**
 * 같은 부모 아래 flowScenario 자식들을 부모 노드 중심으로 가로 정렬 (토스식 분기).
 */
export function layoutScenarioSiblingsUnderParents(
  nodes: RFNode[],
  edges: Edge[],
): RFNode[] {
  const byParent = new Map<string, string[]>();
  for (const e of edges) {
    const tgt = nodes.find((n) => n.id === e.target);
    const src = nodes.find((n) => n.id === e.source);
    if (tgt?.type !== "flowScenario" || src?.type !== "flowScenario") continue;
    if (!byParent.has(e.source)) byParent.set(e.source, []);
    const list = byParent.get(e.source)!;
    if (!list.includes(e.target)) list.push(e.target);
  }

  let result = nodes.map((n) => ({ ...n, position: { ...n.position } }));

  for (const [parentId, childIds] of byParent) {
    if (childIds.length === 0) continue;
    const parent = result.find((n) => n.id === parentId);
    if (!parent) continue;

    const ordered = [...childIds].sort((a, b) => {
      const ax = result.find((n) => n.id === a)!.position.x;
      const bx = result.find((n) => n.id === b)!.position.x;
      return ax - bx;
    });

    const N = ordered.length;
    const W = SCENARIO_NODE_OUTER_WIDTH;
    const G = SIBLING_HORIZONTAL_GAP;
    const parentCenterX = parent.position.x + W / 2;
    const total = N * W + (N - 1) * G;
    const startX = parentCenterX - total / 2;
    const baseY = result.find((n) => n.id === ordered[0])!.position.y;

    ordered.forEach((cid, i) => {
      const idx = result.findIndex((n) => n.id === cid);
      if (idx >= 0) {
        result[idx] = {
          ...result[idx],
          position: {
            x: startX + i * (W + G),
            y: baseY,
          },
        };
      }
    });
  }

  return result;
}
