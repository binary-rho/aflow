import { describe, expect, test } from "vitest";
import type { Scenario } from "@/app/data";
import type { SerializedFlowEdge, SerializedFlowNode } from "@/stores/flowCompositionStore";
import { FLOW_DEFAULT_NAME } from "@/stores/flowCompositionStore";
import { deriveDefaultFlowName, extractLinearScenarioOrderedIds } from "./flowLinearPath";

function node(id: string, scenarioId: string, type = "flowScenario"): SerializedFlowNode {
  return { id, type, position: { x: 0, y: 0 }, data: { scenarioId } };
}

function edge(source: string, target: string): SerializedFlowEdge {
  return { id: `${source}-${target}`, source, target };
}

describe("extractLinearScenarioOrderedIds", () => {
  test("노드가 없으면 빈 배열", () => {
    expect(extractLinearScenarioOrderedIds([], [])).toEqual([]);
  });

  test("노드 배열 순서와 무관하게 incoming 없는 루트부터 엣지를 따라간다", () => {
    const nodes = [node("n3", "s3"), node("n1", "s1"), node("n2", "s2")];
    const edges = [edge("n1", "n2"), edge("n2", "n3")];
    expect(extractLinearScenarioOrderedIds(nodes, edges)).toEqual(["s1", "s2", "s3"]);
  });

  test("분기가 있으면 첫 번째 엣지만 따라간다", () => {
    const nodes = [node("n1", "s1"), node("n2", "s2"), node("n3", "s3")];
    const edges = [edge("n1", "n2"), edge("n1", "n3")];
    expect(extractLinearScenarioOrderedIds(nodes, edges)).toEqual(["s1", "s2"]);
  });

  test("순환이어도 무한루프 없이 한 번씩만", () => {
    const nodes = [node("n1", "s1"), node("n2", "s2")];
    const edges = [edge("n1", "n2"), edge("n2", "n1")];
    expect(extractLinearScenarioOrderedIds(nodes, edges)).toEqual(["s1", "s2"]);
  });

  test("scenarioId가 비어 있는 노드는 건너뛰되 경로는 이어진다", () => {
    const nodes = [node("n1", "s1"), node("n2", ""), node("n3", "s3")];
    const edges = [edge("n1", "n2"), edge("n2", "n3")];
    expect(extractLinearScenarioOrderedIds(nodes, edges)).toEqual(["s1", "s3"]);
  });
});

describe("deriveDefaultFlowName", () => {
  const titles: Record<string, string> = {
    a: "로그인",
    b: "  상품 선택  ",
    c: "",
    long1: "가".repeat(50),
    long2: "나".repeat(50),
    long3: "다".repeat(50),
  };
  const getById = (id: string) =>
    id in titles ? ({ title: titles[id] } as Scenario) : undefined;

  test("제목을 화살표로 잇는다 (앞뒤 공백 제거)", () => {
    expect(deriveDefaultFlowName(["a", "b"], getById)).toBe("로그인 → 상품 선택");
  });

  test("제목이 없거나 알 수 없는 id는 제외", () => {
    expect(deriveDefaultFlowName(["a", "c", "unknown"], getById)).toBe("로그인");
  });

  test("쓸 제목이 하나도 없으면 기본 이름", () => {
    expect(deriveDefaultFlowName([], getById)).toBe(FLOW_DEFAULT_NAME);
    expect(deriveDefaultFlowName(["c", "unknown"], getById)).toBe(FLOW_DEFAULT_NAME);
  });

  test("120자를 넘으면 119자 + 말줄임표", () => {
    const name = deriveDefaultFlowName(["long1", "long2", "long3"], getById);
    expect(name).toHaveLength(120);
    expect(name.endsWith("…")).toBe(true);
  });
});
