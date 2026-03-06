const API_KEY_STORAGE_KEY = "flux_openai_api_key";
const STEP_DELAY_KEY = "flux_step_delay_ms";

export function getApiKey(): string | null {
  return localStorage.getItem(API_KEY_STORAGE_KEY);
}

export function setApiKey(key: string): void {
  localStorage.setItem(API_KEY_STORAGE_KEY, key);
}

export function clearApiKey(): void {
  localStorage.removeItem(API_KEY_STORAGE_KEY);
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
