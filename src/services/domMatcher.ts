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

export interface ResolvedElement {
  selector: string;
  matchedBy: "unique-text" | "context-match" | "llm";
}

const MATCHER_PROMPT = `You are a DOM element matcher.
Given a page's DOM summary and an intent, return the CSS selector of the matching element.

Rules:
- For button clicks: look at the "ctas" list. Each CTA shows: text, role, context (in ...), gtm (gtm "..."), and selector (→).
- For form fills: look at the "formFields" list. Each field shows: label, type, context, and selector (→).
- Match by text/label first. If multiple items share the same text, use context and gtm attributes to disambiguate.
- Return ONLY the selector string (the value after →). No quotes, no explanation, no JSON.
- If no match is found, return exactly: NOT_FOUND`;

function normalizeForMatch(s: string): string {
  return (s ?? "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/[\u207A⁺]/g, "+")
    .toLowerCase();
}

/** context 비교 시 한/영 동일 의미 치환 (아이폰↔iPhone 등) */
const HAN_ENG_CONTEXT_PAIRS: [RegExp, string][] = [
  [/아이폰/gi, "iphone"],
  [/갤럭시/gi, "galaxy"],
  [/엘지/gi, "lg"],
  [/삼성/gi, "samsung"],
];

function normalizeContextForMatch(s: string): string {
  let t = normalizeForMatch(s);
  for (const [re, eng] of HAN_ENG_CONTEXT_PAIRS) {
    t = t.replace(re, eng);
  }
  return t;
}

function textMatches(itemText: string | null, searchText: string): boolean {
  if (!itemText || !searchText) return false;
  const a = normalizeForMatch(itemText);
  const b = normalizeForMatch(searchText);
  if (a === b) return true;
  const shorter = a.length <= b.length ? a : b;
  if (shorter.length < 3) return false;
  return a.includes(b) || b.includes(a);
}

function contextMatches(
  itemContext: string | null,
  searchContext: string,
): boolean {
  if (!itemContext || !searchContext) return false;
  const a = normalizeContextForMatch(itemContext);
  const b = normalizeContextForMatch(searchContext);
  return a.includes(b) || b.includes(a);
}

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
function tryFastPath(
  summary: PageSummaryPayload,
  intent: ElementIntent,
): string | null {
  if (intent.action === "button.click" && intent.text) {
    const matches = (summary.ctas || []).filter(
      (c) => c.selector && textMatches(c.text, intent.text!),
    );
    console.log(`[flux] tryFastPath: ${matches.length} text matches for "${intent.text}"`);
    if (matches.length > 1) {
      console.log("[flux] tryFastPath contexts:", matches.map((c) => c.context).join(" | "));
    }
    if (matches.length === 1) return matches[0].selector!;
    if (matches.length > 1) {
      if (intent.context) {
        const narrowed = matches.filter((c) =>
          contextMatches(c.context, intent.context!),
        );
        console.log(`[flux] tryFastPath: context="${intent.context}" → ${narrowed.length} narrowed`);
        if (narrowed.length === 1) return narrowed[0].selector!;
      }
      if (intent.gtmText) {
        const byGtm = matches.filter(
          (c) => c.gtmText && textMatches(c.gtmText, intent.gtmText!),
        );
        if (byGtm.length === 1) return byGtm[0].selector!;
      }
    }
  }

  if (intent.action === "form.fill" && intent.label) {
    const matches = (summary.formFields || []).filter(
      (f) =>
        f.selector &&
        (textMatches(f.label, intent.label!) ||
          textMatches(f.placeholder, intent.label!) ||
          textMatches(f.name, intent.label!)),
    );
    if (matches.length === 1) return matches[0].selector!;
    if (matches.length > 1 && intent.context) {
      const narrowed = matches.filter((f) =>
        contextMatches(f.context, intent.context!),
      );
      if (narrowed.length === 1) return narrowed[0].selector!;
    }
  }

  return null;
}

async function callMatcherLLM(
  summary: PageSummaryPayload,
  intent: ElementIntent,
  apiKey: string,
  providerOverride?: string,
): Promise<string | null> {
  const domText = formatPageSummaryForLLM(summary);
  const contextPart = intent.context ? ` in context "${intent.context}"` : "";
  const gtmPart = intent.gtmText ? ` (gtm-click-text: "${intent.gtmText}")` : "";
  const intentDesc =
    intent.action === "button.click"
      ? `Click button with text "${intent.text}"${contextPart}${gtmPart}`
      : `Fill form field with label "${intent.label}"${contextPart}${gtmPart}`;

  const userMessage = `## Page DOM:\n${domText}\n\n## Intent:\n${intentDesc}`;
  const provider = providerOverride || getLlmProvider();

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
      return null;
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
      return null;
    }

    const data = await response.json();
    content = (data.choices?.[0]?.message?.content ?? "").trim();
  }

  if (!content || content === "NOT_FOUND") return null;
  return content;
}

/**
 * 실행 시점에 현재 페이지 DOM을 캡처하고, intent에 맞는 요소의 selector를 반환합니다.
 *
 * 1. Fast path: text가 유일하거나 text+context로 1개로 좁혀지면 즉시 반환
 * 2. Slow path: LLM 2차 호출로 매칭
 * 3. 매칭 실패 시 null 반환 (호출측에서 기존 clickByText/fillByLabel fallback)
 */
export async function resolveElement(
  tabId: number,
  intent: ElementIntent,
  apiKey: string,
  llmProvider?: string,
): Promise<ResolvedElement | null> {
  const summary = await captureLiveDom(tabId);
  if (!summary) return null;

  const fastResult = tryFastPath(summary, intent);
  if (fastResult) {
    const matchedBy = intent.context ? "context-match" : "unique-text";
    return { selector: fastResult, matchedBy };
  }

  const provider = llmProvider || getLlmProvider();
  const effectiveKey = apiKey || getApiKeyForProvider(provider as any) || "";
  if (!effectiveKey) return null;

  const llmResult = await callMatcherLLM(summary, intent, effectiveKey, provider);
  if (llmResult) {
    return { selector: llmResult, matchedBy: "llm" };
  }

  return null;
}
