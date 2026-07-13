/**
 * 2차 LLM 매칭: 실행 시점의 실제 DOM을 보고 intent(text+context)에 맞는 요소를 찾습니다.
 *
 * 1. 현재 페이지 DOM 요약 캡처 (cdp.captureDOMSnapshot)
 * 2. Fast path: text가 유일하거나 context로 1개로 좁혀지면 LLM 호출 없이 반환
 * 3. Slow path: LLM 2차 호출로 DOM + intent 매칭
 */

import * as cdp from "@/engine/cdp";
import {
  formatPageSummaryForLLM,
  type PageSummaryPayload,
} from "@/services/domSnapshot";
import {
  getLlmProvider,
  getApiKeyForProvider,
  getLlmMatcherEnabled,
  getAnthropicBaseUrl,
  getLocalBaseUrl,
  getLocalModel,
} from "@/stores/settingsStore";
import { textMatches, textMatchesExact, contextMatches } from "@/services/textMatch";
import {
  buildSelectorCacheKey,
  getCachedSelector,
  putCachedSelector,
  invalidateCachedSelector,
} from "@/stores/selectorCacheStore";
import { buildClientActiveScopeScript } from "@/services/scopeResolver";

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_CHAT_PATH = "/v1/chat/completions";
const ANTHROPIC_MESSAGES_PATH = "/v1/messages";
const ANTHROPIC_API_VERSION = "2023-06-01";

// 회사 방화벽이 api.anthropic.com을 직접 막는 경우, 설정에 사내 Anthropic 호환 게이트웨이
// (예: https://seulgivibe.lgudax.cool/anthropic) base URL을 넣어 우회한다.
function buildAnthropicMessagesUrl(): string {
  return `${getAnthropicBaseUrl()}${ANTHROPIC_MESSAGES_PATH}`;
}

// 로컬 LLM 매처도 OpenAI 호환 /v1/chat/completions 를 쓰되 로컬 base URL로 나간다.
function buildLocalChatUrl(): string {
  return `${getLocalBaseUrl()}${OPENAI_CHAT_PATH}`;
}

// 매처는 라벨/요소 식별이라는 단순 분류 작업이라 gpt-4o-mini로도 정확도 충분하고,
// gpt-4o보다 가용성이 좋아 503/과부하 영향을 덜 받는다.
// (시나리오 변환 LLM은 services/llm.ts에서 별도로 gpt-4o 유지)
const OPENAI_MATCHER_MODEL = "gpt-4o-mini";
// 사내 게이트웨이가 모델 가격 테이블에서 alias("sonnet")만으론 버전 특정을 못 해
// "Model price not found"를 뱉는 경우가 있다. 풀 모델명으로 명시한다.
// (Claude Code 모델 메뉴 기준: Sonnet=4.6, Haiku=4.5, Opus=4.8)
const ANTHROPIC_MATCHER_MODEL = "claude-sonnet-4-6";

// LLM 호출은 일시적 5xx/429(서버 과부하·rate limit)에서 자주 막히는데,
// 시나리오 실행 도중 단발성 장애로 폴백 체인 전체가 끊기는 걸 막기 위해
// 작은 백오프로 짧게 두 번까지 재시도한다. 4xx(인증·요청 오류)는 재시도 안 함.
const TRANSIENT_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const LLM_RETRY_BACKOFF_MS = [400, 1200] as const;

async function fetchLlmWithRetry(
  input: RequestInfo,
  init: RequestInit,
): Promise<Response> {
  const maxRetries = LLM_RETRY_BACKOFF_MS.length;
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(input, init);
      if (response.ok || !TRANSIENT_HTTP_STATUSES.has(response.status)) {
        return response;
      }
      if (attempt >= maxRetries) return response;
      console.warn(
        `[flux] matcher API ${response.status} — retrying (${attempt + 1}/${maxRetries})`,
      );
    } catch (err) {
      lastError = err;
      if (attempt >= maxRetries) throw err;
      console.warn(
        `[flux] matcher API network error — retrying (${attempt + 1}/${maxRetries})`,
      );
    }
    await new Promise((resolve) =>
      setTimeout(resolve, LLM_RETRY_BACKOFF_MS[attempt]),
    );
  }
  throw lastError ?? new Error("LLM fetch failed");
}

export interface ElementIntent {
  action: "button.click" | "form.fill";
  text?: string;
  label?: string;
  context?: string;
  gtmText?: string;
}

/** 사후 확인 UI에 보여줄 후보 한 개. */
export interface ElementCandidate {
  selector: string;
  text: string | null;
  context: string | null;
}

export interface ResolvedElement {
  selector: string;
  matchedBy: "unique-text" | "context-match" | "llm" | "cache";
  /** AI도 확신하지 못해 첫 후보로 진행한 경우 true → 사후 확인 대상 */
  ambiguous?: boolean;
  /** 애매했을 때 사용자에게 보여줄 후보 목록(2개+). 확정 시 캐시에 저장. */
  candidates?: ElementCandidate[];
}

/** fastPath 결과: 확정 1개 / 비슷한 후보 N개 / 매칭 없음 */
type FastPathResult =
  | { kind: "resolved"; selector: string; via: "unique-text" | "context-match" }
  | { kind: "candidates"; items: ElementCandidate[] }
  | { kind: "none" };

const MATCHER_PROMPT = `You are a DOM element matcher.
Given an intent and a list of candidate elements (or a page DOM summary), return the CSS selector of the element that best matches the intent.

Rules:
- Each candidate shows: text, context (in ...), and selector (→).
- Choose the ONE element whose meaning matches the intent (text + context).
- Return ONLY the selector string (the value after →). No quotes, no explanation, no JSON.
- If no candidate matches, return exactly: NOT_FOUND
- If two or more candidates are plausible and you cannot confidently decide which one the intent means, return exactly: NOT_SURE`;

async function captureLiveDom(
  tabId: number,
): Promise<PageSummaryPayload | null> {
  const raw = await cdp.captureDOMSnapshot(tabId);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PageSummaryPayload;
  } catch {
    return null;
  }
}

/**
 * 코드 기반 매칭 (LLM 호출 없이). text/context로 ctas/formFields에서 유일한 요소를 찾습니다.
 */
/**
 * 코드 기반 매칭 (LLM 호출 없이). 우선순위 strategy 리스트로 좁힌다.
 * 점수 합산 X — 각 단계는 결정적, 1개로 좁혀지면 즉시 반환.
 */
function tryFastPath(
  summary: PageSummaryPayload,
  intent: ElementIntent,
): FastPathResult {
  if (intent.action === "button.click" && intent.text) {
    const ctas = (summary.ctas || []).filter((c) => c.selector);
    return tryCtaStrategies(ctas, intent);
  }

  if (intent.action === "form.fill" && intent.label) {
    const fields = (summary.formFields || []).filter((f) => f.selector);
    return tryFormFieldStrategies(fields, intent);
  }

  return { kind: "none" };
}

function ctaToCandidate(c: PageSummaryPayload["ctas"][number]): ElementCandidate {
  return { selector: c.selector!, text: c.text ?? c.accessibleName ?? null, context: c.context ?? null };
}
function fieldToCandidate(f: PageSummaryPayload["formFields"][number]): ElementCandidate {
  return { selector: f.selector!, text: f.label ?? f.ariaLabel ?? f.placeholder ?? null, context: f.context ?? null };
}

// LLM 페이로드 축소: 의도(button.click vs form.fill)에 맞는 종류만 + 상위 N개만 보낸다.
// intent 키워드와 매칭되는 항목을 앞쪽으로 정렬해 잘려도 정답이 살아남을 확률을 높인다.
const MAX_SUMMARY_ITEMS_FOR_LLM = 30;

function trimSummaryForIntent(
  summary: PageSummaryPayload,
  intent: ElementIntent,
): PageSummaryPayload {
  const isClick = intent.action === "button.click";
  const isFill = intent.action === "form.fill";

  let ctas = summary.ctas || [];
  let formFields = summary.formFields || [];

  if (isClick && intent.text) {
    const target = intent.text.toLowerCase();
    ctas = [...ctas].sort((a, b) => matchRank(a.text || a.accessibleName, target) - matchRank(b.text || b.accessibleName, target));
  }
  if (isFill && intent.label) {
    const target = intent.label.toLowerCase();
    formFields = [...formFields].sort((a, b) => matchRank(a.label || a.placeholder || a.name, target) - matchRank(b.label || b.placeholder || b.name, target));
  }

  return {
    ...summary,
    ctas: isClick ? ctas.slice(0, MAX_SUMMARY_ITEMS_FOR_LLM) : [],
    formFields: isFill ? formFields.slice(0, MAX_SUMMARY_ITEMS_FOR_LLM) : [],
  };
}

// 0(매칭), 1(미매칭). sort 시 매칭이 앞으로 온다.
function matchRank(candidate: string | null | undefined, target: string): number {
  if (!candidate) return 1;
  return candidate.toLowerCase().includes(target) ? 0 : 1;
}

function tryCtaStrategies(
  ctas: NonNullable<PageSummaryPayload["ctas"]>,
  intent: ElementIntent,
): FastPathResult {
  const target = intent.text!;

  // 1. accessibleName 정확 매치
  const byAccName = ctas.filter((c) => textMatches(c.accessibleName, target));
  if (byAccName.length === 1) {
    return { kind: "resolved", selector: byAccName[0].selector!, via: "unique-text" };
  }

  // 3. text 매칭 — 정확 일치 우선, 없을 때만 부분 포함으로 폴백.
  //    "갤럭시S26"으로 "갤럭시S26+"가 잡히던 문제를 막는다(부분 포함은 접미/접두 충돌).
  const byTextExact = ctas.filter((c) => textMatchesExact(c.text, target));
  const byText = byTextExact.length > 0 ? byTextExact : ctas.filter((c) => textMatches(c.text, target));
  console.log(
    `[flux] tryFastPath: ${byText.length} text matches for "${target}" (${byTextExact.length > 0 ? "exact" : "partial"})`,
  );
  if (byText.length === 1) return { kind: "resolved", selector: byText[0].selector!, via: "unique-text" };
  if (byText.length === 0) return { kind: "none" };

  // 4. text + context로 좁히기 (성공 시 확정)
  if (intent.context) {
    const byContext = byText.filter((c) => contextMatches(c.context, intent.context!));
    if (byContext.length === 1) {
      return { kind: "resolved", selector: byContext[0].selector!, via: "context-match" };
    }
    const byLandmark = byText.filter(
      (c) => c.nearestLandmark && contextMatches(c.nearestLandmark, intent.context!),
    );
    if (byLandmark.length === 1) {
      return { kind: "resolved", selector: byLandmark[0].selector!, via: "context-match" };
    }
    // context로 좁혀 2개+ 남으면 그 좁힌 집합을 후보로 (전체 byText보다 정밀)
    if (byContext.length > 1) {
      return { kind: "candidates", items: byContext.map(ctaToCandidate) };
    }
  }

  // 5. text + gtm
  if (intent.gtmText) {
    const byGtm = byText.filter((c) => c.gtmText && textMatches(c.gtmText, intent.gtmText!));
    if (byGtm.length === 1) return { kind: "resolved", selector: byGtm[0].selector!, via: "context-match" };
  }

  // text는 매칭됐으나 2개+ 남음 → AI에 후보로 위임
  return { kind: "candidates", items: byText.map(ctaToCandidate) };
}

function tryFormFieldStrategies(
  fields: NonNullable<PageSummaryPayload["formFields"]>,
  intent: ElementIntent,
): FastPathResult {
  const target = intent.label!;

  // 1. ariaLabel
  const byAria = fields.filter((f) => textMatches(f.ariaLabel, target));
  if (byAria.length === 1) return { kind: "resolved", selector: byAria[0].selector!, via: "unique-text" };

  // 3. label/placeholder/name — 정확 일치 우선, 없을 때만 부분 포함 폴백.
  const labelExact = (f: (typeof fields)[number]) =>
    textMatchesExact(f.label, target) ||
    textMatchesExact(f.placeholder, target) ||
    textMatchesExact(f.name, target);
  const labelPartial = (f: (typeof fields)[number]) =>
    textMatches(f.label, target) ||
    textMatches(f.placeholder, target) ||
    textMatches(f.name, target);
  const byLabelExact = fields.filter(labelExact);
  const byLabel = byLabelExact.length > 0 ? byLabelExact : fields.filter(labelPartial);
  if (byLabel.length === 1) return { kind: "resolved", selector: byLabel[0].selector!, via: "unique-text" };
  if (byLabel.length === 0) return { kind: "none" };

  // 4. + context
  if (intent.context) {
    const byContext = byLabel.filter((f) =>
      contextMatches(f.context, intent.context!),
    );
    if (byContext.length === 1) return { kind: "resolved", selector: byContext[0].selector!, via: "context-match" };
    if (byContext.length > 1) return { kind: "candidates", items: byContext.map(fieldToCandidate) };
  }

  return { kind: "candidates", items: byLabel.map(fieldToCandidate) };
}

/** AI 응답 분류: 정상 selector / NOT_FOUND / NOT_SURE(애매) */
type LlmVerdict =
  | { kind: "selector"; selector: string }
  | { kind: "not_found" }
  | { kind: "not_sure" };

async function callMatcherLLM(
  summary: PageSummaryPayload,
  intent: ElementIntent,
  apiKey: string,
  providerOverride?: string,
  candidates?: ElementCandidate[],
): Promise<LlmVerdict> {
  const contextPart = intent.context ? ` in context "${intent.context}"` : "";
  const gtmPart = intent.gtmText ? ` (gtm-click-text: "${intent.gtmText}")` : "";
  const intentDesc =
    intent.action === "button.click"
      ? `Click button with text "${intent.text}"${contextPart}${gtmPart}`
      : `Fill form field with label "${intent.label}"${contextPart}${gtmPart}`;

  // 후보가 있으면 전체 요약 대신 그 N개만 정밀 전달(건초더미·잘림 방지). 없으면 전체 요약 폴백.
  let domText: string;
  if (candidates && candidates.length > 0) {
    domText = candidates
      .map((c, i) => {
        const ctx = c.context ? ` in ${c.context}` : "";
        return `  ${i + 1}. "${c.text ?? "(no text)"}"${ctx} → ${c.selector}`;
      })
      .join("\n");
    domText = `candidates:\n${domText}`;
  } else {
    // 전체 summary 폴백 시 페이로드를 의도에 맞게 가볍게 가공:
    //   1) action별로 ctas/formFields 한쪽만 (button.click이면 formFields 불필요, 반대도 마찬가지)
    //   2) 상위 30개로 제한 (회사 DLP가 본문 검사하는 환경에서 ~40KB는 차단됨)
    //   3) intent text/label과 매칭되는 항목을 앞쪽으로 정렬해 잘려도 정답이 남게
    domText = formatPageSummaryForLLM(trimSummaryForIntent(summary, intent));
  }

  const userMessage = `## Candidates / Page DOM:\n${domText}\n\n## Intent:\n${intentDesc}`;
  const provider = providerOverride || getLlmProvider();

  const intentLabel =
    intent.action === "button.click"
      ? `button.click "${intent.text}"`
      : `form.fill "${intent.label}"`;
  console.log(
    `[flux LLM matcher] provider=${provider} intent=${intentLabel}` +
      (intent.context ? ` context="${intent.context}"` : "") +
      (summary.modalActive ? " (modal active)" : ""),
  );
  console.log(
    `[flux LLM matcher] sent: ${summary.ctas?.length ?? 0} ctas, ${summary.formFields?.length ?? 0} formFields, prompt ~${userMessage.length} chars`,
  );
  const startedAt = Date.now();

  let content: string;

  if (provider === "anthropic") {
    const anthropicKey = apiKey || getApiKeyForProvider("anthropic") || "";
    const anthropicBaseUrl = getAnthropicBaseUrl();
    // 사내 게이트웨이는 JWT를 Authorization: Bearer로, Anthropic 공식은 x-api-key로 받는다.
    // custom base URL이면 두 헤더 모두 실어 어느 쪽 게이트웨이든 통과시키고,
    // 공식이면 브라우저 직접 호출 허용 헤더를 붙인다.
    const isCustomGateway = anthropicBaseUrl !== "https://api.anthropic.com";
    // 사내 게이트웨이가 transparent proxy로 헤더를 그대로 anthropic에 forward하므로
    // anthropic-dangerous-direct-browser-access는 항상 보낸다.
    // (안 보내면 anthropic이 "CORS requests must set ..." 401 반환)
    const anthropicHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      "x-api-key": anthropicKey,
      "anthropic-version": ANTHROPIC_API_VERSION,
      "anthropic-dangerous-direct-browser-access": "true",
    };
    if (isCustomGateway) {
      anthropicHeaders["Authorization"] = `Bearer ${anthropicKey}`;
    }
    const response = await fetchLlmWithRetry(buildAnthropicMessagesUrl(), {
      method: "POST",
      headers: anthropicHeaders,
      body: JSON.stringify({
        model: ANTHROPIC_MATCHER_MODEL,
        max_tokens: 200,
        system: MATCHER_PROMPT,
        messages: [{ role: "user", content: userMessage }],
        temperature: 0,
      }),
    });

    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      console.warn(
        `[flux] Anthropic matcher API error: ${response.status} | body: ${bodyText.slice(0, 800)}`,
      );
      return { kind: "not_found" };
    }

    const data = await response.json();
    content = (data.content?.[0]?.text ?? "").trim();
  } else {
    // openai와 local(OpenAI 호환)이 같은 chat completions 스펙을 공유한다.
    const isLocal = provider === "local";
    const url = isLocal ? buildLocalChatUrl() : OPENAI_API_URL;
    const matcherModel = isLocal ? getLocalModel() : OPENAI_MATCHER_MODEL;
    const providerLabel = isLocal ? "Local LLM" : "OpenAI";
    // 로컬은 키 없이 열린 서버가 많다. 키가 있을 때만 Authorization을 붙인다.
    const openAiKey = isLocal ? apiKey || getApiKeyForProvider("local") || "" : apiKey;
    const openAiHeaders: Record<string, string> = { "Content-Type": "application/json" };
    if (openAiKey) {
      openAiHeaders["Authorization"] = `Bearer ${openAiKey}`;
    }
    // num_ctx는 표준 chat completions 스펙에 없어 엄격한 서버는 400을 낸다. 넣지 않는다.
    const response = await fetchLlmWithRetry(url, {
      method: "POST",
      headers: openAiHeaders,
      body: JSON.stringify({
        model: matcherModel,
        messages: [
          { role: "system", content: MATCHER_PROMPT },
          { role: "user", content: userMessage },
        ],
        temperature: 0,
        max_tokens: 200,
      }),
    });

    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      console.warn(
        `[flux] ${providerLabel} matcher API error: ${response.status} | body: ${bodyText.slice(0, 800)}`,
      );
      return { kind: "not_found" };
    }

    const data = await response.json();
    content = (data.choices?.[0]?.message?.content ?? "").trim();
  }

  const duration = Date.now() - startedAt;
  if (!content || content === "NOT_FOUND") {
    console.log(`[flux LLM matcher] response (${duration}ms): NOT_FOUND`);
    return { kind: "not_found" };
  }
  if (content === "NOT_SURE") {
    console.log(`[flux LLM matcher] response (${duration}ms): NOT_SURE (애매 → 사후확인)`);
    return { kind: "not_sure" };
  }
  console.log(`[flux LLM matcher] response (${duration}ms): "${content}"`);
  return { kind: "selector", selector: content };
}

/** 활성 모달 스코프 우선으로 selector가 현재 DOM에 실제 존재하는지 확인. */
async function selectorExistsInScope(
  tabId: number,
  selector: string,
): Promise<boolean> {
  try {
    return await cdp.evaluate(
      tabId,
      `(() => {
        ${buildClientActiveScopeScript()}
        try { return !!fluxQueryInScope(${JSON.stringify(selector)}); }
        catch (e) { return false; }
      })()`,
    );
  } catch {
    return false;
  }
}

/** intent의 텍스트/라벨로 캐시 조회용 정규화 입력 만들기 */
function cacheTextFor(intent: ElementIntent): string | null {
  return intent.action === "button.click"
    ? intent.text ?? null
    : intent.label ?? null;
}

/** intent로 캐시 키를 만든다. host/path가 없으면(요약 실패) 캐시 사용 안 함(null). */
export function cacheKeyForIntent(
  summary: PageSummaryPayload,
  intent: ElementIntent,
): string | null {
  if (!summary.host && !summary.path) return null;
  return buildSelectorCacheKey({
    host: summary.host,
    path: summary.path,
    action: intent.action,
    text: cacheTextFor(intent),
    context: intent.context,
  });
}

/** 동적(Vue _uid_ 등) selector — 재생 때 번호가 바뀌어 못 믿음. */
function isDynamicSelector(s: string): boolean {
  return /_uid_|uid[\w-]*\d|\[name=["']?_[^"']*uid/i.test(s);
}
/** 위치기반(nth 2개+) selector — DOM 구조 살짝만 바뀌어도 다른 요소를 가리킴. */
function isBrittleSelector(s: string): boolean {
  return (s.match(/:nth-(of-type|child)\(/g) ?? []).length >= 2;
}
/** 안정적인 selector만 캐싱한다(동적 _uid_/위치기반 nth는 재생 때 못 믿으므로 스킵). */
function isCacheableSelector(selector: string): boolean {
  return !isDynamicSelector(selector) && !isBrittleSelector(selector);
}

/**
 * 실행 시점에 현재 페이지 DOM을 캡처하고, intent에 맞는 요소의 selector를 반환합니다.
 *
 * 0. 캐시(AI/사용자가 확정했던 안정 selector만): 현재 DOM에 존재하면 즉시 반환
 * 1. Fast path: 1개로 확실히 좁혀지면 즉시 반환(캐싱 안 함 — 어차피 매번 빠름)
 * 2. 후보 2개+: "비슷한 후보"만 AI에 압축 전달 → AI가 판단
 *    - AI가 selector 확정 → 사용(안정 selector면 캐싱)
 *    - AI가 NOT_SURE → 첫 후보로 진행하되 ambiguous=true + candidates 동봉(사후확인 대상)
 * 3. 후보 0개: 전체 요약으로 AI 폴백
 * 4. 실패 시 null (호출측 text fallback)
 */
export async function resolveElement(
  tabId: number,
  intent: ElementIntent,
  apiKey: string,
  llmProvider?: string,
): Promise<ResolvedElement | null> {
  const summary = await captureLiveDom(tabId);
  if (!summary) return null;

  const cacheKey = cacheKeyForIntent(summary, intent);

  // 0. 캐시 조회 — 존재 검증 후에만 사용 (화면 변경 시 자동 무효화)
  if (cacheKey) {
    const cached = await getCachedSelector(cacheKey);
    if (cached) {
      if (await selectorExistsInScope(tabId, cached)) {
        console.log(`[flux] resolveElement: cache hit → ${cached}`);
        return { selector: cached, matchedBy: "cache" };
      }
      console.log(`[flux] resolveElement: cache stale → ${cached}`);
      await invalidateCachedSelector(cacheKey);
    }
  }

  // 1. fast path
  const fast = tryFastPath(summary, intent);
  if (fast.kind === "resolved") {
    // fast-path 결과는 캐싱하지 않는다(어차피 빠르고, 잘못 좁힌 걸 박을 위험만 큼).
    return {
      selector: fast.selector,
      matchedBy: fast.via === "context-match" ? "context-match" : "unique-text",
    };
  }

  const provider = llmProvider || getLlmProvider();
  const effectiveKey = apiKey || getApiKeyForProvider(provider as any) || "";
  // 로컬 LLM은 키 없이 열린 서버가 많아 키 부재를 실행 차단 사유로 보지 않는다.
  const requiresKey = provider !== "local";
  // 사내망 DLP가 매처 호출을 막아 매번 503으로 fallback될 때, 사용자가 명시적으로 끄면
  // 재시도 시간(스텝당 ~3초) 낭비 없이 곧장 후보 기반 fallback으로 처리한다.
  const matcherDisabled = !getLlmMatcherEnabled();
  if ((requiresKey && !effectiveKey) || matcherDisabled) {
    if (matcherDisabled) {
      console.log("[flux] LLM matcher disabled — using code-based fallback only");
    }
    if (fast.kind === "candidates" && fast.items.length > 0) {
      return { selector: fast.items[0].selector, matchedBy: "context-match", ambiguous: true, candidates: fast.items };
    }
    return null;
  }

  // 2/3. AI 판단 — 후보가 있으면 압축 전달, 없으면 전체 요약
  const candidates = fast.kind === "candidates" ? fast.items : undefined;
  const verdict = await callMatcherLLM(summary, intent, effectiveKey, provider, candidates);

  if (verdict.kind === "selector") {
    if (cacheKey && isCacheableSelector(verdict.selector)) {
      await putCachedSelector(cacheKey, verdict.selector);
    }
    return { selector: verdict.selector, matchedBy: "llm", candidates };
  }

  if (verdict.kind === "not_sure" && candidates && candidates.length > 0) {
    // AI도 확신 못 함 → 첫 후보로 진행하되 사후확인 대상으로 표시
    return { selector: candidates[0].selector, matchedBy: "llm", ambiguous: true, candidates };
  }

  // not_found 등: 후보가 있으면 첫 후보로라도 진행(애매), 없으면 실패
  if (candidates && candidates.length > 0) {
    return { selector: candidates[0].selector, matchedBy: "llm", ambiguous: true, candidates };
  }
  return null;
}
