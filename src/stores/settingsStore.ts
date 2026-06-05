const OPENAI_API_KEY_STORAGE = "flux_openai_api_key";
const ANTHROPIC_API_KEY_STORAGE = "flux_anthropic_api_key";
const STEP_DELAY_KEY = "flux_step_delay_ms";
const LLM_PROVIDER_KEY = "flux_llm_provider";
const API_KEY_MIGRATION_DONE_KEY = "flux_api_key_per_provider_migrated";
// Anthropic 호환 사내 게이트웨이(예: https://seulgivibe.lgudax.cool/anthropic)를 쓰면
// 회사 방화벽이 외부 api.anthropic.com을 막아도 정상 호출 가능하다.
const ANTHROPIC_BASE_URL_STORAGE = "flux_anthropic_base_url";
const DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com";
// 사내망 DLP가 매처 호출을 503 Application Blocked로 막을 때, 재시도 3초씩 낭비 + 콘솔 노이즈
// 없이 fallback(unique-text → clickByTextWithContext)으로만 돌리고 싶을 수 있다.
const LLM_MATCHER_ENABLED_STORAGE = "flux_llm_matcher_enabled";

export type LlmProvider = "openai" | "anthropic";

const API_KEY_STORAGE_BY_PROVIDER: Record<LlmProvider, string> = {
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

export const LLM_PROVIDER_OPTIONS: { value: LlmProvider; label: string; model: string }[] = [
  { value: "openai", label: "GPT-4o", model: "gpt-4o" },
  { value: "anthropic", label: "Claude Sonnet 4.6", model: "claude-sonnet-4-6" },
];

export function getLlmProvider(): LlmProvider {
  if (typeof localStorage === "undefined") return "openai";
  const raw = localStorage.getItem(LLM_PROVIDER_KEY);
  if (raw === "openai" || raw === "anthropic") return raw;
  return "openai";
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

/** Anthropic 호출에 쓸 base URL. 비어있으면 공식 endpoint. 끝 슬래시는 정규화한다. */
export function getAnthropicBaseUrl(): string {
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

/** LLM 매처(AI fallback) 사용 여부. 기본값은 켜짐. */
export function getLlmMatcherEnabled(): boolean {
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
