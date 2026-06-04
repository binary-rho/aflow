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
} from "@/stores/settingsStore";
import { textMatches, contextMatches } from "@/services/textMatch";
import {
  buildSelectorCacheKey,
  getCachedSelector,
  putCachedSelector,
  invalidateCachedSelector,
} from "@/stores/selectorCacheStore";
import { buildClientActiveScopeScript } from "@/services/scopeResolver";

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_API_VERSION = "2023-06-01";

const OPENAI_MATCHER_MODEL = "gpt-4o";
const ANTHROPIC_MATCHER_MODEL = "claude-sonnet-4-6";

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

function tryCtaStrategies(
  ctas: NonNullable<PageSummaryPayload["ctas"]>,
  intent: ElementIntent,
): FastPathResult {
  const target = intent.text!;

  // 1. testId 매칭 — 가장 강한 신호
  const byTestId = ctas.filter(
    (c) => c.testId && textMatches(c.testId, target),
  );
  if (byTestId.length === 1) {
    return { kind: "resolved", selector: byTestId[0].selector!, via: "unique-text" };
  }

  // 2. accessibleName 정확 매치
  const byAccName = ctas.filter((c) => textMatches(c.accessibleName, target));
  if (byAccName.length === 1) {
    return { kind: "resolved", selector: byAccName[0].selector!, via: "unique-text" };
  }

  // 3. text 매칭
  const byText = ctas.filter((c) => textMatches(c.text, target));
  console.log(`[flux] tryFastPath: ${byText.length} text matches for "${target}"`);
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

  // 1. testId
  const byTestId = fields.filter((f) => f.testId && textMatches(f.testId, target));
  if (byTestId.length === 1) return { kind: "resolved", selector: byTestId[0].selector!, via: "unique-text" };

  // 2. ariaLabel
  const byAria = fields.filter((f) => textMatches(f.ariaLabel, target));
  if (byAria.length === 1) return { kind: "resolved", selector: byAria[0].selector!, via: "unique-text" };

  // 3. label/placeholder/name
  const byLabel = fields.filter(
    (f) =>
      textMatches(f.label, target) ||
      textMatches(f.placeholder, target) ||
      textMatches(f.name, target),
  );
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
    domText = formatPageSummaryForLLM(summary);
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
    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": ANTHROPIC_API_VERSION,
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MATCHER_MODEL,
        max_tokens: 200,
        system: MATCHER_PROMPT,
        messages: [{ role: "user", content: userMessage }],
        temperature: 0,
      }),
    });

    if (!response.ok) {
      console.warn(`[flux] Anthropic matcher API error: ${response.status}`);
      return { kind: "not_found" };
    }

    const data = await response.json();
    content = (data.content?.[0]?.text ?? "").trim();
  } else {
    const response = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: OPENAI_MATCHER_MODEL,
        messages: [
          { role: "system", content: MATCHER_PROMPT },
          { role: "user", content: userMessage },
        ],
        temperature: 0,
        max_tokens: 200,
      }),
    });

    if (!response.ok) {
      console.warn(`[flux] OpenAI matcher API error: ${response.status}`);
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
  if (!effectiveKey) {
    // AI 못 쓰면, 후보가 있을 때 첫 후보로 진행(애매 표시)
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
