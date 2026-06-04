import type { Scenario } from "@/app/data";

/** 쿼리/해시/스킴 제외, 호스트는 www 제거해 같은 페이지로 비교 (https://www.lguplus.com/mobile?p=1 === lguplus.com/mobile) */
export function normalizeUrlForCompare(url: string): string {
  const withoutQueryHash = url.replace(/\?.*$/, "").replace(/#.*$/, "").trim();
  const withoutScheme = withoutQueryHash.replace(
    /^[a-z][a-z0-9+.-]*:\/\//i,
    "",
  );
  const withoutTrailingSlash =
    withoutScheme.replace(/\/$/, "") || withoutScheme;
  const withoutWww = withoutTrailingSlash.replace(/^www\./, "");
  return withoutWww;
}

/** 시나리오의 실제 시작 URL (base + 첫 스텝 nav.goto 경로). 현재 페이지 매칭용. url에는 경로만 있어야 함. */
export function getScenarioEffectiveUrl(s: Scenario): string {
  const base = s.urlPattern.replace("flux.app", "");
  const first = s.steps[0];
  if (!first || first.actionId !== "nav.goto") return base;
  const raw = first.params?.url;
  if (raw == null || raw === "") return base;
  const urlStr = String(raw)
    .trim()
    .replace(/^https?:\/\//, "");
  const slashIdx = urlStr.indexOf("/");
  const path =
    slashIdx >= 0 && /\./.test(urlStr.slice(0, slashIdx))
      ? urlStr.slice(slashIdx)
      : urlStr.startsWith("/")
        ? urlStr
        : `/${urlStr}`;
  return `${base.replace(/\/$/, "")}${path}`;
}

/** 두 URL이 같은 페이지인지 (쿼리/해시 무시, www 제거, 호스트+path만 비교) */
export function isSamePage(a: string, b: string): boolean {
  return normalizeUrlForCompare(a) === normalizeUrlForCompare(b);
}
