/**
 * Selector 학습 캐시 — 도메인+화면+intent 별로 성공한 selector를 기억합니다.
 *
 * 목적: 같은 화면을 반복 실행할 때 매번 LLM 매칭을 돌리지 않고, 이전에 성공한
 * selector를 재사용해 속도·정확도를 올린다. 캐시된 selector는 사용 직전 현재 DOM에
 * 실제로 존재하는지 검증되므로(domMatcher.resolveElement 참고), 화면이 바뀌면 자동 무효화된다.
 *
 * 저장소: chrome.storage.local (영속). runner/targetResolver/domMatcher는 background
 * service worker에서 실행되어 localStorage를 쓸 수 없으므로 chrome.storage를 쓴다.
 * 세션 한정인 domCaptureStore와 달리 학습 누적이 목적이라 .local 사용.
 */

import { normalizeForMatch, normalizeContextForMatch } from "@/services/textMatch";

const STORAGE_KEY = "flux_selector_cache";
const MAX_ENTRIES = 500;

export interface SelectorCacheEntry {
  key: string;
  selector: string;
  hits: number;
  updatedAt: number;
}

function getStorage(): typeof chrome.storage.local | null {
  if (typeof chrome !== "undefined" && chrome.storage?.local) return chrome.storage.local;
  return null;
}

/**
 * 캐시 키 생성. 같은 화면(host+path)에서 같은 의도(action+text+context)는 같은 키.
 * 정규화는 textMatch의 단일 진실 원천을 재사용해 매칭 로직과 일관성 유지.
 */
export function buildSelectorCacheKey(input: {
  host?: string | null;
  path?: string | null;
  action: string;
  text?: string | null;
  context?: string | null;
}): string {
  const host = (input.host ?? "").toLowerCase();
  const path = input.path ?? "";
  const text = normalizeForMatch(input.text);
  const context = normalizeContextForMatch(input.context);
  return [host, path, input.action, text, context].join("|");
}

async function readAll(): Promise<SelectorCacheEntry[]> {
  const storage = getStorage();
  if (!storage) return [];
  try {
    const result = await storage.get(STORAGE_KEY);
    return (result[STORAGE_KEY] as SelectorCacheEntry[]) ?? [];
  } catch {
    return [];
  }
}

async function writeAll(entries: SelectorCacheEntry[]): Promise<void> {
  const storage = getStorage();
  if (!storage) return;
  try {
    await storage.set({ [STORAGE_KEY]: entries });
  } catch {
    // storage quota 등 — 캐시는 best-effort이므로 조용히 무시
  }
}

/** 캐시된 selector를 반환하고 hits를 증가시킨다. 없으면 null. */
export async function getCachedSelector(key: string): Promise<string | null> {
  const all = await readAll();
  const entry = all.find((e) => e.key === key);
  if (!entry) return null;
  entry.hits += 1;
  entry.updatedAt = Date.now();
  await writeAll(all);
  return entry.selector;
}

/** selector를 캐시에 저장(또는 갱신). MAX_ENTRIES 초과 시 가장 오래된 것부터 LRU 제거. */
export async function putCachedSelector(key: string, selector: string): Promise<void> {
  if (!selector) return;
  const all = await readAll();
  const idx = all.findIndex((e) => e.key === key);
  if (idx >= 0) {
    all[idx].selector = selector;
    all[idx].hits += 1;
    all[idx].updatedAt = Date.now();
  } else {
    all.push({ key, selector, hits: 1, updatedAt: Date.now() });
  }
  if (all.length > MAX_ENTRIES) {
    all.sort((a, b) => a.updatedAt - b.updatedAt);
    all.splice(0, all.length - MAX_ENTRIES);
  }
  await writeAll(all);
}

/** 캐시된 selector가 더 이상 유효하지 않을 때 제거 (DOM 존재 검증 실패 시). */
export async function invalidateCachedSelector(key: string): Promise<void> {
  const all = await readAll();
  const next = all.filter((e) => e.key !== key);
  if (next.length !== all.length) await writeAll(next);
}
