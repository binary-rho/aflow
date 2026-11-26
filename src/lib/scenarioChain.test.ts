import { describe, expect, test } from "vitest";
import { SCENARIO_CHAIN_MAX, type Scenario } from "@/app/data";
import { buildScenarioRunChain } from "./scenarioChain";

function sc(id: string, followUpScenarioId?: string): Scenario {
  return {
    id,
    title: id,
    description: "",
    tags: [],
    urlPattern: "a.com",
    steps: [],
    createdAt: "2026-01-01",
    followUpScenarioId,
  };
}

function lookup(list: Scenario[]) {
  const map = new Map(list.map((s) => [s.id, s]));
  return (id: string) => map.get(id);
}

describe("buildScenarioRunChain", () => {
  test("followUp이 없으면 루트만", () => {
    const a = sc("a");
    expect(buildScenarioRunChain(a, lookup([a])).map((s) => s.id)).toEqual(["a"]);
  });

  test("followUp을 따라 순서대로 펼친다", () => {
    const list = [sc("a", "b"), sc("b", "c"), sc("c")];
    expect(buildScenarioRunChain(list[0], lookup(list)).map((s) => s.id)).toEqual(["a", "b", "c"]);
  });

  test("순환이면 한 번씩만 포함하고 멈춘다", () => {
    const list = [sc("a", "b"), sc("b", "a")];
    expect(buildScenarioRunChain(list[0], lookup(list)).map((s) => s.id)).toEqual(["a", "b"]);
  });

  test("존재하지 않는 followUp id에서 멈춘다", () => {
    const list = [sc("a", "missing")];
    expect(buildScenarioRunChain(list[0], lookup(list)).map((s) => s.id)).toEqual(["a"]);
  });

  test("공백뿐인 followUp id는 없는 것으로 본다", () => {
    const list = [sc("a", "   ")];
    expect(buildScenarioRunChain(list[0], lookup(list)).map((s) => s.id)).toEqual(["a"]);
  });

  test(`최대 ${SCENARIO_CHAIN_MAX}개까지만`, () => {
    const list = Array.from({ length: SCENARIO_CHAIN_MAX + 5 }, (_, i) =>
      sc(`s${i}`, `s${i + 1}`),
    );
    expect(buildScenarioRunChain(list[0], lookup(list))).toHaveLength(SCENARIO_CHAIN_MAX);
  });
});
