/**
 * 검사 중인 탭에서 방문한 페이지의 DOM 요약을 chrome.storage.local에 자동 캐시합니다.
 * 키: "domCache_{domain}_{path}" → 사이트별로 분리 저장.
 * 사용자가 사이트를 쓰면서 자연스럽게 쌓이고, DRR 변환 시 해당 도메인의 모든 캐시를 LLM에 전달합니다.
 */

import type { PageSummaryPayload } from "@/services/domSnapshot";

const CACHE_PREFIX = "domCache_";
const MAX_PAGES_PER_DOMAIN = 50;

function cacheKey(domain: string, path: string): string {
  const normalizedPath = path.replace(/\?.*$/, "").replace(/#.*$/, "").replace(/\/$/, "") || "/";
  return `${CACHE_PREFIX}${domain}_${normalizedPath}`;
}

function getStorage(): typeof chrome.storage.local | null {
  if (typeof chrome !== "undefined" && chrome.storage?.local) return chrome.storage.local;
  return null;
}

export interface CachedPageEntry {
  domain: string;
  path: string;
  summary: PageSummaryPayload;
  cachedAt: number;
}

export async function cacheDomSummary(
  domain: string,
  path: string,
  summary: PageSummaryPayload,
): Promise<void> {
  const storage = getStorage();
  if (!storage) return;
  const key = cacheKey(domain, path);
  const entry: CachedPageEntry = {
    domain,
    path: path.replace(/\?.*$/, "").replace(/#.*$/, "").replace(/\/$/, "") || "/",
    summary,
    cachedAt: Date.now(),
  };
  await storage.set({ [key]: entry });
  await evictOldEntries(domain);
}

export async function getCachedPagesForDomain(
  domain: string,
): Promise<CachedPageEntry[]> {
  const storage = getStorage();
  if (!storage) return [];
  const prefix = `${CACHE_PREFIX}${domain}_`;
  const all = await storage.get(null);
  const entries: CachedPageEntry[] = [];
  for (const [key, value] of Object.entries(all)) {
    if (key.startsWith(prefix) && value && typeof value === "object" && "summary" in value) {
      entries.push(value as CachedPageEntry);
    }
  }
  entries.sort((a, b) => a.cachedAt - b.cachedAt);
  return entries;
}

export async function getCachedPageCount(domain: string): Promise<number> {
  return (await getCachedPagesForDomain(domain)).length;
}

export async function clearCacheForDomain(domain: string): Promise<void> {
  const storage = getStorage();
  if (!storage) return;
  const prefix = `${CACHE_PREFIX}${domain}_`;
  const all = await storage.get(null);
  const keysToRemove = Object.keys(all).filter((k) => k.startsWith(prefix));
  if (keysToRemove.length > 0) await storage.remove(keysToRemove);
}

async function evictOldEntries(domain: string): Promise<void> {
  const storage = getStorage();
  if (!storage) return;
  const entries = await getCachedPagesForDomain(domain);
  if (entries.length <= MAX_PAGES_PER_DOMAIN) return;
  const toRemove = entries.slice(0, entries.length - MAX_PAGES_PER_DOMAIN);
  const keys = toRemove.map((e) => cacheKey(e.domain, e.path));
  await storage.remove(keys);
}
