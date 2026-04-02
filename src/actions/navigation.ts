import * as cdp from "@/engine/cdp";
import type { ActionFn } from "./index";

/** CDP Page.navigate는 전체 URL만 허용. 상대 경로(예: /, /path)면 현재 탭 URL 기준으로 절대 URL로 만든다. */
function resolveNavigateUrl(url: string, tabUrl: string | undefined): string {
  const trimmed = url.trim();
  if (!trimmed) return url;
  const isAbsolute = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed);
  if (isAbsolute) return trimmed;
  // 호스트 형태(예: m.qa-sh.uhdcsre.com/apcm/main)면 상대경로로 해석되며 URL이 반복되므로, https:// 붙여 절대 URL로 처리
  const looksLikeHostPath = /^[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z]{2,}/.test(trimmed);
  if (looksLikeHostPath) return "https://" + trimmed;
  if (!tabUrl) {
    throw new Error(
      "상대 경로(/)로 이동하려면 검사 중인 탭이 열려 있어야 합니다. https:// 로 시작하는 전체 URL을 사용하거나, 해당 페이지를 연 탭에서 실행해주세요.",
    );
  }
  try {
    return new URL(trimmed, tabUrl).href;
  } catch {
    return trimmed;
  }
}

export const gotoAction: ActionFn = async (tabId, params, options) => {
  if (options?.validationOnly) return;
  const url = params?.url;
  if (!url) throw new Error("nav.goto requires a 'url' param");

  let tabUrl: string | undefined;
  if (typeof chrome !== "undefined" && chrome.tabs?.get) {
    try {
      const tab = await chrome.tabs.get(tabId);
      tabUrl = tab?.url;
    } catch {
      tabUrl = undefined;
    }
  }

  const resolved = resolveNavigateUrl(url, tabUrl);
  await cdp.navigate(tabId, resolved);
};

export const waitAction: ActionFn = async (_tabId, params, options) => {
  if (options?.validationOnly) return;
  const ms = params?.ms ?? 1000;
  await new Promise((resolve) => setTimeout(resolve, ms));
};

export const scrollToAction: ActionFn = async (tabId, params, options) => {
  if (options?.validationOnly) return;
  const x = Number(params?.x ?? 0);
  const y = Number(params?.y);
  if (!Number.isFinite(y)) {
    throw new Error("scroll.to requires a numeric 'y' param");
  }
  await cdp.scrollToPosition(tabId, Number.isFinite(x) ? x : 0, y);
};

/** 상대 스크롤. DRR 스크롤 동작 확인용. deltaX만 있으면 가로 탭 영역 등 자동 탐색. */
export const scrollByAction: ActionFn = async (tabId, params, options) => {
  if (options?.validationOnly) return;
  const deltaY = Number(params?.deltaY ?? params?.dy ?? 0);
  const deltaX = Number(params?.deltaX ?? params?.dx ?? 0);
  const selector = typeof params?.selector === "string" ? params.selector : undefined;
  if (!Number.isFinite(deltaY) || !Number.isFinite(deltaX)) {
    throw new Error("scroll.by requires numeric deltaX and/or deltaY");
  }
  if (deltaX === 0 && deltaY === 0) {
    throw new Error("scroll.by needs non-zero deltaX or deltaY");
  }
  await cdp.scrollByDelta(tabId, deltaX, deltaY, selector);
};
