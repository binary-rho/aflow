import { describe, expect, test } from "vitest";
import type { Scenario } from "@/app/data";
import {
  getScenarioEffectiveUrl,
  isSamePage,
  normalizeUrlForCompare,
} from "./urlMatch";

function scenario(urlPattern: string, steps: Scenario["steps"]): Scenario {
  return {
    id: "sc1",
    title: "t",
    description: "",
    tags: [],
    urlPattern,
    steps,
    createdAt: "2026-01-01",
  };
}

describe("normalizeUrlForCompare", () => {
  test("스킴·www·쿼리·해시를 제거한다", () => {
    expect(normalizeUrlForCompare("https://www.example.com/mobile?p=1#x")).toBe(
      "example.com/mobile",
    );
  });

  test("해시만 있는 경우", () => {
    expect(normalizeUrlForCompare("https://a.com/x#frag")).toBe("a.com/x");
  });

  test("끝 슬래시를 제거한다", () => {
    expect(normalizeUrlForCompare("http://a.com/path/")).toBe("a.com/path");
    expect(normalizeUrlForCompare("https://a.com/")).toBe("a.com");
  });
});

describe("isSamePage", () => {
  test("스킴/www/쿼리 차이는 같은 페이지", () => {
    expect(isSamePage("https://www.example.com/mobile?p=1", "example.com/mobile")).toBe(true);
  });

  test("경로가 다르면 다른 페이지", () => {
    expect(isSamePage("a.com/x", "a.com/y")).toBe(false);
  });
});

describe("getScenarioEffectiveUrl", () => {
  const nav = (url: unknown) =>
    [{ id: "s1", actionId: "nav.goto", params: { url } }] as Scenario["steps"];

  test("상대 경로 nav.goto는 urlPattern 뒤에 붙는다", () => {
    expect(getScenarioEffectiveUrl(scenario("m.example.com", nav("/mobile")))).toBe(
      "m.example.com/mobile",
    );
  });

  test("전체 URL이면 경로(+쿼리)만 취한다", () => {
    expect(
      getScenarioEffectiveUrl(scenario("m.example.com", nav("https://m.example.com/a/b?x=1"))),
    ).toBe("m.example.com/a/b?x=1");
  });

  test("호스트 형태(스킴 없음)도 경로만 취한다", () => {
    expect(getScenarioEffectiveUrl(scenario("m.example.com", nav("m.example.com/a")))).toBe(
      "m.example.com/a",
    );
  });

  test("첫 스텝이 nav.goto가 아니면 urlPattern 그대로", () => {
    const steps = [{ id: "s1", actionId: "button.click", params: { text: "x" } }] as Scenario["steps"];
    expect(getScenarioEffectiveUrl(scenario("m.example.com", steps))).toBe("m.example.com");
  });

  test("스텝이 없거나 url이 비어 있으면 urlPattern 그대로", () => {
    expect(getScenarioEffectiveUrl(scenario("m.example.com", []))).toBe("m.example.com");
    expect(getScenarioEffectiveUrl(scenario("m.example.com", nav("")))).toBe("m.example.com");
  });
});
