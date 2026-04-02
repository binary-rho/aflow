import type { Scenario } from "@/app/data";
import { SCENARIO_CHAIN_MAX } from "@/app/data";

/** followUpScenarioId를 따라 최대 SCENARIO_CHAIN_MAX개까지 펼친 실행 순서 (루프 시 중단). */
export function buildScenarioRunChain(
  root: Scenario,
  getById: (id: string) => Scenario | undefined,
): Scenario[] {
  const out: Scenario[] = [];
  let cur: Scenario | undefined = root;
  const seen = new Set<string>();
  while (cur && out.length < SCENARIO_CHAIN_MAX) {
    if (seen.has(cur.id)) break;
    seen.add(cur.id);
    out.push(cur);
    const nextId = cur.followUpScenarioId?.trim();
    if (!nextId) break;
    cur = getById(nextId);
  }
  return out;
}
