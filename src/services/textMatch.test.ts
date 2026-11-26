import { describe, expect, test } from "vitest";
import {
  buildClientNormalizerScript,
  contextMatches,
  normalizeContextForMatch,
  normalizeForMatch,
  normalizeWithSpaces,
  textMatches,
  textMatchesExact,
} from "./textMatch";

describe("normalizeForMatch", () => {
  test("공백 제거 + 소문자", () => {
    expect(normalizeForMatch("  Galaxy  S26 ")).toBe("galaxys26");
  });

  test("null/undefined는 빈 문자열", () => {
    expect(normalizeForMatch(null)).toBe("");
    expect(normalizeForMatch(undefined)).toBe("");
  });

  test("위첨자 플러스(⁺)를 '+'로 통일", () => {
    expect(normalizeForMatch("S26⁺")).toBe("s26+");
  });

  // 회귀: 예전 정규식 [⁺\u2B⁺]가 문자 u / 2 / B까지 '+'로 바꾸는 버그가 있었다.
  test("대소문자만 다른 영문은 같다 (B, u 포함)", () => {
    expect(normalizeForMatch("BUY")).toBe(normalizeForMatch("buy"));
    expect(normalizeForMatch("Blue")).toBe("blue");
  });

  test("숫자 2는 보존된다", () => {
    expect(normalizeForMatch("S26")).toBe("s26");
    expect(normalizeForMatch("S26")).not.toBe(normalizeForMatch("S+6"));
  });
});

describe("normalizeWithSpaces", () => {
  test("연속 공백을 하나로 합친다", () => {
    expect(normalizeWithSpaces("  A   B ")).toBe("a b");
  });
});

describe("normalizeContextForMatch", () => {
  test("한/영 동의어를 통일한다", () => {
    expect(normalizeContextForMatch("아이폰 17 Pro")).toBe("iphone17pro");
    expect(normalizeContextForMatch("iPhone 17 Pro")).toBe("iphone17pro");
    expect(normalizeContextForMatch("갤럭시 S26")).toBe("galaxys26");
  });
});

describe("textMatchesExact", () => {
  test("정규화 후 완전 일치", () => {
    expect(textMatchesExact("갤럭시 S26", "갤럭시S26")).toBe(true);
  });

  test("부분 포함은 허용하지 않는다 (S26 vs S26+)", () => {
    expect(textMatchesExact("갤럭시 S26+", "갤럭시S26")).toBe(false);
  });

  test("빈 값은 false", () => {
    expect(textMatchesExact(null, "a")).toBe(false);
    expect(textMatchesExact("a", "")).toBe(false);
  });
});

describe("textMatches (부분 포함 폴백)", () => {
  test("양방향 포함", () => {
    expect(textMatches("신청하기", "신청하기 버튼")).toBe(true);
    expect(textMatches("신청하기 버튼", "신청하기")).toBe(true);
  });

  test("짧은 문자열(3자 미만)은 완전 일치만 허용", () => {
    expect(textMatches("확인", "확인하기")).toBe(false);
    expect(textMatches("확인", "확인")).toBe(true);
  });

  test("부분 매칭은 S26과 S26+를 구분하지 못한다 — 그래서 exact를 먼저 시도한다", () => {
    expect(textMatches("S26", "S26+")).toBe(true);
    expect(textMatchesExact("S26", "S26+")).toBe(false);
  });
});

describe("contextMatches", () => {
  test("한/영 동의어를 넘어 포함 매칭", () => {
    expect(contextMatches("아이폰 17 Pro 카드", "iPhone 17")).toBe(true);
  });

  test("무관한 컨텍스트는 false", () => {
    expect(contextMatches("갤럭시 S26", "아이폰")).toBe(false);
  });

  test("빈 값은 false", () => {
    expect(contextMatches(null, "a")).toBe(false);
    expect(contextMatches("a", undefined)).toBe(false);
  });
});

// 페이지에 주입되는 JS 문자열 버전이 TS 버전과 같은 결과를 내는지 검증한다.
// (textMatch.ts 상단 주석: "두 환경의 정규화 결과가 항상 같다")
describe("buildClientNormalizerScript 와 TS 구현의 일치", () => {
  const client = new Function(
    `${buildClientNormalizerScript()}; return { fluxNormalize, fluxTextMatches, fluxTextMatchesExact };`,
  )() as {
    fluxNormalize: (s: unknown) => string;
    fluxTextMatches: (a: unknown, b: unknown) => boolean;
    fluxTextMatchesExact: (a: unknown, b: unknown) => boolean;
  };

  const samples = [
    "  Galaxy  S26 ",
    "S26⁺",
    "BUY",
    "buy",
    "신청하기",
    "신청하기 버튼",
    "확인",
    "",
    "S26+",
  ];

  test("normalize", () => {
    for (const s of samples) {
      expect(client.fluxNormalize(s)).toBe(normalizeForMatch(s));
    }
  });

  test("textMatches / textMatchesExact", () => {
    for (const a of samples) {
      for (const b of samples) {
        expect(client.fluxTextMatches(a, b)).toBe(textMatches(a, b));
        expect(client.fluxTextMatchesExact(a, b)).toBe(textMatchesExact(a, b));
      }
    }
  });
});
