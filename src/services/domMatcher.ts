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

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const MODEL = "gpt-4o-mini";

export interface ElementIntent {
  action: "button.click" | "form.fill";
  text?: string;
  label?: string;
  context?: string;
}

export interface ResolvedElement {
  selector: string;
  matchedBy: "unique-text" | "context-match" | "llm";
}

const MATCHER_PROMPT = `You are a DOM element matcher.
Given a page's DOM summary and an intent, return the CSS selector of the matching element.

Rules:
- For button clicks: look at the "ctas" list. Each CTA shows: text, role, context (in ...), and selector (→).
- For form fills: look at the "formFields" list. Each field shows: label, type, context, and selector (→).
- Match by text/label first. If multiple items share the same text, use context to disambiguate.
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
  const lengthGap = Math.abs(a.length - b.length);
  if (lengthGap > 2) return false;
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
    if (matches.length === 1) return matches[0].selector!;
    if (matches.length > 1 && intent.context) {
      const narrowed = matches.filter((c) =>
        contextMatches(c.context, intent.context!),
      );
      if (narrowed.length === 1) return narrowed[0].selector!;
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
): Promise<string | null> {
  const domText = formatPageSummaryForLLM(summary);
  const intentDesc =
    intent.action === "button.click"
      ? `Click button with text "${intent.text}"${intent.context ? ` in context "${intent.context}"` : ""}`
      : `Fill form field with label "${intent.label}"${intent.context ? ` in context "${intent.context}"` : ""}`;

  const response = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: MATCHER_PROMPT },
        {
          role: "user",
          content: `## Page DOM:\n${domText}\n\n## Intent:\n${intentDesc}`,
        },
      ],
      temperature: 0,
      max_tokens: 200,
    }),
  });

  if (!response.ok) return null;

  const data = await response.json();
  const content = (data.choices?.[0]?.message?.content ?? "").trim();
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
): Promise<ResolvedElement | null> {
  const summary = await captureLiveDom(tabId);
  if (!summary) return null;

  const fastResult = tryFastPath(summary, intent);
  if (fastResult) {
    const matchedBy = intent.context ? "context-match" : "unique-text";
    return { selector: fastResult, matchedBy };
  }

  if (!apiKey) return null;
  const llmResult = await callMatcherLLM(summary, intent, apiKey);
  if (llmResult) {
    return { selector: llmResult, matchedBy: "llm" };
  }

  return null;
}
