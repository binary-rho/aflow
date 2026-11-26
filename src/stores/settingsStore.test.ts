import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";

// settingsStore는 localStorage 존재 여부(typeof)로 UI/Service Worker 컨텍스트를 구분한다.
// 모듈을 import하기 전에 localStorage를 없앤 상태(= Service Worker)로 시작한다.
type Store = typeof import("./settingsStore");
let store: Store;

function fakeLocalStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
  };
}

beforeAll(async () => {
  vi.stubGlobal("localStorage", undefined);
  store = await import("./settingsStore");
});

afterEach(() => {
  store.applyLlmRuntimeConfig(null);
  vi.stubGlobal("localStorage", undefined);
});

describe("normalizeLocalBaseUrl", () => {
  test("/v1, /v1/chat/completions, 끝 슬래시를 떼어 scheme://host:port로", () => {
    const n = (s: string) => store.normalizeLocalBaseUrl(s);
    expect(n("http://h:1/v1")).toBe("http://h:1");
    expect(n("http://h:1/")).toBe("http://h:1");
    expect(n("http://h:1/v1/chat/completions")).toBe("http://h:1");
    expect(n("  https://h  ")).toBe("https://h");
  });
});

describe("Service Worker 컨텍스트 (localStorage 없음)", () => {
  test("override가 없으면 기본값", () => {
    expect(store.getLocalBaseUrl()).toBe(store.DEFAULT_LOCAL_BASE_URL);
    expect(store.getLocalModel()).toBe(store.DEFAULT_LOCAL_MODEL);
    expect(store.getAnthropicBaseUrl()).toBe(store.DEFAULT_ANTHROPIC_BASE_URL);
    expect(store.getLlmMatcherEnabled()).toBe(true);
  });

  test("applyLlmRuntimeConfig로 UI 설정을 넘기면 getter가 그 값을 쓴다", () => {
    store.applyLlmRuntimeConfig({
      localBaseUrl: "http://llm.test:9000/v1/chat/completions/",
      localModel: "my-model",
      anthropicBaseUrl: "https://gw.test/anthropic/",
      matcherEnabled: false,
    });
    expect(store.getLocalBaseUrl()).toBe("http://llm.test:9000");
    expect(store.getLocalModel()).toBe("my-model");
    expect(store.getAnthropicBaseUrl()).toBe("https://gw.test/anthropic");
    expect(store.getLlmMatcherEnabled()).toBe(false);
  });

  test("apply(null)로 override를 해제하면 기본값으로 돌아간다", () => {
    store.applyLlmRuntimeConfig({ localModel: "my-model", matcherEnabled: false });
    store.applyLlmRuntimeConfig(null);
    expect(store.getLocalModel()).toBe(store.DEFAULT_LOCAL_MODEL);
    expect(store.getLlmMatcherEnabled()).toBe(true);
  });

  test("빈 문자열/공백 override는 무시하고 기본값을 쓴다", () => {
    store.applyLlmRuntimeConfig({ localModel: "   ", localBaseUrl: "", anthropicBaseUrl: " " });
    expect(store.getLocalModel()).toBe(store.DEFAULT_LOCAL_MODEL);
    expect(store.getLocalBaseUrl()).toBe(store.DEFAULT_LOCAL_BASE_URL);
    expect(store.getAnthropicBaseUrl()).toBe(store.DEFAULT_ANTHROPIC_BASE_URL);
  });

  test("일부 필드만 넘기면 나머지는 기본값", () => {
    store.applyLlmRuntimeConfig({ localModel: "only-model" });
    expect(store.getLocalModel()).toBe("only-model");
    expect(store.getLlmMatcherEnabled()).toBe(true);
  });
});

describe("UI 컨텍스트 (localStorage 있음)", () => {
  test("저장된 설정을 읽고, readLlmRuntimeConfig가 스냅샷으로 묶는다", () => {
    vi.stubGlobal("localStorage", fakeLocalStorage());
    store.setLocalModel("  gemma  ");
    store.setLocalBaseUrl("http://llm.test:9000/v1");
    store.setAnthropicBaseUrl("https://gw.test/anthropic/");
    store.setLlmMatcherEnabled(false);

    expect(store.readLlmRuntimeConfig()).toEqual({
      anthropicBaseUrl: "https://gw.test/anthropic",
      localBaseUrl: "http://llm.test:9000",
      localModel: "gemma",
      matcherEnabled: false,
    });
  });

  test("UI에서 읽은 스냅샷을 Service Worker에 적용하면 같은 값이 보인다 (메시지 왕복)", () => {
    vi.stubGlobal("localStorage", fakeLocalStorage());
    store.setLocalModel("gemma");
    store.setLlmMatcherEnabled(false);
    const snapshot = JSON.parse(JSON.stringify(store.readLlmRuntimeConfig()));

    vi.stubGlobal("localStorage", undefined); // SW로 전환
    expect(store.getLocalModel()).toBe(store.DEFAULT_LOCAL_MODEL);
    store.applyLlmRuntimeConfig(snapshot);
    expect(store.getLocalModel()).toBe("gemma");
    expect(store.getLlmMatcherEnabled()).toBe(false);
  });

  test("override가 저장된 값보다 우선한다", () => {
    vi.stubGlobal("localStorage", fakeLocalStorage());
    store.setLocalModel("stored");
    store.applyLlmRuntimeConfig({ localModel: "override" });
    expect(store.getLocalModel()).toBe("override");
  });
});
