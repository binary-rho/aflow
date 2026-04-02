const STORAGE_KEY = "flux_scenario_flow_v1";
const FLOWS_STORAGE_KEY = "flux_saved_flows_v1";

export type SerializedFlowNode = {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
};

export type SerializedFlowEdge = {
  id: string;
  source: string;
  target: string;
};

export type SerializedFlow = {
  id?: string;
  version: 1;
  name: string;
  startUrl: string;
  nodes: SerializedFlowNode[];
  edges: SerializedFlowEdge[];
  createdAt?: string;
};

export const FLOW_DEFAULT_NAME = "시나리오 조합";

export const DEFAULT_SERIALIZED_FLOW: SerializedFlow = {
  version: 1,
  name: FLOW_DEFAULT_NAME,
  startUrl: "",
  nodes: [
    {
      id: "n1",
      type: "flowScenario",
      position: { x: 200, y: 40 },
      data: { scenarioId: "" },
    },
  ],
  edges: [],
};

function cleanupFlowStart(p: SerializedFlow): SerializedFlow {
  const removedIds = new Set(
    p.nodes.filter((n) => n.type === "flowStart").map((n) => n.id),
  );
  if (removedIds.size > 0) {
    p.nodes = p.nodes.filter((n) => n.type !== "flowStart");
    p.edges = p.edges.filter(
      (e) => !removedIds.has(e.source) && !removedIds.has(e.target),
    );
  }
  return p;
}

export function loadSerializedFlow(): SerializedFlow | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as SerializedFlow;
    if (p?.version !== 1 || !Array.isArray(p.nodes) || !Array.isArray(p.edges))
      return null;
    return cleanupFlowStart(p);
  } catch {
    return null;
  }
}

export function saveSerializedFlow(flow: SerializedFlow): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(flow));
}

export function getSavedFlowSummary(): {
  name: string;
  nodeCount: number;
  edgeCount: number;
} | null {
  const f = loadSerializedFlow();
  if (!f) return null;
  return {
    name: f.name?.trim() || FLOW_DEFAULT_NAME,
    nodeCount: f.nodes.length,
    edgeCount: f.edges.length,
  };
}

export function getSavedFlows(): SerializedFlow[] {
  try {
    const raw = localStorage.getItem(FLOWS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(cleanupFlowStart) : [];
  } catch {
    return [];
  }
}

export function getSavedFlowById(id: string): SerializedFlow | undefined {
  return getSavedFlows().find((f) => f.id === id);
}

export function saveFlowToList(flow: SerializedFlow): void {
  const all = getSavedFlows();
  const flowWithId: SerializedFlow = {
    ...flow,
    id: flow.id || `flow_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    createdAt: flow.createdAt || new Date().toISOString().slice(0, 10),
  };
  const idx = all.findIndex((f) => f.id === flowWithId.id);
  if (idx >= 0) {
    all[idx] = flowWithId;
  } else {
    all.push(flowWithId);
  }
  localStorage.setItem(FLOWS_STORAGE_KEY, JSON.stringify(all));
}

export function deleteFlowFromList(id: string): void {
  const all = getSavedFlows().filter((f) => f.id !== id);
  localStorage.setItem(FLOWS_STORAGE_KEY, JSON.stringify(all));
}
