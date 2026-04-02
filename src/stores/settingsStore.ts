const OPENAI_API_KEY_STORAGE = "flux_openai_api_key";
const ANTHROPIC_API_KEY_STORAGE = "flux_anthropic_api_key";
const STEP_DELAY_KEY = "flux_step_delay_ms";
const LLM_PROVIDER_KEY = "flux_llm_provider";
const API_KEY_MIGRATION_DONE_KEY = "flux_api_key_per_provider_migrated";

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
