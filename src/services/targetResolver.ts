/**
 * Target Resolver — Step 1
 *
 * interaction.ts에 액션별로 흩어져 있던 selector → text → context → LLM fallback 사다리를
 * 단일 함수로 모은 것. 동작은 기존과 동일하게 유지하면서 진입점만 일원화한다.
 *
 * 향후 Step 4에서 ambiguity policy, scoring, strategy 우선순위를 여기에 얹는다.
 */

import * as cdp from "@/engine/cdp";
import { resolveElement, type ElementCandidate } from "@/services/domMatcher";
import { buildClientNormalizerScript } from "@/services/textMatch";
import { buildClientActiveScopeScript } from "@/services/scopeResolver";

const CLICKABLE_BY_TEXT_SELECTOR =
  "button, a, [role='button'], [role='link']";

const HOVERABLE_SELECTOR =
  'nav a, nav button, [role="menuitem"], [class*="menu"] a, [class*="menu"] button, [class*="gnb"] a, [class*="gnb"] button, [role="tab"], header a, header button, a, button, [role="button"]';

const MAX_SCROLL_RETRIES = 6;

/** 동적/자동생성된 selector 패턴 (Vue uid 등) — 신뢰하지 않음 */
export function isDynamicSelector(s: string | undefined | null): boolean {
  return !!s && /_uid_|^#[\w-]*uid[\w-]*\d|\[name=["']?_[^"']*uid/i.test(s);
}

/**
 * 위치 기반 (brittle) selector 감지. nth-of-type/nth-child 체인은
 * DOM 구조가 살짝만 바뀌어도 다른 element를 가리킬 수 있어 가짜 매칭의 주범.
 * label/text가 있으면 그쪽으로 매칭하는 게 안전하다.
 */
export function isBrittleSelector(s: string | undefined | null): boolean {
  if (!s) return false;
  const nthCount = (s.match(/:nth-(of-type|child)\(/g) ?? []).length;
  return nthCount >= 2;
}

export type TargetAction = "click" | "hover" | "fill";

export interface TargetDescriptor {
  /** 우선 사용할 CSS selector (recorder 결과 등). 없거나 dynamic이면 무시 */
  selector?: string | null;
  /** 표시 텍스트 (button/link) 또는 라벨 (form) */
  text?: string | null;
  /** form.fill에서 사용. text와 별도 필드로 분리해 의미 보존 */
  label?: string | null;
  /** 같은 text/label이 여러 개일 때 좁히는 단서 */
  context?: string | null;
  /** form.fill 입력값 (resolver는 사용 안 하지만, 호출자 편의로 받음) */
  value?: string;
}

export interface ResolveOptions {
  /** 실행하지 않고 매칭 가능성만 확인 (validation 모드) */
  skipClick?: boolean;
  /** 2차 매칭 LLM 호출용 API 키. 없으면 LLM 단계 생략 */
  apiKey?: string;
  llmProvider?: string;
}

/** 매칭 전략. 단순 정보 — 점수 합산이 아니라 우선순위 리스트. */
export type ResolveStrategy =
  | "selector-validated"
  | "matcher-cache"
  | "matcher-fast-path"
  | "matcher-llm"
  | "text-with-context"
  | "text-only";

export type ResolveResult =
  | {
      status: "resolved";
      strategy: ResolveStrategy;
      selector?: string;
      /** AI/코드가 확신 못 해 첫 후보로 진행 → 사후확인 대상 */
      ambiguous?: boolean;
      /** 사후확인에 보여줄 후보 목록 */
      candidates?: ElementCandidate[];
    }
  | { status: "not_found"; reason: string };

/** domMatcher의 matchedBy를 targetResolver의 strategy로 매핑 */
function strategyFromMatchedBy(
  matchedBy: "unique-text" | "context-match" | "llm" | "cache",
): ResolveStrategy {
  if (matchedBy === "llm") return "matcher-llm";
  if (matchedBy === "cache") return "matcher-cache";
  return "matcher-fast-path";
}

/**
 * 클릭 함수가 "not found" 에러로 실패하면 페이지를 스크롤 다운하며 재시도.
 * lazy render로 뷰포트 밖 요소가 아직 DOM에 없는 경우를 대응.
 */
export async function withScrollRetry(
  tabId: number,
  fn: () => Promise<void>,
): Promise<void> {
  for (let attempt = 0; attempt <= MAX_SCROLL_RETRIES; attempt++) {
    try {
      await fn();
      return;
    } catch (err: any) {
      const isNotFound =
        err?.message?.includes("not found") ||
        err?.message?.includes("찾을 수 없");
      if (!isNotFound || attempt === MAX_SCROLL_RETRIES) throw err;
      const atBottom = await cdp.isAtPageBottom(tabId);
      if (atBottom) throw err;
      console.log(
        `[flux] element not found, scrolling down (attempt ${attempt + 1}/${MAX_SCROLL_RETRIES})`,
      );
      await cdp.scrollDownByViewport(tabId);
    }
  }
}

/**
 * selector + text가 페이지에서 실제로 매칭되는지 확인.
 * 활성 모달이 있으면 그 자손에서 먼저 찾고, 없으면 document fallback.
 */
async function selectorMatchesText(
  tabId: number,
  selector: string,
  text: string,
): Promise<boolean> {
  return cdp.evaluate(
    tabId,
    `(() => {
      ${buildClientActiveScopeScript()}
      ${buildClientNormalizerScript()}
      var selector = ${JSON.stringify(selector)};
      var expectedText = ${JSON.stringify(text)};
      var el = fluxQueryInScope(selector);
      if (!el) return false;
      if (!expectedText) return true;
      var elText = (el.innerText || el.textContent || "").trim();
      // 저장된 selector가 여전히 "그 요소"인지 정확 일치로 검증한다.
      // 부분 포함을 허용하면 "S26"이 "S26+"(다른 상품)를 통과시키므로 exact만 쓴다.
      // 녹화 때 저장한 text도 동일 방식으로 뽑히므로 정상 케이스는 exact로 맞는다.
      return fluxTextMatchesExact(elText, expectedText);
    })()`,
  );
}

/**
 * 클릭 대상 해결 + 클릭 실행.
 * 단계: selector(validated) → matcher fast/LLM → text+context → text only
 * 어느 단계든 성공하면 즉시 클릭(또는 validation 모드면 skip)하고 종료.
 */
export async function resolveAndClick(
  tabId: number,
  desc: TargetDescriptor,
  opts: ResolveOptions = {},
): Promise<ResolveResult> {
  const selector = isDynamicSelector(desc.selector) ? null : desc.selector;
  const text = desc.text ?? null;
  const context = desc.context ?? null;
  const { skipClick, apiKey, llmProvider } = opts;

  // 1. selector + text 검증 → 통과하면 클릭
  if (selector) {
    try {
      const valid = text ? await selectorMatchesText(tabId, selector, text) : true;
      if (valid) {
        await cdp.click(tabId, selector, { skipClick });
        return { status: "resolved", strategy: "selector-validated", selector };
      }
    } catch {
      console.warn(`[flux] selector failed: "${selector}"`);
    }
    if (!text) {
      return {
        status: "not_found",
        reason: `Element not found by selector "${selector}" and no text fallback`,
      };
    }
    console.log(`[flux] selector invalid, falling through to text matching: "${text}"`);
  }

  if (!text) {
    return { status: "not_found", reason: "no selector and no text" };
  }

  console.log(`[flux] resolveAndClick: text="${text}", context="${context ?? "(none)"}"`);

  // 2. matcher (fast path + LLM)
  if (apiKey) {
    try {
      const resolved = await resolveElement(
        tabId,
        { action: "button.click", text, context: context ?? undefined },
        apiKey,
        llmProvider,
      );
      if (resolved) {
        console.log(`[flux] resolveElement → ${resolved.matchedBy}: "${resolved.selector}"`);
        try {
          await cdp.click(tabId, resolved.selector, { skipClick });
          const strategy = strategyFromMatchedBy(resolved.matchedBy);
          return {
            status: "resolved",
            strategy,
            selector: resolved.selector,
            ambiguous: resolved.ambiguous,
            candidates: resolved.candidates,
          };
        } catch (err: any) {
          console.warn(`[flux] resolved selector click failed: ${err?.message}`);
        }
      } else {
        console.log("[flux] resolveElement → no match");
      }
    } catch (err: any) {
      console.warn(
        `[flux] resolveElement threw, falling back to text matching: ${err?.message}`,
      );
    }
  }

  // 3. text + context fallback
  if (context) {
    try {
      console.log("[flux] fallback → clickByTextWithContext");
      await withScrollRetry(tabId, () =>
        cdp.clickByTextWithContext(tabId, text, context, CLICKABLE_BY_TEXT_SELECTOR, {
          skipClick,
        }),
      );
      return { status: "resolved", strategy: "text-with-context" };
    } catch (err: any) {
      console.warn(`[flux] clickByTextWithContext failed: ${err?.message}`);
    }
  }

  // 4. text only — 가장 약한 fallback. Step 4에서 opt-in으로 바꿀 예정.
  console.log("[flux] final fallback → clickByText (no context, picks topmost)");
  try {
    await withScrollRetry(tabId, () =>
      cdp.clickByText(tabId, text, CLICKABLE_BY_TEXT_SELECTOR, { skipClick }),
    );
    return { status: "resolved", strategy: "text-only" };
  } catch (err: any) {
    return { status: "not_found", reason: err?.message ?? String(err) };
  }
}

/**
 * 호버 대상 해결 + 호버 실행. clickAndResolve와 같은 사다리 구조.
 */
export async function resolveAndHover(
  tabId: number,
  desc: TargetDescriptor,
  opts: ResolveOptions = {},
): Promise<ResolveResult> {
  const selector = isDynamicSelector(desc.selector) ? null : desc.selector;
  const text = desc.text ?? null;
  const context = desc.context ?? null;
  const { apiKey, llmProvider } = opts;

  // 1. selector + text 검증
  if (selector) {
    try {
      const valid = text ? await selectorMatchesText(tabId, selector, text) : true;
      if (valid) {
        await cdp.hover(tabId, selector);
        return { status: "resolved", strategy: "selector-validated", selector };
      }
    } catch {
      console.warn(`[flux] hover selector failed: "${selector}"`);
    }
    if (!text) {
      return {
        status: "not_found",
        reason: `Hover target not found by selector "${selector}" and no text fallback`,
      };
    }
    console.log(`[flux] hover selector invalid, falling through to text matching: "${text}"`);
  }

  if (!text) {
    return { status: "not_found", reason: "no selector and no text" };
  }

  console.log(`[flux] resolveAndHover: text="${text}", context="${context ?? "(none)"}"`);

  // 2. matcher
  if (apiKey) {
    try {
      const resolved = await resolveElement(
        tabId,
        { action: "button.click", text, context: context ?? undefined },
        apiKey,
        llmProvider,
      );
      if (resolved) {
        console.log(`[flux] hover resolveElement → ${resolved.matchedBy}: "${resolved.selector}"`);
        try {
          await cdp.hover(tabId, resolved.selector);
          const strategy = strategyFromMatchedBy(resolved.matchedBy);
          return {
            status: "resolved",
            strategy,
            selector: resolved.selector,
            ambiguous: resolved.ambiguous,
            candidates: resolved.candidates,
          };
        } catch (err: any) {
          console.warn(`[flux] hover resolved selector failed: ${err?.message}`);
        }
      }
    } catch (err: any) {
      console.warn(`[flux] hover resolveElement threw, falling back: ${err?.message}`);
    }
  }

  // 3. text + context
  if (context) {
    try {
      console.log("[flux] hover fallback → hoverByTextWithContext");
      await cdp.hoverByTextWithContext(tabId, text, context, HOVERABLE_SELECTOR);
      return { status: "resolved", strategy: "text-with-context" };
    } catch (err: any) {
      console.warn(`[flux] hoverByTextWithContext failed: ${err?.message}`);
    }
  }

  // 4. text only
  console.log("[flux] hover final fallback → hoverByText");
  try {
    await cdp.hoverByText(tabId, text, HOVERABLE_SELECTOR);
    return { status: "resolved", strategy: "text-only" };
  } catch (err: any) {
    return { status: "not_found", reason: err?.message ?? String(err) };
  }
}

/**
 * form.fill 대상 해결 + 입력 실행. label → matcher → fillByLabel 사다리.
 */
export async function resolveAndFill(
  tabId: number,
  desc: TargetDescriptor,
  value: string,
  opts: ResolveOptions = {},
): Promise<ResolveResult> {
  const label = desc.label ?? null;
  const context = desc.context ?? null;
  const { apiKey, llmProvider } = opts;

  // form.fill은 selector 검증이 까다로워(label이 input 주변에 있어 innerText 비교 불가)
  // brittle selector가 우연히 다른 input에 매칭되면 가짜 입력을 일으킴. label이 있으면 우선시.
  let selector: string | null | undefined = desc.selector;
  if (isDynamicSelector(selector)) selector = null;
  if (isBrittleSelector(selector) && label) {
    console.log(
      `[flux] form.fill: brittle selector ignored, using label="${label}" instead`,
    );
    selector = null;
  }

  // 1. selector 우선
  if (selector) {
    try {
      await cdp.type(tabId, selector, value);
      return { status: "resolved", strategy: "selector-validated", selector };
    } catch {
      if (label) {
        try {
          await cdp.fillByLabel(tabId, label, value);
          return { status: "resolved", strategy: "text-only" };
        } catch (err: any) {
          return { status: "not_found", reason: err?.message ?? String(err) };
        }
      }
      return {
        status: "not_found",
        reason: `Input not found by selector "${selector}" and no label fallback`,
      };
    }
  }

  if (!label) {
    return { status: "not_found", reason: "form.fill requires 'selector' or 'label'" };
  }

  // 2. matcher
  if (apiKey) {
    try {
      const resolved = await resolveElement(
        tabId,
        { action: "form.fill", label, context: context ?? undefined },
        apiKey,
        llmProvider,
      );
      if (resolved) {
        try {
          await cdp.type(tabId, resolved.selector, value);
          const strategy = strategyFromMatchedBy(resolved.matchedBy);
          return {
            status: "resolved",
            strategy,
            selector: resolved.selector,
            ambiguous: resolved.ambiguous,
            candidates: resolved.candidates,
          };
        } catch {
          // fall through to fillByLabel
        }
      }
    } catch (err: any) {
      console.warn(
        `[flux] form.fill resolveElement threw, falling back to fillByLabel: ${err?.message}`,
      );
    }
  }

  // 3. fillByLabel fallback
  try {
    await cdp.fillByLabel(tabId, label, value);
    return { status: "resolved", strategy: "text-only" };
  } catch (err: any) {
    return { status: "not_found", reason: err?.message ?? String(err) };
  }
}
