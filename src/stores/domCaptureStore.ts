/**
 * 시나리오 실행 시 방문한 페이지들의 DOM 요약을 chrome.storage.session에 보관합니다.
 * 보조 용도: 재변환/디버깅 시 참고할 수 있도록 유지합니다.
 * 패널 재열림에도 세션이 유지됩니다.
 */

export interface DomSnapshotItem {
  label: string;
  summary: string;
}

const STORAGE_KEY = "flux_dom_snapshots";
const MAX_PAGES = 30;
const MAX_TOTAL_BYTES = 200 * 1024;

function snapshotKey(item: DomSnapshotItem): string {
  try {
    const path = (JSON.parse(item.summary) as { path?: string })?.path ?? "";
    return path + "|" + item.summary.length + "|" + item.summary.slice(0, 200);
  } catch {
    return item.label + "|" + item.summary.slice(0, 300);
  }
}

function getStorage(): typeof chrome.storage.session | null {
  if (typeof chrome !== "undefined" && chrome.storage?.session) return chrome.storage.session;
  return null;
}

export async function getLastRunDomSnapshots(): Promise<DomSnapshotItem[]> {
  const storage = getStorage();
  if (!storage) return [];
  try {
    const result = await storage.get(STORAGE_KEY);
    return (result[STORAGE_KEY] as DomSnapshotItem[]) ?? [];
  } catch {
    return [];
  }
}

export async function appendLastRunDomSnapshot(payload: DomSnapshotItem): Promise<void> {
  const storage = getStorage();
  if (!storage) return;
  const current = await getLastRunDomSnapshots();
  const key = snapshotKey(payload);
  if (current.some((s) => snapshotKey(s) === key)) return;

  let next = [...current, payload];
  if (next.length > MAX_PAGES) next = next.slice(-MAX_PAGES);

  let total = next.reduce((acc, s) => acc + (s.summary?.length ?? 0), 0);
  while (total > MAX_TOTAL_BYTES && next.length > 1) {
    next = next.slice(1);
    total = next.reduce((acc, s) => acc + (s.summary?.length ?? 0), 0);
  }
  await storage.set({ [STORAGE_KEY]: next });
}

export async function clearLastRunDomSnapshots(): Promise<void> {
  const storage = getStorage();
  if (!storage) return;
  await storage.remove(STORAGE_KEY);
}
