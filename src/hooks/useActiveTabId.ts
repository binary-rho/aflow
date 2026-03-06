/**
 * 현재 활성 탭의 ID를 가져옵니다.
 * Side Panel / DevTools 모두 동작합니다.
 */
export async function getActiveTabId(): Promise<number | null> {
  if (typeof chrome === "undefined" || !chrome.tabs?.query) return null;
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const tab = tabs?.find((t) => t.url && !t.url.startsWith("chrome"));
  return tab?.id ?? null;
}
