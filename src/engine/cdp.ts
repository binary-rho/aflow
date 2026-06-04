/**
 * Chrome DevTools Protocol wrapper using chrome.debugger API.
 * All methods require an active debugger session (attach first).
 */

import { DOM_PAGE_SUMMARY_SCRIPT } from "@/services/domSnapshot";
import { buildClientActiveScopeScript } from "@/services/scopeResolver";

/** React 등 제어 컴포넌트에서 value 직접 대입이 무시되는 경우 대비 (네이티브 setter + InputEvent) */
const FLUX_SET_INPUT_VALUE_JS = `
function __fluxSetInputValue(el, text) {
  var tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') {
    var Proto = tag === 'INPUT' ? window.HTMLInputElement.prototype : window.HTMLTextAreaElement.prototype;
    var desc = Object.getOwnPropertyDescriptor(Proto, 'value');
    if (desc && desc.set) {
      desc.set.call(el, text);
    } else {
      el.value = text;
    }
  } else {
    el.value = text;
  }
  try {
    el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertFromPaste' }));
  } catch (e1) {
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  el.dispatchEvent(new Event('change', { bubbles: true }));
}
`.trim();

/**
 * selector로 element를 찾을 때 활성 모달을 우선 검색하고, visible 우선으로 고른다.
 * 모달에서 visible한 게 없으면 document 전체로 fallback.
 */
const FLUX_PICK_VISIBLE_BY_SELECTOR_JS = `
${buildClientActiveScopeScript()}
function __fluxIsVisibleEnough(el) {
  if (!el) return false;
  var rect = el.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return false;
  var st = window.getComputedStyle(el);
  if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) return false;
  return true;
}
function __fluxPickFirstVisible(list) {
  for (var i = 0; i < list.length; i++) {
    if (__fluxIsVisibleEnough(list[i])) return list[i];
  }
  return list.length > 0 ? list[0] : null;
}
function __fluxPickVisibleBySelector(selector) {
  var modal = fluxFindActiveModal();
  if (modal) {
    var inModal = [].slice.call(modal.querySelectorAll(selector));
    if (inModal.length > 0) {
      var hit = __fluxPickFirstVisible(inModal);
      if (hit && __fluxIsVisibleEnough(hit)) return hit;
    }
  }
  var all = [].slice.call(document.querySelectorAll(selector));
  if (all.length === 0) return null;
  return __fluxPickFirstVisible(all);
}
`.trim();

/**
 * 라벨로 후보 input을 모은 뒤, 각 요소 중심에서 elementsFromPoint 스택에 더 위쪽(앞쪽 인덱스)에 오는 것을 선택.
 * 본인인증 팝업 뒤에 같은 placeholder를 가진 페이지 본문 필드가 있어도 모달 쪽을 우선한다.
 */
const FLUX_PICK_FILL_TARGET_BY_LABEL_JS = `
function __fluxNormalizeFillLabel(s) {
  return s.replace(/[\\s\\u00A0]+/g, ' ').replace(/[\\u207A\\u⁺\\+]/g, '+').replace(/\\(.*\\)/, '').trim().toLowerCase();
}
function __fluxInOverlayContainer(el) {
  return !!el.closest(
    '[role="dialog"],[role="alertdialog"],[aria-modal="true"],' +
    '[popover]:popover-open,[class*="modal"],[class*="Modal"],[class*="popup"],[class*="Popup"],' +
    '[class*="overlay"],[class*="Overlay"],[class*="bottomsheet"],[class*="bottom-sheet"],[class*="layer"],[class*="Layer"]'
  );
}
function __fluxPickFillTargetByLabel(raw) {
  var target = __fluxNormalizeFillLabel(raw);
  var candidates = [];
  var seen = new Set();
  function add(el) {
    if (!el || seen.has(el)) return;
    var t = el.tagName;
    if (t !== 'INPUT' && t !== 'TEXTAREA' && t !== 'SELECT') return;
    seen.add(el);
    candidates.push(el);
  }
  var labels = [].slice.call(document.querySelectorAll('label'));
  for (var li = 0; li < labels.length; li++) {
    var lbl = labels[li];
    if (!__fluxNormalizeFillLabel(lbl.textContent || '').includes(target)) continue;
    var id = lbl.getAttribute('for');
    var el = id ? document.getElementById(id) : lbl.querySelector('input, textarea, select');
    add(el);
  }
  var inputs = [].slice.call(document.querySelectorAll('input, textarea, select'));
  for (var ii = 0; ii < inputs.length; ii++) {
    if (__fluxNormalizeFillLabel(inputs[ii].getAttribute('placeholder') || '').includes(target)) add(inputs[ii]);
  }
  for (var ij = 0; ij < inputs.length; ij++) {
    if (__fluxNormalizeFillLabel(inputs[ij].getAttribute('aria-label') || '').includes(target)) add(inputs[ij]);
  }
  for (var ik = 0; ik < inputs.length; ik++) {
    var inp = inputs[ik];
    var prev = inp.previousElementSibling;
    if (prev && __fluxNormalizeFillLabel(prev.textContent || '').includes(target)) {
      add(inp);
      continue;
    }
    var parent = inp.closest('.form-group, .field, [class*="input"], [class*="form"]');
    if (parent && __fluxNormalizeFillLabel(parent.textContent || '').includes(target)) add(inp);
  }
  // 폴백: 라벨/placeholder로 못 찾았을 때.
  // 주소찾기 검색창처럼 모달 안에 입력 가능한 텍스트 input이 하나뿐이면 그것을 쓴다.
  if (candidates.length === 0) {
    function __fluxIsTypable(el) {
      if (el.tagName === 'SELECT') return false;
      var t = (el.getAttribute('type') || '').toLowerCase();
      if (t === 'hidden' || t === 'checkbox' || t === 'radio' || t === 'submit' || t === 'button') return false;
      if (el.disabled || el.readOnly) return false;
      var rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return false;
      var st = window.getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden') return false;
      return true;
    }
    var typable = inputs.filter(__fluxIsTypable);
    var inOverlay = typable.filter(__fluxInOverlayContainer);
    if (inOverlay.length === 1) return inOverlay[0];
    if (typable.length === 1) return typable[0];
    return null;
  }
  function isVisibleEnough(el) {
    var rect = el.getBoundingClientRect();
    var vw = window.innerWidth || 0;
    var vh = window.innerHeight || 0;
    if (rect.bottom <= 0 || rect.top >= vh || rect.right <= 0 || rect.left >= vw) return false;
    if (rect.width < 1 || rect.height < 1) return false;
    var st = window.getComputedStyle(el);
    if (st.visibility === 'hidden' || st.display === 'none' || Number(st.opacity) === 0) return false;
    return true;
  }
  var pool = candidates.filter(isVisibleEnough);
  if (pool.length === 0) pool = candidates;
  function stackingHitIndex(el) {
    var rect = el.getBoundingClientRect();
    var x = rect.left + rect.width / 2;
    var y = rect.top + rect.height / 2;
    var margin = 2;
    var vw = Math.max(window.innerWidth || 0, 1);
    var vh = Math.max(window.innerHeight || 0, 1);
    var cx = Math.min(Math.max(x, margin), vw - margin);
    var cy = Math.min(Math.max(y, margin), vh - margin);
    var stack;
    try {
      stack = document.elementsFromPoint(cx, cy);
    } catch (e) {
      return 1e9;
    }
    if (!stack || stack.length === 0) return 1e9;
    var idx = stack.indexOf(el);
    if (idx >= 0) return idx;
    return 1e9;
  }
  pool.sort(function (a, b) {
    var ia = stackingHitIndex(a);
    var ib = stackingHitIndex(b);
    if (ia !== ib) return ia - ib;
    var da = __fluxInOverlayContainer(a);
    var db = __fluxInOverlayContainer(b);
    if (da && !db) return -1;
    if (!da && db) return 1;
    return 0;
  });
  return pool[0];
}
`.trim();

const CDP_VERSION = "1.3";
const attachedTabRefCount = new Map<number, number>();

// ── networkidle 추적 ──────────────────────────────────────────────
// 버튼 클릭 → API 호출 → 응답 → DOM 갱신 흐름에서, DOM이 조용한 시점을 "완료"로
// 오판하지 않도록 진행 중(in-flight) 네트워크 요청 수를 tabId별로 센다.
const inFlightRequests = new Map<number, Set<string>>();
let networkEventListenerRegistered = false;

function bumpRequest(tabId: number, requestId: string, delta: 1 | -1): void {
  let set = inFlightRequests.get(tabId);
  if (!set) {
    if (delta < 0) return;
    set = new Set();
    inFlightRequests.set(tabId, set);
  }
  if (delta > 0) set.add(requestId);
  else set.delete(requestId);
}

function getInFlightCount(tabId: number): number {
  return inFlightRequests.get(tabId)?.size ?? 0;
}

function ensureNetworkEventListener(): void {
  if (networkEventListenerRegistered) return;
  networkEventListenerRegistered = true;
  chrome.debugger.onEvent.addListener((source, method, params: any) => {
    const tabId = source.tabId;
    if (tabId == null || !inFlightRequests.has(tabId)) return;
    const reqId = params?.requestId;
    if (!reqId) return;
    if (method === "Network.requestWillBeSent") {
      bumpRequest(tabId, reqId, 1);
    } else if (
      method === "Network.loadingFinished" ||
      method === "Network.loadingFailed"
    ) {
      bumpRequest(tabId, reqId, -1);
    }
  });
}

export function isAttached(tabId: number): boolean {
  return (attachedTabRefCount.get(tabId) ?? 0) > 0;
}

export async function attachToTab(tabId: number): Promise<void> {
  const currentRefCount = attachedTabRefCount.get(tabId) ?? 0;
  if (currentRefCount > 0) {
    attachedTabRefCount.set(tabId, currentRefCount + 1);
    return;
  }

  return new Promise((resolve, reject) => {
    chrome.debugger.attach({ tabId }, CDP_VERSION, () => {
      if (chrome.runtime.lastError) {
        const errorMessage = chrome.runtime.lastError.message || "";
        const isAlreadyAttachedError =
          errorMessage.includes("Another debugger is already attached") ||
          errorMessage.includes("Debugger is already attached");
        if (isAlreadyAttachedError) {
          // Attach happened from a previous rapid run; treat as attached.
          attachedTabRefCount.set(tabId, 1);
          resolve();
          return;
        }
        reject(new Error(errorMessage));
        return;
      }
      attachedTabRefCount.set(tabId, 1);
      enableNetworkTracking(tabId);
      resolve();
    });
  });
}

/** networkidle용 Network 도메인 enable + in-flight Set 초기화. attach 직후 호출. */
function enableNetworkTracking(tabId: number): void {
  ensureNetworkEventListener();
  inFlightRequests.set(tabId, new Set());
  // best-effort: enable 실패해도 다른 기능은 동작해야 하므로 에러 무시
  sendCommand(tabId, "Network.enable", {}).catch(() => {});
}

export async function detachFromTab(tabId: number): Promise<void> {
  const currentRefCount = attachedTabRefCount.get(tabId) ?? 0;
  if (currentRefCount > 1) {
    attachedTabRefCount.set(tabId, currentRefCount - 1);
    return;
  }
  attachedTabRefCount.delete(tabId);
  inFlightRequests.delete(tabId);

  return new Promise((resolve) => {
    chrome.debugger.detach({ tabId }, () => {
      resolve();
    });
  });
}

async function sendCommand(
  tabId: number,
  method: string,
  params?: Record<string, any>,
): Promise<any> {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params ?? {}, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(result);
      }
    });
  });
}

export async function navigate(tabId: number, url: string): Promise<void> {
  await sendCommand(tabId, "Page.navigate", { url });
  await waitForNavigation(tabId);
}

export async function scrollToPosition(
  tabId: number,
  x: number,
  y: number,
  options?: { skipScroll?: boolean },
): Promise<void> {
  if (options?.skipScroll) return;
  await evaluate(
    tabId,
    `(() => {
      window.scrollTo({
        left: ${Number.isFinite(x) ? x : 0},
        top: ${Number.isFinite(y) ? y : 0},
        behavior: "auto"
      });
    })()`,
  );
}

/**
 * 상대 스크롤. selector가 있으면 해당 요소, 없으면 세로는 window, 가로만일 때는 가로 스크롤 가능한 첫 요소(탭바 등)를 시도.
 */
export async function scrollByDelta(
  tabId: number,
  deltaX: number,
  deltaY: number,
  selector?: string | null,
): Promise<void> {
  const dx = Number.isFinite(deltaX) ? deltaX : 0;
  const dy = Number.isFinite(deltaY) ? deltaY : 0;
  const selJson = JSON.stringify(selector?.trim() || "");
  await evaluate(
    tabId,
    `(() => {
      var dx = ${dx}, dy = ${dy};
      var sel = ${selJson};
      if (sel) {
        var e = document.querySelector(sel);
        if (e) { e.scrollBy({ left: dx, top: dy, behavior: 'instant' }); return; }
      }
      if (dx !== 0 && dy === 0) {
        var best = null, bestGap = 0;
        document.querySelectorAll('div, nav, ul, section').forEach(function(el) {
          var gap = el.scrollWidth - el.clientWidth;
          if (gap > bestGap && gap > 30) { bestGap = gap; best = el; }
        });
        if (best) { best.scrollBy({ left: dx, behavior: 'instant' }); return; }
      }
      window.scrollBy({ left: dx, top: dy, behavior: 'instant' });
    })()`,
  );
}

const LAZY_RENDER_WAIT_MS = 400;

/** 페이지를 뷰포트 높이의 일정 비율만큼 아래로 스크롤하고, 렌더링이 반영될 때까지 잠시 기다린다. */
export async function scrollDownByViewport(tabId: number, fraction = 0.85): Promise<void> {
  await evaluate(
    tabId,
    `window.scrollBy({ top: window.innerHeight * ${fraction}, behavior: 'instant' })`,
  );
  await new Promise((r) => setTimeout(r, LAZY_RENDER_WAIT_MS));
}

/** 현재 스크롤이 페이지 하단인지 확인한다. */
export async function isAtPageBottom(tabId: number): Promise<boolean> {
  return evaluate(
    tabId,
    `(window.scrollY + window.innerHeight) >= document.body.scrollHeight - 50`,
  );
}

export async function waitForNavigation(tabId: number): Promise<void> {
  const LOAD_POLL_INTERVAL_MS = 300;
  const LOAD_TIMEOUT_MS = 15000;

  const start = Date.now();
  while (Date.now() - start < LOAD_TIMEOUT_MS) {
    try {
      const result = await evaluate(tabId, "document.readyState");
      if (result === "complete" || result === "interactive") return;
    } catch {
      // page may be transitioning
    }
    await sleep(LOAD_POLL_INTERVAL_MS);
  }
}

const READY_POLL_MS = 80;
const READY_DOM_QUIET_MS = 200;
const READY_MAX_WAIT_MS = 15000;

// networkidle: in-flight 요청이 0인 상태가 NETWORK_IDLE_MS 동안 유지되면 "네트워크 안정"으로 간주
const NETWORK_IDLE_MS = 500;
const NETWORK_IDLE_POLL_MS = 100;
const NETWORK_IDLE_MAX_WAIT_MS = 15000;

/**
 * 진행 중인 네트워크 요청이 0인 상태가 NETWORK_IDLE_MS 동안 이어질 때까지 대기.
 * 버튼 클릭 후 API 응답이 끝나고 화면이 갱신될 시간을 벌어준다.
 * Network 추적이 비활성(미attach 등)이면 즉시 반환한다.
 */
export async function waitForNetworkIdle(tabId: number): Promise<void> {
  if (!inFlightRequests.has(tabId)) return;
  const deadline = Date.now() + NETWORK_IDLE_MAX_WAIT_MS;
  let idleSince: number | null = null;
  while (Date.now() < deadline) {
    if (getInFlightCount(tabId) === 0) {
      if (idleSince == null) idleSince = Date.now();
      if (Date.now() - idleSince >= NETWORK_IDLE_MS) return;
    } else {
      idleSince = null;
    }
    await sleep(NETWORK_IDLE_POLL_MS);
  }
}

// expectChange 모드에서, 액션 직후 첫 DOM 변화(로딩 시작)를 이만큼 기다린다.
// 그 안에 변화가 없으면(이미 끝났거나 변화 없는 액션) 그냥 통과해 무한 대기를 막는다.
const READY_CHANGE_START_MS = 1200;

/**
 * 문서 로드 완료 후, DOM이 더 이상 바뀌지 않을 때까지 대기(실제 렌더 안정).
 * - document.readyState === 'complete'|'interactive' 일 때까지 폴링
 * - MutationObserver로 DOM 변경 감지 후, 변경이 READY_DOM_QUIET_MS 동안 없으면 "렌더 완료"로 간주
 *
 * @param opts.expectChange true면 액션 직후 호출용 — "변화 시작"을 먼저 기다린 뒤 quiet 판정.
 *   클릭 → (로딩 스피너/네트워크) → 결과 흐름에서 변화가 시작되기도 전에 "조용함=완료"로
 *   오판하는 것을 막는다. 변화가 READY_CHANGE_START_MS 안에 없으면 통과.
 */
export async function waitForPageReady(
  tabId: number,
  opts?: { expectChange?: boolean },
): Promise<void> {
  const expectChange = opts?.expectChange ?? false;
  const deadline = Date.now() + READY_MAX_WAIT_MS;
  while (Date.now() < deadline) {
    try {
      const state = await evaluate(tabId, "document.readyState");
      if (state !== "complete" && state !== "interactive") {
        await sleep(READY_POLL_MS);
        continue;
      }
      await evaluate(
        tabId,
        `new Promise(function(resolve) {
          var quietMs = ${READY_DOM_QUIET_MS};
          var expectChange = ${expectChange ? "true" : "false"};
          var changeStartMs = ${READY_CHANGE_START_MS};
          var timer = null;
          var changed = false;
          var done = function() {
            if (timer) clearTimeout(timer);
            observer.disconnect();
            resolve();
          };
          var observer = new MutationObserver(function() {
            changed = true;
            if (timer) clearTimeout(timer);
            timer = setTimeout(done, quietMs);
          });
          var root = document.documentElement || document.body;
          if (!root) { resolve(); return; }
          observer.observe(root, {
            childList: true,
            subtree: true,
            attributes: true,
            characterData: true
          });
          if (expectChange) {
            // 변화가 시작되면 위 observer가 quiet 타이머를 건다.
            // changeStartMs 안에 아무 변화도 없으면(이미 끝났거나 변화 없는 액션) 통과.
            timer = setTimeout(function() { if (!changed) done(); }, changeStartMs);
          } else {
            timer = setTimeout(done, quietMs);
          }
        })`,
      );
      return;
    } catch {
      await sleep(READY_POLL_MS);
    }
  }
}

const HIGHLIGHT_DELAY_MS = 500;

/**
 * 요소를 하이라이트한 뒤 딜레이 후 콜백(클릭 등)을 실행하는 인라인 스크립트.
 * evaluate 한 번으로 하이라이트 → 대기 → 클릭을 처리해 DOM 참조가 끊기지 않는다.
 */
function buildHighlightAndActScript(doClick: boolean): string {
  return `
    function __fluxHighlightAndAct__(el, shouldClick) {
      return new Promise(function(resolve) {
        if (!el) { resolve(); return; }
        var old = document.getElementById('__flux_highlight__');
        if (old) old.remove();
        var r = el.getBoundingClientRect();
        var ov = document.createElement('div');
        ov.id = '__flux_highlight__';
        Object.assign(ov.style, {
          position: 'fixed',
          left: r.left + 'px', top: r.top + 'px',
          width: r.width + 'px', height: r.height + 'px',
          border: '2px solid #ff2d78', borderRadius: '4px',
          background: 'rgba(255, 45, 120, 0.15)',
          pointerEvents: 'none', zIndex: '2147483647',
          boxSizing: 'border-box', transition: 'opacity 0.3s ease', opacity: '1',
        });
        document.body.appendChild(ov);
        setTimeout(function() {
          if (shouldClick) el.click();
          ov.style.opacity = '0';
          setTimeout(function() { ov.remove(); resolve(); }, 300);
        }, ${HIGHLIGHT_DELAY_MS});
      });
    }
  `;
}

export async function click(tabId: number, selector: string, options?: { skipClick?: boolean }): Promise<void> {
  const shouldClick = !options?.skipClick;
  await evaluate(
    tabId,
    `(async () => {
      ${buildHighlightAndActScript(shouldClick)}
      ${FLUX_PICK_VISIBLE_BY_SELECTOR_JS}
      const el = __fluxPickVisibleBySelector(${JSON.stringify(selector)});
      if (!el) throw new Error('Element not found: ${selector}');
      const r = el.getBoundingClientRect();
      const outOfViewport = r.top >= window.innerHeight || r.bottom <= 0;
      if (outOfViewport) el.scrollIntoView({ block: 'center' });
      await __fluxHighlightAndAct__(el, ${shouldClick});
    })()`,
  );
}

async function moveMouseToElement(tabId: number, getRect: string): Promise<void> {
  const rect = await evaluate(tabId, getRect);
  if (!rect || typeof rect.x !== "number") {
    throw new Error("hover 대상 요소를 찾을 수 없습니다.");
  }
  const x = Math.round(rect.x + rect.width / 2);
  const y = Math.round(rect.y + rect.height / 2);
  await sendCommand(tabId, "Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x,
    y,
  });
}

export async function hover(tabId: number, selector: string): Promise<void> {
  const rectExpr = `(() => {
    var el = document.querySelector(${JSON.stringify(selector)});
    if (!el) throw new Error('Element not found: ${selector}');
    var r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  })()`;
  await moveMouseToElement(tabId, rectExpr);
}

export async function hoverByText(
  tabId: number,
  text: string,
  tag = "*",
): Promise<void> {
  const normText = normalizeForMatch(text);
  const rectExpr = `(() => {
    var norm = function(s) { return (s || '').trim().replace(/\\s+/g, '').replace(/[\\u207A⁺]/g, '+').toLowerCase(); };
    var els = document.querySelectorAll(${JSON.stringify(tag)});
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var t = norm(el.innerText || el.textContent || el.getAttribute('aria-label') || '');
      if (t.indexOf(${JSON.stringify(normText)}) >= 0 || ${JSON.stringify(normText)}.indexOf(t) >= 0) {
        var r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      }
    }
    throw new Error('No element found with text: ${text}');
  })()`;
  await moveMouseToElement(tabId, rectExpr);
}

export async function hoverByTextWithContext(
  tabId: number,
  text: string,
  context: string,
  tag = "*",
): Promise<void> {
  const textKey = normalizeForMatch(text);
  const contextKey = normalizeForMatch(context);
  const tagJson = JSON.stringify(tag);

  const rectExpr = `(() => {
    var textKey = ${JSON.stringify(textKey)};
    var contextKey = ${JSON.stringify(contextKey)};
    var selector = ${tagJson};
    var norm = function(s) { return (s || '').trim().replace(/\\s+/g, ' '); };
    var key = function(s) { return norm(s).replace(/\\s+/g, '').replace(/[\\u207A\\u2B]/g, '+').toLowerCase(); };
    var isGnbContext = /(gnb|대메뉴|소메뉴|메인메뉴|네비게이션)/i.test(contextKey);

    function getElementText(el) {
      var parts = [el.textContent || '', el.getAttribute('aria-label') || ''];
      [].slice.call(el.querySelectorAll('img[alt]')).forEach(function(im) { parts.push(im.getAttribute('alt') || ''); });
      return norm(parts.join(' '));
    }
    function getContextText(el) {
      var parent = el.closest('li, article, section, nav, header, [class*="gnb"], [class*="menu"], [role="navigation"], [role="menubar"]') || el.parentElement;
      return key(parent ? (parent.textContent || '') : '');
    }
    function isInGnbArea(el) {
      return !!el.closest('nav, header, [class*="gnb"], [class*="menu"], [role="navigation"], [role="menubar"]');
    }

    var els = document.querySelectorAll(selector);
    var scored = [];
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      var elKey = key(getElementText(el));
      var textMatch = (elKey === textKey) ? 120 : (elKey.includes(textKey) || textKey.includes(elKey)) ? 70 : 0;
      if (textMatch === 0) continue;
      var ctxKey = getContextText(el);
      var contextScore = ctxKey.includes(contextKey) ? 60 : 0;
      var gnbBonus = isGnbContext && isInGnbArea(el) ? 80 : 0;
      scored.push({
        el: el,
        score: textMatch + contextScore + gnbBonus,
        lenGap: Math.abs(elKey.length - textKey.length)
      });
    }
    if (scored.length === 0) throw new Error('Hover target with text/context not found: ' + ${JSON.stringify(text)} + ' in ' + ${JSON.stringify(context)});
    scored.sort(function(a, b) {
      if (b.score !== a.score) return b.score - a.score;
      if (a.lenGap !== b.lenGap) return a.lenGap - b.lenGap;
      return a.el.getBoundingClientRect().top - b.el.getBoundingClientRect().top;
    });
    var chosen = scored[0].el;
    var cr = chosen.getBoundingClientRect();
    var outOfViewport = cr.top >= window.innerHeight || cr.bottom <= 0;
    if (outOfViewport) chosen.scrollIntoView({ block: 'center' });
    cr = chosen.getBoundingClientRect();
    return { x: cr.x, y: cr.y, width: cr.width, height: cr.height };
  })()`;
  await moveMouseToElement(tabId, rectExpr);
}

export async function selectOption(
  tabId: number,
  selector: string,
  value: string,
  optionText?: string,
): Promise<void> {
  await evaluate(
    tabId,
    `(() => {
      ${FLUX_PICK_VISIBLE_BY_SELECTOR_JS}
      var el = __fluxPickVisibleBySelector(${JSON.stringify(selector)});
      if (!el) throw new Error('Select not found: ${selector}');
      var optionText = ${JSON.stringify(optionText ?? "")};
      var targetValue = ${JSON.stringify(value)};
      var norm = function(s) { return (s || '').trim().replace(/\\s+/g, ' ').toLowerCase(); };

      if (el.tagName === 'SELECT') {
        var opts = [].slice.call(el.options);
        var matched = null;

        if (optionText) {
          var nt = norm(optionText);
          matched = opts.find(function(o) { return norm(o.text) === nt; })
                 || opts.find(function(o) { return norm(o.text).includes(nt) || nt.includes(norm(o.text)); });
        }
        if (!matched && targetValue) {
          matched = opts.find(function(o) { return o.value === targetValue; })
                 || opts.find(function(o) { return norm(o.text) === norm(targetValue); })
                 || opts.find(function(o) { return norm(o.text).includes(norm(targetValue)) || norm(targetValue).includes(norm(o.text)); });
        }
        if (!matched) throw new Error('Option not found: ' + (optionText || targetValue));
        el.value = matched.value;
      } else {
        el.value = targetValue;
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    })()`,
  );
}

/** 공백 하나로 축약 (비교용). */
function normalizeText(s: string): string {
  return (s ?? "").trim().replace(/\s+/g, " ");
}

/** 대소문자·공백·유니코드 기호 무시 비교용 (예: "U⁺ ID" ↔ "U+ ID" ↔ "u+id"). */
function normalizeForMatch(s: string): string {
  return (s ?? "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/[\u207A⁺]/g, "+")
    .toLowerCase();
}

export async function clickByText(
  tabId: number,
  text: string,
  tag = "*",
  options?: { skipClick?: boolean },
): Promise<void> {
  const normalizedSearch = normalizeText(text);
  const matchKey = normalizeForMatch(text);
  const searchJson = JSON.stringify(normalizedSearch);
  const matchKeyJson = JSON.stringify(matchKey);
  const tagJson = JSON.stringify(tag);
  const fallbackSelector = tag === "*" ? "*" : tag + ", div";
  const fallbackJson = JSON.stringify(fallbackSelector);
  const doClick = options?.skipClick ? "false" : "true";

  const shouldClick = !options?.skipClick;
  await evaluate(
    tabId,
    `(async () => {
      ${buildHighlightAndActScript(shouldClick)}
      const matchKey = ${matchKeyJson};
      const norm = s => (s || '').trim().replace(/\\s+/g, ' ');
      const key = s => norm(s).replace(/\\s+/g, '').replace(/[\\u207A\\u2B]/g, '+').toLowerCase();
      const isCloseIntent = /^(닫기|close|x)$/i.test(matchKey);
      function getDirectText(el) {
        let t = '';
        el.childNodes.forEach(n => { if (n.nodeType === 3) t += n.textContent; });
        return t;
      }
      function getElementText(el) {
        const parts = [el.textContent || '', el.getAttribute('aria-label') || ''];
        el.querySelectorAll('img[alt]').forEach(im => { parts.push(im.getAttribute('alt') || ''); });
        return norm(parts.join(' '));
      }
      const isInDOM = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const isInViewport = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.top < window.innerHeight && r.bottom > 0;
      };
      function score(el) {
        const elKey = key(getElementText(el));
        const directKey = key(norm(getDirectText(el)));
        if (!matchKey) return elKey ? 1 : 0;
        const inDialog = !!el.closest('[role="dialog"], [role="alertdialog"], [aria-modal="true"], .modal, [class*="modal"], .popup, [class*="popup"], [class*="bottomsheet"], [class*="bottom-sheet"], [class*="bottom_sheet"], [role="tooltip"], [popover]');
        if (elKey === matchKey || directKey === matchKey) return isCloseIntent && inDialog ? 130 : 120;
        if (directKey.includes(matchKey)) return isCloseIntent && inDialog ? 95 : 70;
        if (elKey.includes(matchKey)) return isCloseIntent && inDialog ? 80 : 45;
        return 0;
      }
      function find(selector, visCheck) {
        const scored = [...document.querySelectorAll(selector)]
          .filter(visCheck)
          .map(el => ({ el, s: score(el) }))
          .filter(x => x.s > 0);
        if (scored.length === 0) return null;
        scored.sort((a, b) => {
          if (b.s !== a.s) return b.s - a.s;
          const keyOf = (el) => key(getElementText(el));
          const lenGapA = Math.abs(keyOf(a.el).length - matchKey.length);
          const lenGapB = Math.abs(keyOf(b.el).length - matchKey.length);
          if (lenGapA !== lenGapB) return lenGapA - lenGapB;
          const topA = a.el.getBoundingClientRect().top;
          const topB = b.el.getBoundingClientRect().top;
          return topA - topB;
        });
        return scored[0].el;
      }
      var el = find(${tagJson}, isInViewport) || find(${fallbackJson}, isInViewport);
      if (!el) el = find(${tagJson}, isInDOM) || find(${fallbackJson}, isInDOM);
      if (!el) throw new Error('Element with text not found: ' + ${searchJson});
      if (!isInViewport(el)) el.scrollIntoView({ block: 'center' });
      await __fluxHighlightAndAct__(el, ${shouldClick});
    })()`,
  );
}

export async function clickByTextWithContext(
  tabId: number,
  text: string,
  context: string,
  tag = "*",
  options?: { skipClick?: boolean },
): Promise<void> {
  const textKey = normalizeForMatch(text);
  const contextKey = normalizeForMatch(context);
  const searchJson = JSON.stringify(normalizeText(text));
  const contextJson = JSON.stringify(normalizeText(context));
  const tagJson = JSON.stringify(tag);
  const shouldClick = !options?.skipClick;

  await evaluate(
    tabId,
    `(async () => {
      ${buildHighlightAndActScript(shouldClick)}
      const textKey = ${JSON.stringify(textKey)};
      const contextKey = ${JSON.stringify(contextKey)};
      const selector = ${tagJson};
      const norm = s => (s || '').trim().replace(/\\s+/g, ' ');
      const key = s => norm(s).replace(/\\s+/g, '').replace(/[\\u207A\\u2B]/g, '+').toLowerCase();
      const isPopupContext = /(팝업|popup|modal|dialog|레이어|bottomsheet|bottom[-_]?sheet|바텀시트|tooltip|툴팁|toast|토스트)/i.test(contextKey);
      const isCloseIntent = /^(닫기|close|x)$/i.test(textKey);
      const isInDOM = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const isInViewport = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.top < window.innerHeight && r.bottom > 0;
      };
      function getElementText(el) {
        const parts = [el.textContent || '', el.getAttribute('aria-label') || ''];
        el.querySelectorAll('img[alt]').forEach(im => { parts.push(im.getAttribute('alt') || ''); });
        return norm(parts.join(' '));
      }
      function getGtmText(el) {
        const container = el.closest('[data-gtm-event-label]') || el.querySelector('[data-gtm-event-label]');
        const parts = [];
        const label = (container || el).getAttribute('data-gtm-event-label');
        const clickText = (container || el).getAttribute('data-gtm-click-text');
        const location = (container || el).getAttribute('data-gtm-click-location');
        if (label) parts.push(label);
        if (clickText) parts.push(clickText);
        if (location) parts.push(location);
        return key(parts.join(' '));
      }
      function getContextText(el) {
        const parent = el.closest('li, article, section, .card, [class*="card"], [role="dialog"], .modal, [class*="modal"], nav, header, dl, [class*="priceplan"], [class*="product"]') || el.parentElement;
        var ctx = key(parent ? parent.textContent || '' : '');
        if (parent && parent.parentElement) {
          var outer = parent.parentElement.closest('section, article, [class*="product"], dl, [role="region"]');
          if (outer && outer !== parent) {
            var outerH = outer.querySelector('h1, h2, h3, h4, h5, h6, [role="heading"]');
            if (!outerH) {
              for (var oi = 0; oi < Math.min(outer.children.length, 5); oi++) {
                var oc = outer.children[oi];
                if (!oc || !oc.tagName) continue;
                var oct = oc.tagName.toLowerCase();
                if (oct === 'section' || oct === 'ul' || oct === 'ol' || oct === 'table') continue;
                if (oc.querySelector && oc.querySelector('section, article, ul, ol')) continue;
                var ocx = (oc.innerText || '').trim().replace(/\\s+/g, ' ');
                if (ocx.length >= 2 && ocx.length <= 60) { outerH = oc; break; }
              }
            }
            if (outerH) ctx += ' ' + key(outerH.textContent || '');
          }
        }
        return ctx;
      }
      function findWithContext(visCheck) {
        const scored = [...document.querySelectorAll(selector)]
          .filter(visCheck)
          .map(el => {
            const elKey = key(getElementText(el));
            const ctxKey = getContextText(el);
            const gtmKey = getGtmText(el);
            const inDialog = !!el.closest('[role="dialog"], [role="alertdialog"], [aria-modal="true"], .modal, [class*="modal"], .popup, [class*="popup"], [class*="bottomsheet"], [class*="bottom-sheet"], [class*="bottom_sheet"], [role="tooltip"], [popover]');
            const textScore = elKey === textKey ? 120 : (elKey.includes(textKey) ? 70 : 0);
            const gtmContextScore = gtmKey && gtmKey.includes(contextKey) ? 80 : 0;
            const contextScore = isPopupContext
              ? (inDialog ? 90 : -30)
              : (ctxKey.includes(contextKey) ? 60 : gtmContextScore);
            const closeDialogBonus = isCloseIntent && inDialog ? 25 : 0;
            return {
              el,
              score: textScore + Math.max(contextScore, gtmContextScore) + closeDialogBonus,
              lenGap: Math.abs(elKey.length - textKey.length),
              inDialog,
            };
          })
          .filter(x => x.score > 0);
        if (scored.length === 0) return null;
        scored.sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          if (a.inDialog !== b.inDialog) return (b.inDialog ? 1 : 0) - (a.inDialog ? 1 : 0);
          if (a.lenGap !== b.lenGap) return a.lenGap - b.lenGap;
          return a.el.getBoundingClientRect().top - b.el.getBoundingClientRect().top;
        });
        return scored[0].el;
      }
      var chosen = findWithContext(isInViewport);
      if (!chosen) chosen = findWithContext(isInDOM);
      if (!chosen) throw new Error('Element with text/context not found: ' + ${searchJson} + ' in ' + ${contextJson});
      if (!isInViewport(chosen)) chosen.scrollIntoView({ block: 'center' });
      await __fluxHighlightAndAct__(chosen, ${shouldClick});
    })()`,
  );
}

/** GNB/헤더·드롭다운 포함해 "로그인" 버튼 찾아 클릭. 드롭다운 안에 있어도 찾을 수 있도록 visibility 제한 완화. */
export async function clickLoginInGNB(
  tabId: number,
  options?: { skipClick?: boolean },
): Promise<void> {
  const doClick = options?.skipClick ? "false" : "true";
  await evaluate(
    tabId,
    `(() => {
      const norm = s => (s || '').trim().replace(/\\s+/g, ' ');
      const key = s => norm(s).replace(/\\s+/g, '').toLowerCase();
      const keyMatch = key('로그인');
      function getElementText(el) {
        const parts = [el.textContent || '', el.getAttribute('aria-label') || ''];
        el.querySelectorAll('img[alt]').forEach(im => { parts.push(im.getAttribute('alt') || ''); });
        return norm(parts.join(' '));
      }
      const hasLoginText = (el) => key(getElementText(el)).includes(keyMatch) || keyMatch.includes(key(getElementText(el)));
      const sel = 'button, a, [role="button"], [role="link"]';
      const all = [...document.querySelectorAll(sel)].filter(hasLoginText);
      const header = document.querySelector('header');
      const nav = document.querySelector('nav');
      const inHeader = (el) => header && header.contains(el);
      const inNav = (el) => nav && nav.contains(el);
      const topY = (el) => el.getBoundingClientRect().top;
      const visible = (el) => el.offsetParent != null && el.getBoundingClientRect().width > 0;
      var chosen = all.filter(visible)[0] || null;
      if (!chosen && all.length > 0) {
        var inGnb = all.filter(e => inHeader(e) || inNav(e));
        var topArea = all.filter(e => topY(e) < 500);
        chosen = inGnb[0] || topArea[0] || all[0];
      }
      if (!chosen) throw new Error('GNB/헤더에서 로그인 버튼을 찾을 수 없습니다.');
      if (${doClick}) chosen.click();
    })()`,
  );
}

/**
 * 입력 대상 요소를 페이지에서 준비한다(스코프 우선). 반환: { kind }
 * - radio/checkbox(kind='checkable')는 여기서 바로 click한다(값 대입 무의미).
 * - text input/textarea(kind='text')는 focus + 기존 값 비우기만 한다.
 *   실제 입력은 호출부에서 CDP 키입력(insertText) → 실패 시 value 대입 fallback 순으로.
 *   여기서 value를 미리 넣으면 이후 insertText와 누적돼 "값값" 중복이 되므로 넣지 않는다.
 * - 그 외(custom)는 즉시 value 대입(키입력이 의미 없으므로).
 *
 * pickScript: 페이지 컨텍스트에서 대상 el을 찾아 변수 `el`에 바인딩하는 JS 조각.
 */
async function prepareInputTarget(
  tabId: number,
  pickScript: string,
  value: string,
): Promise<{ kind: "checkable" | "text" | "other" }> {
  const kind = await evaluate(
    tabId,
    `(() => {
      ${FLUX_SET_INPUT_VALUE_JS}
      ${pickScript}
      if (!el) throw new Error('Input target not found');
      var t = (el.getAttribute && (el.getAttribute('type') || '')).toLowerCase();
      var tag = el.tagName;
      if (tag === 'INPUT' && (t === 'radio' || t === 'checkbox')) {
        try { el.scrollIntoView({ block: 'center' }); } catch (e) {}
        var lbl = el.id ? document.querySelector('label[for="' + el.id.replace(/"/g, '\\\\"') + '"]') : null;
        (lbl || el).click();
        return 'checkable';
      }
      if (tag === 'INPUT' || tag === 'TEXTAREA') {
        try { el.focus(); } catch (e) {}
        // 기존 값을 비우고(이전 입력/자동완성 잔여 제거) 전체 선택 상태로 둔다.
        // value는 여기서 넣지 않는다 — insertText가 채운다.
        try {
          var setter = Object.getOwnPropertyDescriptor(
            tag === 'INPUT' ? window.HTMLInputElement.prototype : window.HTMLTextAreaElement.prototype, 'value'
          );
          if (setter && setter.set) setter.set.call(el, ''); else el.value = '';
          el.dispatchEvent(new Event('input', { bubbles: true }));
        } catch (e) {}
        try { if (el.select) el.select(); } catch (e) {}
        return 'text';
      }
      __fluxSetInputValue(el, ${JSON.stringify(value)});
      return 'other';
    })()`,
  );
  return { kind: (kind as any) || "other" };
}

/** 텍스트 입력 fallback: CDP 키입력이 실패했을 때만 value 대입으로 채운다(스코프 우선). */
async function fillValueFallback(
  tabId: number,
  pickScript: string,
  value: string,
): Promise<void> {
  await evaluate(
    tabId,
    `(() => {
      ${FLUX_SET_INPUT_VALUE_JS}
      ${pickScript}
      if (!el) return;
      __fluxSetInputValue(el, ${JSON.stringify(value)});
    })()`,
  );
}

/** CDP 실제 키입력. 현재 focus된 요소에 진짜 사용자 입력처럼 텍스트를 삽입한다. */
async function insertTextViaCDP(tabId: number, text: string): Promise<void> {
  // Input.insertText: IME/한글 조합까지 안전한 "실제 텍스트 삽입". isTrusted 이벤트 발생.
  await sendCommand(tabId, "Input.insertText", { text });
}

/** 주요 특수키의 CDP dispatchKeyEvent 파라미터. (검색창 엔터 submit 등에 필요) */
const CDP_KEY_PARAMS: Record<
  string,
  { key: string; code: string; keyCode: number; text?: string }
> = {
  Enter: { key: "Enter", code: "Enter", keyCode: 13, text: "\r" },
  Tab: { key: "Tab", code: "Tab", keyCode: 9 },
  Escape: { key: "Escape", code: "Escape", keyCode: 27 },
  Backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
  ArrowDown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  ArrowUp: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
};

/**
 * CDP로 진짜 키 입력(keyDown/keyUp)을 보낸다. 합성 KeyboardEvent와 달리 isTrusted=true라
 * 검색창의 엔터 submit, 폼 기본 동작이 실제로 발동한다.
 * 알 수 없는 키는 best-effort로 key/code만 채워 보낸다.
 */
export async function pressKey(tabId: number, key: string): Promise<void> {
  const p = CDP_KEY_PARAMS[key] || { key, code: key, keyCode: 0 };
  // Enter는 keyDown에 text("\r")를 실어야 일부 input에서 submit이 발동한다.
  await sendCommand(tabId, "Input.dispatchKeyEvent", {
    type: p.text ? "keyDown" : "rawKeyDown",
    key: p.key,
    code: p.code,
    windowsVirtualKeyCode: p.keyCode,
    nativeVirtualKeyCode: p.keyCode,
    ...(p.text ? { text: p.text } : {}),
  });
  await sendCommand(tabId, "Input.dispatchKeyEvent", {
    type: "keyUp",
    key: p.key,
    code: p.code,
    windowsVirtualKeyCode: p.keyCode,
    nativeVirtualKeyCode: p.keyCode,
  });
}

/** 모달 스코프 우선으로 selector 요소를 focus시킨다(키 입력 전 대상 지정용). */
export async function focusElement(tabId: number, selector: string): Promise<boolean> {
  return cdp_focusInScope(tabId, selector);
}
async function cdp_focusInScope(tabId: number, selector: string): Promise<boolean> {
  try {
    return await evaluate(
      tabId,
      `(() => {
        ${buildClientActiveScopeScript()}
        var el = fluxQueryInScope(${JSON.stringify(selector)});
        if (!el) return false;
        try { el.focus(); } catch (e) {}
        return document.activeElement === el;
      })()`,
    );
  } catch {
    return false;
  }
}

export async function type(
  tabId: number,
  selector: string,
  text: string,
): Promise<void> {
  const scopedPick = `${buildClientActiveScopeScript()}\nvar el = fluxQueryInScope(${JSON.stringify(selector)});`;
  const { kind } = await prepareInputTarget(tabId, scopedPick, text);
  if (kind === "text") {
    let ok = false;
    try {
      await insertTextViaCDP(tabId, text);
      ok = true;
    } catch {
      ok = false;
    }
    // insertText가 실패했거나 값이 안 들어갔으면 value 대입으로 폴백(중복 방지: 성공 시엔 안 함)
    if (!ok) await fillValueFallback(tabId, scopedPick, text);
  }
}

export async function fillByLabel(
  tabId: number,
  label: string,
  value: string,
): Promise<void> {
  const pick =
    `${FLUX_PICK_FILL_TARGET_BY_LABEL_JS}\n` +
    `var el = __fluxPickFillTargetByLabel(${JSON.stringify(label)});`;
  const { kind } = await prepareInputTarget(tabId, pick, value);
  if (kind === "text") {
    let ok = false;
    try {
      await insertTextViaCDP(tabId, value);
      ok = true;
    } catch {
      ok = false;
    }
    if (!ok) await fillValueFallback(tabId, pick, value);
  }
}

/**
 * label 텍스트로 <select>를 찾아 optionText 또는 value로 옵션을 선택한다.
 * fillByLabel과 달리 SELECT 전용 로직으로, option 텍스트 매칭을 우선한다.
 */
export async function selectByLabel(
  tabId: number,
  label: string,
  value: string,
  optionText?: string,
): Promise<void> {
  await evaluate(
    tabId,
    `(() => {
      ${FLUX_PICK_FILL_TARGET_BY_LABEL_JS}
      ${FLUX_PICK_VISIBLE_BY_SELECTOR_JS}
      var raw = ${JSON.stringify(label)};
      var el = __fluxPickFillTargetByLabel(raw);
      if (!el) throw new Error('Label not found: ' + raw);

      // label로 찾은 요소가 SELECT가 아니면 가장 가까운 SELECT를 탐색
      if (el.tagName !== 'SELECT') {
        var parent = el.closest('.form-group, .field, [class*="select"], [class*="form"], dd, div');
        var nearby = null;
        if (parent) {
          var selects = [].slice.call(parent.querySelectorAll('select'));
          for (var i = 0; i < selects.length; i++) {
            if (__fluxIsVisibleEnough(selects[i])) { nearby = selects[i]; break; }
          }
          if (!nearby && selects.length > 0) nearby = selects[0];
        }
        if (nearby) {
          el = nearby;
        } else {
          throw new Error('SELECT element not found near label: ' + raw);
        }
      }

      var optionText = ${JSON.stringify(optionText ?? "")};
      var targetValue = ${JSON.stringify(value)};
      var norm = function(s) { return (s || '').trim().replace(/\\s+/g, ' ').toLowerCase(); };
      var opts = [].slice.call(el.options);
      var matched = null;

      if (optionText) {
        var nt = norm(optionText);
        matched = opts.find(function(o) { return norm(o.text) === nt; })
               || opts.find(function(o) { return norm(o.text).includes(nt) || nt.includes(norm(o.text)); });
      }
      if (!matched && targetValue) {
        matched = opts.find(function(o) { return o.value === targetValue; })
               || opts.find(function(o) { return norm(o.text) === norm(targetValue); })
               || opts.find(function(o) { return norm(o.text).includes(norm(targetValue)) || norm(targetValue).includes(norm(o.text)); });
      }
      if (!matched) throw new Error('Option not found for label "' + raw + '": ' + (optionText || targetValue));
      el.value = matched.value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    })()`,
  );
}

/** label로 SELECT 요소 존재 여부만 확인 (검증 전용). */
export async function checkSelectByLabel(tabId: number, label: string): Promise<void> {
  await evaluate(
    tabId,
    `(() => {
      ${FLUX_PICK_FILL_TARGET_BY_LABEL_JS}
      ${FLUX_PICK_VISIBLE_BY_SELECTOR_JS}
      var raw = ${JSON.stringify(label)};
      var el = __fluxPickFillTargetByLabel(raw);
      if (!el) throw new Error('Label not found: ' + raw);
      if (el.tagName !== 'SELECT') {
        var parent = el.closest('.form-group, .field, [class*="select"], [class*="form"], dd, div');
        var nearby = null;
        if (parent) {
          var selects = [].slice.call(parent.querySelectorAll('select'));
          for (var i = 0; i < selects.length; i++) {
            if (__fluxIsVisibleEnough(selects[i])) { nearby = selects[i]; break; }
          }
          if (!nearby && selects.length > 0) nearby = selects[0];
        }
        if (!nearby) throw new Error('SELECT element not found near label: ' + raw);
      }
    })()`,
  );
}

/** label로 입력 요소 존재 여부만 확인 (검증 전용, 입력하지 않음). */
export async function checkFillByLabel(tabId: number, label: string): Promise<void> {
  await evaluate(
    tabId,
    `(() => {
      ${FLUX_PICK_FILL_TARGET_BY_LABEL_JS}
      const raw = ${JSON.stringify(label)};
      const el = __fluxPickFillTargetByLabel(raw);
      if (!el) throw new Error('Label not found: ' + raw);
    })()`,
  );
}

export async function evaluate(
  tabId: number,
  expression: string,
): Promise<any> {
  const result = await sendCommand(tabId, "Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  });

  if (result?.exceptionDetails) {
    const msg =
      result.exceptionDetails.exception?.description ||
      result.exceptionDetails.text ||
      "Evaluation error";
    throw new Error(msg);
  }

  return result?.result?.value;
}

/**
 * 시나리오 실행 중인 탭에서 페이지 요약(경량, PII 마스킹)을 수집합니다.
 * attachToTab 이후에만 호출 가능합니다. LLM 전달용으로 사용합니다.
 */
export async function captureDOMSnapshot(tabId: number): Promise<string | null> {
  try {
    const value = await evaluate(tabId, DOM_PAGE_SUMMARY_SCRIPT);
    if (typeof value !== "string") return null;
    return value;
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
