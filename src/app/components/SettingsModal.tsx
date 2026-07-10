import { useState, useEffect } from "react";
import { X, Eye, EyeOff, CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import {
  getApiKeyForProvider,
  setApiKeyForProvider,
  clearApiKeyForProvider,
  getLlmProvider,
  setLlmProvider,
  LLM_PROVIDER_OPTIONS,
  getAnthropicBaseUrl,
  setAnthropicBaseUrl,
  DEFAULT_ANTHROPIC_BASE_URL,
  getLocalBaseUrl,
  setLocalBaseUrl,
  normalizeLocalBaseUrl,
  getLocalModel,
  setLocalModel,
  getLlmMatcherEnabled,
  setLlmMatcherEnabled,
  type LlmProvider,
} from "@/stores/settingsStore";
import { Button } from "./ui/button";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

type TestResult =
  | { kind: "idle" }
  | { kind: "testing" }
  | { kind: "ok"; message: string }
  | { kind: "fail"; message: string };

const TEST_RESULT_AUTO_HIDE_MS = 6000;

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const [key, setKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState(false);
  const [provider, setProvider] = useState<LlmProvider>("openai");
  const [testResult, setTestResult] = useState<TestResult>({ kind: "idle" });
  const [anthropicBaseUrl, setAnthropicBaseUrlInput] = useState("");
  const [localBaseUrl, setLocalBaseUrlInput] = useState("");
  const [localModel, setLocalModelInput] = useState("");
  const [matcherEnabled, setMatcherEnabledState] = useState(true);

  useEffect(() => {
    if (open) {
      const currentProvider = getLlmProvider();
      setProvider(currentProvider);
      setKey(getApiKeyForProvider(currentProvider) ?? "");
      const storedBaseUrl = getAnthropicBaseUrl();
      setAnthropicBaseUrlInput(
        storedBaseUrl === DEFAULT_ANTHROPIC_BASE_URL ? "" : storedBaseUrl,
      );
      setLocalBaseUrlInput(getLocalBaseUrl());
      setLocalModelInput(getLocalModel());
      setMatcherEnabledState(getLlmMatcherEnabled());
      setSaved(false);
      setTestResult({ kind: "idle" });
    }
  }, [open]);

  if (!open) return null;

  const handleSave = () => {
    const trimmed = key.trim();
    if (trimmed) {
      setApiKeyForProvider(provider, trimmed);
    } else {
      clearApiKeyForProvider(provider);
    }
    setLlmProvider(provider);
    setAnthropicBaseUrl(anthropicBaseUrl);
    setLocalBaseUrl(localBaseUrl);
    setLocalModel(localModel);
    setLlmMatcherEnabled(matcherEnabled);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  // 입력된 키로 가장 가벼운 호출을 보내 키 유효성·잔고·서버 상태를 한 번에 진단한다.
  // OpenAI는 무료 GET /v1/models, Anthropic은 max_tokens=1 짧은 POST(미세 과금).
  const handleTest = async () => {
    const trimmed = key.trim();
    // 로컬 LLM은 키 없이 열려 있는 서버가 많아 키를 필수로 요구하지 않는다.
    if (!trimmed && provider !== "local") {
      setTestResult({ kind: "fail", message: "키를 먼저 입력하세요." });
      return;
    }
    setTestResult({ kind: "testing" });
    try {
      // 키 테스트도 실제 호출과 같은 base URL을 써야 한다. 사내 게이트웨이를 입력했는데
      // 테스트만 api.anthropic.com으로 가면 회사 방화벽에 막혀 결과가 무의미해진다.
      const result = await testApiKey(provider, trimmed, {
        anthropicBaseUrl: normalizeBaseUrl(anthropicBaseUrl) || DEFAULT_ANTHROPIC_BASE_URL,
        localBaseUrl: normalizeLocalBaseUrl(localBaseUrl),
        localModel: localModel.trim(),
      });
      setTestResult(result);
    } catch (err) {
      setTestResult({
        kind: "fail",
        message: `네트워크 오류: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
    setTimeout(() => {
      setTestResult((prev) => (prev.kind === "ok" || prev.kind === "fail" ? { kind: "idle" } : prev));
    }, TEST_RESULT_AUTO_HIDE_MS);
  };

  const maskedKey = key
    ? `${key.slice(0, 7)}${"•".repeat(Math.max(0, key.length - 11))}${key.slice(-4)}`
    : "";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="relative bg-white rounded-2xl shadow-2xl w-[340px] max-w-[90vw] animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--flux-border-light)]">
          <h3 className="font-bold text-sm text-[var(--flux-text-default)]">
            설정
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-full hover:bg-[var(--flux-bg-subtle)] text-[var(--flux-text-muted)] hover:text-[var(--flux-text-default)] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="block text-xs font-bold text-[var(--flux-text-muted)] mb-1.5">
              LLM 모델
            </label>
            <p className="text-[10px] text-[var(--flux-text-muted)] mb-2">
              현재 사용 중:{" "}
              <span className="font-semibold text-[var(--flux-text-default)]">
                {LLM_PROVIDER_OPTIONS.find((o) => o.value === provider)?.label ?? provider}
              </span>
            </p>
            <div className="flex gap-1.5">
              {LLM_PROVIDER_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    const trimmed = key.trim();
                    if (trimmed) {
                      setApiKeyForProvider(provider, trimmed);
                    }
                    setProvider(opt.value);
                    setKey(getApiKeyForProvider(opt.value) ?? "");
                  }}
                  className={`flex-1 px-3 py-2 rounded-lg text-xs font-bold border transition-all ${
                    provider === opt.value
                      ? "bg-[var(--flux-primary)] text-white border-[var(--flux-primary)]"
                      : "bg-[var(--flux-bg-subtle)] text-[var(--flux-text-muted)] border-[var(--flux-border)] hover:border-[var(--flux-primary)] hover:text-[var(--flux-primary)]"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-[var(--flux-text-muted)] mt-1.5 leading-relaxed">
              DRR → DSL 변환에 사용할 모델을 선택합니다.
            </p>
          </div>

          <div>
            <label className="block text-xs font-bold text-[var(--flux-text-muted)] mb-1.5">
              {provider === "anthropic"
                ? "Anthropic API Key"
                : provider === "local"
                  ? "로컬 LLM API Key (선택)"
                  : "OpenAI API Key"}
            </label>
            <div className="relative">
              <input
                type={showKey ? "text" : "password"}
                value={showKey ? key : maskedKey || key}
                onChange={(e) => {
                  setKey(e.target.value);
                  setSaved(false);
                }}
                onFocus={() => setShowKey(true)}
                placeholder={
                  provider === "anthropic"
                    ? "sk-ant-..."
                    : provider === "local"
                      ? "키가 없으면 비워두세요"
                      : "sk-..."
                }
                className="w-full px-3 py-2.5 pr-10 text-xs font-mono bg-[var(--flux-bg-subtle)] border border-[var(--flux-border)] rounded-lg outline-none focus:border-[var(--flux-primary)] focus:ring-2 focus:ring-[var(--flux-ring)] transition-all"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--flux-text-muted)] hover:text-[var(--flux-text-default)] transition-colors"
              >
                {showKey ? (
                  <EyeOff className="w-3.5 h-3.5" />
                ) : (
                  <Eye className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
            <p className="text-[10px] text-[var(--flux-text-muted)] mt-1.5 leading-relaxed">
              DRR → DSL 변환에 사용됩니다. 키는 브라우저 localStorage에만
              저장됩니다.
            </p>

            {provider === "anthropic" && (
              <div className="mt-3">
                <label className="block text-xs font-bold text-[var(--flux-text-muted)] mb-1.5">
                  Anthropic Base URL <span className="font-normal">(선택)</span>
                </label>
                <input
                  type="text"
                  value={anthropicBaseUrl}
                  onChange={(e) => {
                    setAnthropicBaseUrlInput(e.target.value);
                    setSaved(false);
                  }}
                  placeholder="https://api.anthropic.com (비우면 기본값)"
                  className="w-full px-3 py-2.5 text-xs font-mono bg-[var(--flux-bg-subtle)] border border-[var(--flux-border)] rounded-lg outline-none focus:border-[var(--flux-primary)] focus:ring-2 focus:ring-[var(--flux-ring)] transition-all"
                />
                <p className="text-[10px] text-[var(--flux-text-muted)] mt-1.5 leading-relaxed">
                  회사 방화벽이 api.anthropic.com을 막는 경우, 사내 Anthropic
                  호환 게이트웨이 주소를 입력하세요. 예:{" "}
                  <code className="text-[10px]">
                    https://seulgivibe.lgudax.cool/anthropic
                  </code>
                </p>
              </div>
            )}

            {provider === "local" && (
              <div className="mt-3 space-y-3">
                <div>
                  <label className="block text-xs font-bold text-[var(--flux-text-muted)] mb-1.5">
                    Base URL
                  </label>
                  <input
                    type="text"
                    value={localBaseUrl}
                    onChange={(e) => {
                      setLocalBaseUrlInput(e.target.value);
                      setSaved(false);
                    }}
                    placeholder="http://172.24.63.178:180"
                    className="w-full px-3 py-2.5 text-xs font-mono bg-[var(--flux-bg-subtle)] border border-[var(--flux-border)] rounded-lg outline-none focus:border-[var(--flux-primary)] focus:ring-2 focus:ring-[var(--flux-ring)] transition-all"
                  />
                  <p className="text-[10px] text-[var(--flux-text-muted)] mt-1.5 leading-relaxed">
                    OpenAI 호환 로컬/사내 LLM 주소. Cline의 Base URL과 같은 값을
                    넣으세요. <code className="text-[10px]">/v1/chat/completions</code>{" "}
                    는 자동으로 붙습니다.
                  </p>
                </div>
                <div>
                  <label className="block text-xs font-bold text-[var(--flux-text-muted)] mb-1.5">
                    Model ID
                  </label>
                  <input
                    type="text"
                    value={localModel}
                    onChange={(e) => {
                      setLocalModelInput(e.target.value);
                      setSaved(false);
                    }}
                    placeholder="gemma4:26b"
                    className="w-full px-3 py-2.5 text-xs font-mono bg-[var(--flux-bg-subtle)] border border-[var(--flux-border)] rounded-lg outline-none focus:border-[var(--flux-primary)] focus:ring-2 focus:ring-[var(--flux-ring)] transition-all"
                  />
                  <p className="text-[10px] text-[var(--flux-text-muted)] mt-1.5 leading-relaxed">
                    Cline의 Model ID와 같은 값을 넣으세요.
                  </p>
                </div>
              </div>
            )}

            <div className="mt-4 pt-4 border-t border-[var(--flux-border-light)]">
              <label className="flex items-start justify-between gap-3 cursor-pointer">
                <div className="flex-1">
                  <div className="text-xs font-bold text-[var(--flux-text-default)]">
                    LLM 매처(AI fallback) 사용
                  </div>
                  <p className="text-[10px] text-[var(--flux-text-muted)] mt-1 leading-relaxed">
                    끄면 코드 기반 매칭만 사용합니다. 사내망 DLP가 매처 호출을
                    503으로 막아 매 스텝마다 시간이 낭비될 때 끄세요.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={matcherEnabled}
                  onClick={() => {
                    setMatcherEnabledState((v) => !v);
                    setSaved(false);
                  }}
                  className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                    matcherEnabled
                      ? "bg-[var(--flux-primary)]"
                      : "bg-[var(--flux-border)]"
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                      matcherEnabled ? "translate-x-4" : "translate-x-0.5"
                    }`}
                  />
                </button>
              </label>
            </div>

            {testResult.kind !== "idle" && (
              <div
                className={`mt-2 px-2.5 py-2 rounded-md text-[10px] leading-relaxed flex items-start gap-1.5 ${
                  testResult.kind === "ok"
                    ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                    : testResult.kind === "fail"
                      ? "bg-rose-50 text-rose-700 border border-rose-200"
                      : "bg-[var(--flux-bg-subtle)] text-[var(--flux-text-muted)] border border-[var(--flux-border)]"
                }`}
              >
                {testResult.kind === "testing" && (
                  <>
                    <Loader2 className="w-3 h-3 mt-0.5 animate-spin shrink-0" />
                    <span>키 테스트 중…</span>
                  </>
                )}
                {testResult.kind === "ok" && (
                  <>
                    <CheckCircle className="w-3 h-3 mt-0.5 shrink-0" />
                    <span>{testResult.message}</span>
                  </>
                )}
                {testResult.kind === "fail" && (
                  <>
                    <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
                    <span>{testResult.message}</span>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="px-5 py-3 border-t border-[var(--flux-border-light)] flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleTest}
            disabled={testResult.kind === "testing"}
            className="text-xs font-bold py-2.5 px-3 rounded-lg"
          >
            키 테스트
          </Button>
          <Button
            variant="brand"
            size="sm"
            onClick={handleSave}
            className="flex-1 text-xs font-bold py-2.5 rounded-lg flex items-center justify-center gap-1.5"
          >
            {saved ? (
              <>
                <CheckCircle className="w-3.5 h-3.5" /> 저장됨
              </>
            ) : (
              "저장"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

const OPENAI_BASE_URL = "https://api.openai.com";
const OPENAI_MODELS_PATH = "/v1/models";
const OPENAI_CHAT_PATH = "/v1/chat/completions";
const ANTHROPIC_MESSAGES_PATH = "/v1/messages";
const ANTHROPIC_API_VERSION = "2023-06-01";
// 매처와 동일한 모델로 ping해야 endpoint 단위 장애·권한 문제를 정확히 진단할 수 있다.
const OPENAI_MATCHER_MODEL = "gpt-4o-mini";

function normalizeBaseUrl(url: string): string {
  return (url || "").trim().replace(/\/+$/, "");
}

async function testApiKey(
  provider: LlmProvider,
  apiKey: string,
  options: { anthropicBaseUrl: string; localBaseUrl: string; localModel: string },
): Promise<TestResult> {
  if (provider === "openai") {
    return testOpenAICompatible("OpenAI", OPENAI_BASE_URL, apiKey, OPENAI_MATCHER_MODEL);
  }
  if (provider === "local") {
    if (!options.localBaseUrl) {
      return { kind: "fail", message: "Base URL을 먼저 입력하세요." };
    }
    if (!options.localModel) {
      return { kind: "fail", message: "Model ID를 먼저 입력하세요." };
    }
    return testOpenAICompatible(
      "Local LLM",
      options.localBaseUrl,
      apiKey,
      options.localModel,
      { skipModelsCheck: true },
    );
  }
  return testAnthropicKey(apiKey, options.anthropicBaseUrl);
}

// OpenAI 호환 endpoint(공식 OpenAI + 로컬/사내 LLM 공용) 진단.
// OpenAI 공식은 두 단계로 나눠 "키는 멀쩡한데 chat completions만 503" 구분이 가능하다:
//   1) GET /v1/models  — 키·기본 인증/네트워크 확인 (무료)
//   2) POST /v1/chat/completions (max_tokens=1) — 실제 매처 endpoint·모델 권한 확인
// 로컬 서버는 /v1/models 를 지원하지 않을 수 있어(skipModelsCheck) chat completions만 친다.
async function testOpenAICompatible(
  label: string,
  baseUrl: string,
  apiKey: string,
  model: string,
  options?: { skipModelsCheck?: boolean },
): Promise<TestResult> {
  const base = normalizeBaseUrl(baseUrl);
  // 로컬은 키가 없을 수 있다. 있을 때만 Authorization 헤더를 붙인다.
  const authHeaders: Record<string, string> = apiKey
    ? { Authorization: `Bearer ${apiKey}` }
    : {};

  if (!options?.skipModelsCheck) {
    const modelsRes = await fetch(`${base}${OPENAI_MODELS_PATH}`, {
      method: "GET",
      headers: authHeaders,
    });
    if (!modelsRes.ok) {
      const reason = extractErrorReason(await modelsRes.text().catch(() => ""));
      return {
        kind: "fail",
        message: `[GET /v1/models] ${classifyHttpFailure(label, modelsRes.status, reason)}`,
      };
    }
  }

  const chatRes = await fetch(`${base}${OPENAI_CHAT_PATH}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 1,
      temperature: 0,
    }),
  });
  if (chatRes.ok) {
    return {
      kind: "ok",
      message: `${label} + ${model} 호출 정상 ✓`,
    };
  }
  const reason = extractErrorReason(await chatRes.text().catch(() => ""));
  return {
    kind: "fail",
    message: `[POST /v1/chat/completions] ${classifyHttpFailure(label, chatRes.status, reason)}`,
  };
}

async function testAnthropicKey(
  apiKey: string,
  baseUrl: string,
): Promise<TestResult> {
  const normalized = normalizeBaseUrl(baseUrl);
  const url = `${normalized}${ANTHROPIC_MESSAGES_PATH}`;
  // 사내 게이트웨이(JWT 기반)는 보통 Authorization: Bearer를, Anthropic 공식은 x-api-key를 받는다.
  // custom base URL이면 두 헤더 모두 실어서 어느 쪽 게이트웨이든 받게 한다.
  // (공식 endpoint는 x-api-key만 보고 Authorization은 무시하므로 안전)
  const isCustomGateway = normalized && normalized !== "https://api.anthropic.com";
  // 사내 게이트웨이가 transparent proxy로 동작해 헤더를 그대로 anthropic에 forward하는 경우가 있다.
  // (실제로 안 넣으면 anthropic이 "CORS requests must set ..." 401을 돌려줌)
  // 게이트웨이용 Authorization Bearer는 추가로만 붙이고, anthropic 표준 헤더는 항상 유지한다.
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": ANTHROPIC_API_VERSION,
    "anthropic-dangerous-direct-browser-access": "true",
  };
  if (isCustomGateway) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      // alias("haiku")만으론 게이트웨이 가격 테이블이 버전 특정을 못해
      // "Model price not found"를 뱉는 경우가 있어 풀 모델명으로 명시.
      model: "claude-haiku-4-5",
      max_tokens: 1,
      messages: [{ role: "user", content: "ping" }],
    }),
  });

  if (response.ok) {
    const isCustom = baseUrl && baseUrl !== "https://api.anthropic.com";
    return {
      kind: "ok",
      message: isCustom
        ? `사내 게이트웨이(${baseUrl}) Anthropic 호출 정상 ✓`
        : "Anthropic 키 사용 가능 ✓",
    };
  }

  const bodyText = await response.text().catch(() => "");
  const reason = extractErrorReason(bodyText);
  return {
    kind: "fail",
    message: classifyHttpFailure("Anthropic", response.status, reason),
  };
}

function extractErrorReason(bodyText: string): string {
  if (!bodyText) return "";
  try {
    const parsed = JSON.parse(bodyText) as {
      error?: { code?: string; type?: string; message?: string };
      message?: string;
      detail?: string;
    };
    const err = parsed.error;
    if (err && typeof err === "object") {
      const fields = [err.code, err.type, err.message].filter(Boolean);
      if (fields.length > 0) return fields.join(" / ");
    }
    // 게이트웨이가 표준 anthropic 형식이 아닐 수 있어 message/detail 폴백
    if (parsed.message) return String(parsed.message);
    if (parsed.detail) return String(parsed.detail);
    // 알 수 없는 JSON 형식 — 디버깅용으로 일부 그대로 보여준다
    return JSON.stringify(parsed).slice(0, 200);
  } catch {
    return bodyText.slice(0, 200);
  }
}

function classifyHttpFailure(
  providerLabel: string,
  status: number,
  reason: string,
): string {
  const suffix = reason ? ` — ${reason}` : "";
  if (status === 401)
    return `${providerLabel} 401: 키가 무효합니다${suffix}`;
  if (status === 403)
    return `${providerLabel} 403: 권한 없음 (모델 접근 불가 가능)${suffix}`;
  if (status === 429) {
    if (/insufficient_quota|quota/i.test(reason)) {
      return `${providerLabel} 429: 잔고/한도 부족 — 결제수단 등록 또는 충전 필요${suffix}`;
    }
    return `${providerLabel} 429: rate limit 초과 (잠시 후 재시도)${suffix}`;
  }
  if (status >= 500 && status < 600)
    return `${providerLabel} ${status}: 서버 일시 장애 — 당신 잘못 아님, 잠시 후 재시도${suffix}`;
  return `${providerLabel} ${status}${suffix || " — 알 수 없는 오류"}`;
}
