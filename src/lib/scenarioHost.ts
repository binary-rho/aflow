/**
 * 시나리오 urlPattern·탭 도메인 비교용. 경로/포트 제거, 소문자, 선행 www 제거.
 */
export function normalizeScenarioHost(raw: string): string {
  const s = (raw || "").trim().replace(/^https?:\/\//i, "");
  const beforePath = s.split("/")[0];
  const host = beforePath.split("@").pop()?.split(":")[0] ?? "";
  const withoutBracketSuffix = host.replace(/\s*\[[^\]]*]\s*$/i, "").trim();
  return withoutBracketSuffix.replace(/^www\./i, "").toLowerCase();
}

const HOST_LIKE = /\./;

/** prod apex와 구분: stg/dev 등 환경 전용 호스트는 같은 registrable 도메인이라도 별도 사이트로 본다 */
const ENVIRONMENT_SUBDOMAIN_LABELS = new Set([
  "alpha",
  "beta",
  "demo",
  "dev",
  "develop",
  "development",
  "local",
  "pre",
  "preview",
  "qa",
  "qat",
  "sandbox",
  "sit",
  "stg",
  "stage",
  "staging",
  "test",
  "uat",
]);

function prefixBeforeSuffix(longer: string, shorter: string): string | null {
  const suffix = "." + shorter;
  if (!longer.endsWith(suffix)) return null;
  return longer.slice(0, -suffix.length);
}

function firstLabelOfHostPrefix(prefix: string): string {
  if (!prefix) return "";
  return prefix.split(".")[0].toLowerCase();
}

function isEnvironmentSubdomainBetweenHosts(longer: string, shorter: string): boolean {
  const prefix = prefixBeforeSuffix(longer, shorter);
  if (prefix == null) return false;
  return ENVIRONMENT_SUBDOMAIN_LABELS.has(firstLabelOfHostPrefix(prefix));
}

function hostFromNavUrl(raw: string): string {
  const u = raw.trim().replace(/^https?:\/\//i, "");
  const slashIdx = u.indexOf("/");
  const head = slashIdx >= 0 ? u.slice(0, slashIdx) : u;
  if (!HOST_LIKE.test(head)) return "";
  return normalizeScenarioHost(head);
}

/**
 * DRR/DSL에서 저장할 urlPattern(호스트만). baseUrl → 첫 nav 전체 URL → 검사 탭 순.
 */
export function resolveUrlPatternFromDsl(
  dslBaseUrl: string,
  inspectedTabHost: string,
  firstNavUrl?: string,
): string {
  const fromDsl = normalizeScenarioHost(
    dslBaseUrl.replace(/^https?:\/\//i, "").split("/")[0] || "",
  );
  const fromNav = firstNavUrl ? hostFromNavUrl(firstNavUrl) : "";
  const fromTab = normalizeScenarioHost(inspectedTabHost);
  return fromDsl || fromNav || fromTab || "localhost";
}

/** 목록에서 현재 검사 탭과 같은 사이트 시나리오인지 */
export function scenarioMatchesInspectedHost(
  urlPattern: string,
  inspectedTabHost: string,
): boolean {
  const h = normalizeScenarioHost(inspectedTabHost);
  const p = normalizeScenarioHost(urlPattern.split("/")[0]);
  if (!h || h === "localhost") return false;
  if (!p) return false;
  if (p === h) return true;
  // 패턴이 더 구체적: api.lguplus.com vs 탭 lguplus.com — 환경 서브도메인(stg 등)은 prod와 분리
  if (p.endsWith("." + h) && !isEnvironmentSubdomainBetweenHosts(p, h)) return true;
  if (h.endsWith("." + p) && !isEnvironmentSubdomainBetweenHosts(h, p)) return true;
  return false;
}
