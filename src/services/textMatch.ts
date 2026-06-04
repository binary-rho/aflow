/**
 * 텍스트/컨텍스트 매칭의 단일 진실 원천 (single source of truth).
 *
 * TS 코드(domMatcher, targetResolver 등)에서는 normalizeForMatch/textMatches/contextMatches를 사용.
 * CDP를 통해 페이지 컨텍스트에서 실행되는 인라인 JS에서는 buildClientNormalizerScript()로
 * 동일한 로직의 JS 문자열을 얻어 inject. 두 환경의 정규화 결과가 항상 같다는 것을 보장.
 */

/** TS 환경에서 텍스트 정규화 (공백 제거, '+' 변형 통일, lowercase) */
export function normalizeForMatch(s: string | null | undefined): string {
  return (s ?? "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/[⁺\u2B⁺]/g, "+")
    .toLowerCase();
}

/** 공백을 단일 스페이스로만 합치는 약한 정규화 (label 비교 등 공백 의미가 있을 때) */
export function normalizeWithSpaces(s: string | null | undefined): string {
  return (s ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

/** context 비교 시 한/영 동일 의미 치환 (아이폰↔iPhone 등) */
export const HAN_ENG_CONTEXT_PAIRS: [RegExp, string][] = [
  [/아이폰/gi, "iphone"],
  [/갤럭시/gi, "galaxy"],
  [/엘지/gi, "lg"],
  [/삼성/gi, "samsung"],
];

export function normalizeContextForMatch(s: string | null | undefined): string {
  let t = normalizeForMatch(s);
  for (const [re, eng] of HAN_ENG_CONTEXT_PAIRS) {
    t = t.replace(re, eng);
  }
  return t;
}

const MIN_PARTIAL_MATCH_LENGTH = 3;

/** 양방향 포함 매칭 (a가 b를 포함하거나 b가 a를 포함). 짧은 문자열은 동일 매치만 허용. */
export function textMatches(
  itemText: string | null | undefined,
  searchText: string | null | undefined,
): boolean {
  if (!itemText || !searchText) return false;
  const a = normalizeForMatch(itemText);
  const b = normalizeForMatch(searchText);
  if (!a || !b) return false;
  if (a === b) return true;
  const shorter = a.length <= b.length ? a : b;
  if (shorter.length < MIN_PARTIAL_MATCH_LENGTH) return false;
  return a.includes(b) || b.includes(a);
}

export function contextMatches(
  itemContext: string | null | undefined,
  searchContext: string | null | undefined,
): boolean {
  if (!itemContext || !searchContext) return false;
  const a = normalizeContextForMatch(itemContext);
  const b = normalizeContextForMatch(searchContext);
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

/**
 * 페이지 컨텍스트(CDP Runtime.evaluate)에서 실행될 정규화 함수의 JS 문자열을 반환.
 * TS의 normalizeForMatch / textMatches와 동일한 동작을 보장.
 *
 * 사용 예:
 *   const script = `
 *     ${buildClientNormalizerScript()}
 *     const ok = fluxTextMatches(el.innerText, ${JSON.stringify(target)});
 *   `;
 */
export function buildClientNormalizerScript(): string {
  return `
    var fluxNormalize = function(s) {
      return (s == null ? '' : String(s))
        .trim()
        .replace(/\\s+/g, '')
        .replace(/[\\u207A\\u2B\\u207A]/g, '+')
        .toLowerCase();
    };
    var fluxNormalizeWithSpaces = function(s) {
      return (s == null ? '' : String(s)).trim().replace(/\\s+/g, ' ').toLowerCase();
    };
    var fluxTextMatches = function(itemText, searchText) {
      if (!itemText || !searchText) return false;
      var a = fluxNormalize(itemText);
      var b = fluxNormalize(searchText);
      if (!a || !b) return false;
      if (a === b) return true;
      var shorter = a.length <= b.length ? a : b;
      if (shorter.length < ${MIN_PARTIAL_MATCH_LENGTH}) return false;
      return a.indexOf(b) >= 0 || b.indexOf(a) >= 0;
    };
  `;
}
