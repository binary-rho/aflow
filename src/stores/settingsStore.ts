const OPENAI_API_KEY_STORAGE = "flux_openai_api_key";
const ANTHROPIC_API_KEY_STORAGE = "flux_anthropic_api_key";
const STEP_DELAY_KEY = "flux_step_delay_ms";
const LLM_PROVIDER_KEY = "flux_llm_provider";
const API_KEY_MIGRATION_DONE_KEY = "flux_api_key_per_provider_migrated";
// Anthropic 호환 사내 게이트웨이(예: https://seulgivibe.lgudax.cool/anthropic)를 쓰면
// 회사 방화벽이 외부 api.anthropic.com을 막아도 정상 호출 가능하다.
const ANTHROPIC_BASE_URL_STORAGE = "flux_anthropic_base_url";
const DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com";
// OpenAI 호환 로컬/사내 LLM(예: Ollama·LM Studio·vLLM)을 위한
// 독립 슬롯. base URL·모델명·키를 OpenAI/Anthropic과 별도로 저장해 서로 덮어쓰지 않는다.
// 호출은 OpenAI 호환 /v1/chat/completions 를 재사용한다.
const LOCAL_BASE_URL_STORAGE = "flux_local_base_url";
// scheme://host:port 까지만. /v1/chat/completions 는 호출 시 코드가 붙인다.
// (사용자가 .../v1 이나 .../v1/chat/completions 를 넣어도 normalizeLocalBaseUrl이 떼어냄)
const DEFAULT_LOCAL_BASE_URL = "http://digitalplatform-iop.cloud:18086";
const LOCAL_MODEL_STORAGE = "flux_local_model";
const DEFAULT_LOCAL_MODEL = "gemma4:26b";
const LOCAL_API_KEY_STORAGE = "flux_local_api_key";
// 사내망 DLP가 매처 호출을 503 Application Blocked로 막을 때, 재시도 3초씩 낭비 + 콘솔 노이즈
// 없이 fallback(unique-text → clickByTextWithContext)으로만 돌리고 싶을 수 있다.
const LLM_MATCHER_ENABLED_STORAGE = "flux_llm_matcher_enabled";

export type LlmProvider = "local" | "openai" | "anthropic";

const API_KEY_STORAGE_BY_PROVIDER: Record<LlmProvider, string> = {
  local: LOCAL_API_KEY_STORAGE,
  openai: OPENAI_API_KEY_STORAGE,
  anthropic: ANTHROPIC_API_KEY_STORAGE,
};

/**
 * 예전에 키가 한 통에만 저장되던 시절 데이터를 provider별 슬롯으로 한 번만 복사합니다.
 * 이미 사라진 키는 복구할 수 없고, 앞으로 provider 바꿀 때 서로 덮어쓰지 않도록만 보장합니다.
 */
function migrateApiKeysPerProviderOnce(): void {
  if (typeof localStorage === "undefined") return;
  if (localStorage.getItem(API_KEY_MIGRATION_DONE_KEY) === "1") return;

  const legacyValue = localStorage.getItem(OPENAI_API_KEY_STORAGE);
  const anthropicValue = localStorage.getItem(ANTHROPIC_API_KEY_STORAGE);

  if (legacyValue && !anthropicValue) {
    localStorage.setItem(ANTHROPIC_API_KEY_STORAGE, legacyValue);
  }

  localStorage.setItem(API_KEY_MIGRATION_DONE_KEY, "1");
}

migrateApiKeysPerProviderOnce();

// 로컬 LLM의 model은 런타임에 getLocalModel()로 덮어쓰므로 여기 값은 표시용 기본값이다.
export const LLM_PROVIDER_OPTIONS: { value: LlmProvider; label: string; model: string }[] = [
  { value: "local", label: "로컬 LLM", model: DEFAULT_LOCAL_MODEL },
  { value: "openai", label: "GPT-4o", model: "gpt-4o" },
  { value: "anthropic", label: "Claude", model: "claude-sonnet-4-6" },
];

export function getLlmProvider(): LlmProvider {
  if (typeof localStorage === "undefined") return "local";
  const raw = localStorage.getItem(LLM_PROVIDER_KEY);
  if (raw === "local" || raw === "openai" || raw === "anthropic") return raw;
  return "local";
}

export function setLlmProvider(provider: LlmProvider): void {
  localStorage.setItem(LLM_PROVIDER_KEY, provider);
}

export function getApiKeyForProvider(provider: LlmProvider): string | null {
  if (typeof localStorage === "undefined") return null;
  const storageKey = API_KEY_STORAGE_BY_PROVIDER[provider];
  return localStorage.getItem(storageKey);
}

export function setApiKeyForProvider(provider: LlmProvider, key: string): void {
  const storageKey = API_KEY_STORAGE_BY_PROVIDER[provider];
  localStorage.setItem(storageKey, key);
}

export function clearApiKeyForProvider(provider: LlmProvider): void {
  const storageKey = API_KEY_STORAGE_BY_PROVIDER[provider];
  localStorage.removeItem(storageKey);
}

/** 현재 선택된 LLM provider에 해당하는 API 키를 반환합니다. */
export function getApiKey(): string | null {
  return getApiKeyForProvider(getLlmProvider());
}

/**
 * LLM 런타임 설정 스냅샷.
 *
 * 시나리오 실행(runner/domMatcher)은 MV3 Service Worker에서 돌고, SW에는
 * localStorage가 없다. 그래서 UI(패널)가 RUN_SCENARIO 메시지에 이 스냅샷을 실어
 * 보내고, SW는 applyLlmRuntimeConfig()로 적용한다. 적용된 값은 아래 getter들이
 * localStorage보다 우선해서 쓴다. (UI 컨텍스트에서는 override가 null → 기존 동작)
 */
export interface LlmRuntimeConfig {
  anthropicBaseUrl: string;
  localBaseUrl: string;
  localModel: string;
  matcherEnabled: boolean;
}

let runtimeOverride: Partial<LlmRuntimeConfig> | null = null;

/** UI 컨텍스트에서 현재 저장된 설정을 스냅샷으로 읽는다. SW로 보낼 때 사용. */
export function readLlmRuntimeConfig(): LlmRuntimeConfig {
  return {
    anthropicBaseUrl: getAnthropicBaseUrl(),
    localBaseUrl: getLocalBaseUrl(),
    localModel: getLocalModel(),
    matcherEnabled: getLlmMatcherEnabled(),
  };
}

/** SW에서 실행 시작 시 호출. null/undefined면 override 해제. */
export function applyLlmRuntimeConfig(
  config: Partial<LlmRuntimeConfig> | null | undefined,
): void {
  runtimeOverride = config ?? null;
}

/** Anthropic 호출에 쓸 base URL. 비어있으면 공식 endpoint. 끝 슬래시는 정규화한다. */
export function getAnthropicBaseUrl(): string {
  const overridden = runtimeOverride?.anthropicBaseUrl?.trim();
  if (overridden) return overridden.replace(/\/+$/, "");
  if (typeof localStorage === "undefined") return DEFAULT_ANTHROPIC_BASE_URL;
  const raw = (localStorage.getItem(ANTHROPIC_BASE_URL_STORAGE) || "").trim();
  if (!raw) return DEFAULT_ANTHROPIC_BASE_URL;
  return raw.replace(/\/+$/, "");
}

export function setAnthropicBaseUrl(url: string): void {
  const trimmed = url.trim();
  if (!trimmed) {
    localStorage.removeItem(ANTHROPIC_BASE_URL_STORAGE);
    return;
  }
  localStorage.setItem(ANTHROPIC_BASE_URL_STORAGE, trimmed);
}

export { DEFAULT_ANTHROPIC_BASE_URL };

/**
 * 로컬 LLM 호출에 쓸 base URL. OpenAI 호환 /v1/chat/completions 를 붙여서 호출한다.
 * 사용자가 넣은 scheme(http/https)·포트는 그대로 보존한다.
 * Cline처럼 뒤에 /v1(또는 /v1/chat/completions)까지 붙여 넣어도 /v1/v1 중복이 안 되게
 * 끝의 슬래시·chat/completions·v1 경로를 정규화해 scheme://host:port 형태로 되돌린다.
 */
export function normalizeLocalBaseUrl(raw: string): string {
  return raw
    .trim()
    .replace(/\/+$/, "") // 끝 슬래시
    .replace(/\/chat\/completions$/i, "") // 전체 경로를 넣은 경우
    .replace(/\/v1$/i, ""); // /v1 접미사
}

export function getLocalBaseUrl(): string {
  const overridden = runtimeOverride?.localBaseUrl?.trim();
  if (overridden) return normalizeLocalBaseUrl(overridden);
  if (typeof localStorage === "undefined") return DEFAULT_LOCAL_BASE_URL;
  const raw = (localStorage.getItem(LOCAL_BASE_URL_STORAGE) || "").trim();
  if (!raw) return DEFAULT_LOCAL_BASE_URL;
  return normalizeLocalBaseUrl(raw);
}

export function setLocalBaseUrl(url: string): void {
  const trimmed = url.trim();
  if (!trimmed) {
    localStorage.removeItem(LOCAL_BASE_URL_STORAGE);
    return;
  }
  localStorage.setItem(LOCAL_BASE_URL_STORAGE, trimmed);
}

/**
 * 로컬 LLM 모델 ID. 로컬 서버는 gpt-4o가 아니라 gemma4:26b 같은 자체 모델명을 요구하므로
 * 사용자가 직접 지정할 수 있어야 한다. 비우면 기본값(gemma4:26b).
 */
export function getLocalModel(): string {
  const overridden = runtimeOverride?.localModel?.trim();
  if (overridden) return overridden;
  if (typeof localStorage === "undefined") return DEFAULT_LOCAL_MODEL;
  const raw = (localStorage.getItem(LOCAL_MODEL_STORAGE) || "").trim();
  return raw || DEFAULT_LOCAL_MODEL;
}

export function setLocalModel(model: string): void {
  const trimmed = model.trim();
  if (!trimmed) {
    localStorage.removeItem(LOCAL_MODEL_STORAGE);
    return;
  }
  localStorage.setItem(LOCAL_MODEL_STORAGE, trimmed);
}

export { DEFAULT_LOCAL_BASE_URL, DEFAULT_LOCAL_MODEL };

/** LLM 매처(AI fallback) 사용 여부. 기본값은 켜짐. */
export function getLlmMatcherEnabled(): boolean {
  if (typeof runtimeOverride?.matcherEnabled === "boolean") {
    return runtimeOverride.matcherEnabled;
  }
  if (typeof localStorage === "undefined") return true;
  const raw = localStorage.getItem(LLM_MATCHER_ENABLED_STORAGE);
  if (raw === "0" || raw === "false") return false;
  return true;
}

export function setLlmMatcherEnabled(enabled: boolean): void {
  localStorage.setItem(LLM_MATCHER_ENABLED_STORAGE, enabled ? "1" : "0");
}

export type StepDelayPreset = "slow" | "normal" | "fast";

const STEP_DELAY_PRESETS: Record<StepDelayPreset, number> = {
  slow: 3000,
  normal: 1000,
  fast: 200,
};

export function getStepDelayMs(): number {
  const raw = localStorage.getItem(STEP_DELAY_KEY);
  if (raw === "slow" || raw === "normal" || raw === "fast") {
    return STEP_DELAY_PRESETS[raw];
  }
  const n = parseInt(raw ?? "", 10);
  if (Number.isFinite(n) && n >= 0) return n;
  return STEP_DELAY_PRESETS.normal;
}

export function setStepDelayPreset(preset: StepDelayPreset): void {
  localStorage.setItem(STEP_DELAY_KEY, preset);
}

export function getStepDelayPreset(): StepDelayPreset {
  const raw = localStorage.getItem(STEP_DELAY_KEY);
  if (raw === "slow" || raw === "normal" || raw === "fast") return raw;
  return "normal";
}

export { STEP_DELAY_PRESETS };
