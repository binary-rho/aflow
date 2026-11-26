import { describe, expect, test } from "vitest";
import {
  normalizeScenarioHost,
  resolveUrlPatternFromDsl,
  scenarioMatchesInspectedHost,
} from "./scenarioHost";

describe("normalizeScenarioHost", () => {
  test("스킴·포트·경로 제거, 소문자, 선행 www 제거", () => {
    expect(normalizeScenarioHost("https://WWW.Example.com:8080/path")).toBe("example.com");
  });

  test("userinfo(@) 제거", () => {
    expect(normalizeScenarioHost("user@host.com")).toBe("host.com");
  });

  test("끝의 [대괄호] 꼬리표 제거", () => {
    expect(normalizeScenarioHost("example.com [stg]")).toBe("example.com");
  });

  test("빈 값", () => {
    expect(normalizeScenarioHost("")).toBe("");
  });
});

describe("resolveUrlPatternFromDsl", () => {
  test("DSL baseUrl이 최우선", () => {
    expect(resolveUrlPatternFromDsl("https://m.example.com/x", "tab.com")).toBe("m.example.com");
  });

  test("baseUrl이 없으면 첫 nav URL의 호스트", () => {
    expect(resolveUrlPatternFromDsl("", "Tab.com", "https://nav.example.com/p")).toBe(
      "nav.example.com",
    );
  });

  test("첫 nav가 상대 경로면 검사 탭 호스트", () => {
    expect(resolveUrlPatternFromDsl("", "Tab.com", "/mobile")).toBe("tab.com");
  });

  test("아무것도 없으면 localhost", () => {
    expect(resolveUrlPatternFromDsl("", "")).toBe("localhost");
  });
});

describe("scenarioMatchesInspectedHost", () => {
  test("같은 호스트 (www 무시)", () => {
    expect(scenarioMatchesInspectedHost("lguplus.com", "lguplus.com")).toBe(true);
    expect(scenarioMatchesInspectedHost("www.lguplus.com", "lguplus.com")).toBe(true);
  });

  test("urlPattern의 경로 부분은 무시", () => {
    expect(scenarioMatchesInspectedHost("a.com/path", "a.com")).toBe(true);
  });

  test("일반 서브도메인은 같은 사이트로 본다", () => {
    expect(scenarioMatchesInspectedHost("api.lguplus.com", "lguplus.com")).toBe(true);
    expect(scenarioMatchesInspectedHost("m.lguplus.com", "lguplus.com")).toBe(true);
    expect(scenarioMatchesInspectedHost("lguplus.com", "m.lguplus.com")).toBe(true);
  });

  test("환경 서브도메인(stg, qa 등)은 prod와 분리한다 — 양방향", () => {
    expect(scenarioMatchesInspectedHost("stg.lguplus.com", "lguplus.com")).toBe(false);
    expect(scenarioMatchesInspectedHost("lguplus.com", "stg.lguplus.com")).toBe(false);
    expect(scenarioMatchesInspectedHost("qa.x.com", "x.com")).toBe(false);
  });

  test("이름이 비슷하기만 한 다른 도메인은 매칭하지 않는다", () => {
    expect(scenarioMatchesInspectedHost("evil-lguplus.com", "lguplus.com")).toBe(false);
  });

  test("localhost·빈 값은 매칭하지 않는다", () => {
    expect(scenarioMatchesInspectedHost("localhost", "localhost")).toBe(false);
    expect(scenarioMatchesInspectedHost("", "a.com")).toBe(false);
    expect(scenarioMatchesInspectedHost("a.com", "")).toBe(false);
  });
});
