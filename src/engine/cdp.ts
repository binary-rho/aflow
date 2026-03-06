/**
 * Chrome DevTools Protocol wrapper using chrome.debugger API.
 * All methods require an active debugger session (attach first).
 */

import { DOM_PAGE_SUMMARY_SCRIPT } from "@/services/domSnapshot";

const CDP_VERSION = "1.3";
const attachedTabRefCount = new Map<number, number>();

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
      resolve();
    });
  });
}

export async function detachFromTab(tabId: number): Promise<void> {
  const currentRefCount = attachedTabRefCount.get(tabId) ?? 0;
  if (currentRefCount > 1) {
    attachedTabRefCount.set(tabId, currentRefCount - 1);
    return;
  }
  attachedTabRefCount.delete(tabId);

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

export async function click(tabId: number, selector: string, options?: { skipClick?: boolean }): Promise<void> {
  const doClick = options?.skipClick ? "false" : "true";
  await evaluate(
    tabId,
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error('Element not found: ${selector}');
      if (${doClick}) el.click();
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

export async function selectOption(
  tabId: number,
  selector: string,
  value: string,
): Promise<void> {
  await evaluate(
    tabId,
    `(() => {
      var el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error('Select not found: ${selector}');
      el.value = ${JSON.stringify(value)};
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

  await evaluate(
    tabId,
    `(() => {
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
      const isVisible = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.top < window.innerHeight && r.bottom > 0;
      };
      function score(el) {
        const elKey = key(getElementText(el));
        const directKey = key(norm(getDirectText(el)));
        if (!matchKey) return elKey ? 1 : 0;
        const inDialog = !!el.closest('[role="dialog"], [aria-modal="true"], .modal, [class*="modal"], .popup, [class*="popup"]');
        if (elKey === matchKey || directKey === matchKey) return isCloseIntent && inDialog ? 130 : 120;
        if (directKey.includes(matchKey)) return isCloseIntent && inDialog ? 95 : 70;
        if (elKey.includes(matchKey)) return isCloseIntent && inDialog ? 80 : 45;
        return 0;
      }
      function find(selector) {
        const scored = [...document.querySelectorAll(selector)]
          .filter(isVisible)
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
      const el = find(${tagJson}) || find(${fallbackJson});
      if (!el) throw new Error('Element with text not found: ' + ${searchJson});
      if (${doClick}) el.click();
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
  const doClick = options?.skipClick ? "false" : "true";

  await evaluate(
    tabId,
    `(() => {
      const textKey = ${JSON.stringify(textKey)};
      const contextKey = ${JSON.stringify(contextKey)};
      const selector = ${tagJson};
      const norm = s => (s || '').trim().replace(/\\s+/g, ' ');
      const key = s => norm(s).replace(/\\s+/g, '').replace(/[\\u207A\\u2B]/g, '+').toLowerCase();
      const isPopupContext = /(팝업|popup|modal|dialog|레이어)/i.test(contextKey);
      const isCloseIntent = /^(닫기|close|x)$/i.test(textKey);
      const isVisible = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.top < window.innerHeight && r.bottom > 0;
      };
      function getElementText(el) {
        const parts = [el.textContent || '', el.getAttribute('aria-label') || ''];
        el.querySelectorAll('img[alt]').forEach(im => { parts.push(im.getAttribute('alt') || ''); });
        return norm(parts.join(' '));
      }
      function getContextText(el) {
        const parent = el.closest('li, article, section, .card, [class*="card"], [role="dialog"], .modal, [class*="modal"], nav, header') || el.parentElement;
        return parent ? key(parent.textContent || '') : '';
      }
      const scored = [...document.querySelectorAll(selector)]
        .filter(isVisible)
        .map(el => {
          const elKey = key(getElementText(el));
          const ctxKey = getContextText(el);
          const inDialog = !!el.closest('[role="dialog"], [aria-modal="true"], .modal, [class*="modal"], .popup, [class*="popup"]');
          const textScore = elKey === textKey ? 120 : (elKey.includes(textKey) ? 70 : 0);
          const contextScore = isPopupContext
            ? (inDialog ? 90 : -30)
            : (ctxKey.includes(contextKey) ? 60 : 0);
          const closeDialogBonus = isCloseIntent && inDialog ? 25 : 0;
          return {
            el,
            score: textScore + contextScore + closeDialogBonus,
            lenGap: Math.abs(elKey.length - textKey.length),
            inDialog,
          };
        })
        .filter(x => x.score > 0);
      if (scored.length === 0) throw new Error('Element with text/context not found: ' + ${searchJson} + ' in ' + ${contextJson});
      scored.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (a.inDialog !== b.inDialog) return (b.inDialog ? 1 : 0) - (a.inDialog ? 1 : 0);
        if (a.lenGap !== b.lenGap) return a.lenGap - b.lenGap;
        return a.el.getBoundingClientRect().top - b.el.getBoundingClientRect().top;
      });
      const chosen = scored[0].el;
      if (${doClick}) chosen.click();
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

export async function type(
  tabId: number,
  selector: string,
  text: string,
): Promise<void> {
  await evaluate(
    tabId,
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error('Element not found: ${selector}');
      el.focus();
      el.value = ${JSON.stringify(text)};
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    })()`,
  );
}

export async function fillByLabel(
  tabId: number,
  label: string,
  value: string,
): Promise<void> {
  await evaluate(
    tabId,
    `(() => {
      const raw = ${JSON.stringify(label)};
      const normalize = (s) => s.replace(/[\\s\\u00A0]+/g, ' ').replace(/[\\u207A\\u⁺\\+]/g, '+').replace(/\\(.*\\)/, '').trim().toLowerCase();
      const target = normalize(raw);

      function setVal(el) {
        el.focus();
        el.value = ${JSON.stringify(value)};
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }

      // 1) <label> textContent match
      const labels = [...document.querySelectorAll('label')];
      let lbl = labels.find(l => normalize(l.textContent || '').includes(target));
      if (lbl) {
        const id = lbl.getAttribute('for');
        const el = id ? document.getElementById(id) : lbl.querySelector('input, textarea, select');
        if (el) { setVal(el); return; }
      }

      // 2) placeholder match
      const inputs = [...document.querySelectorAll('input, textarea, select')];
      let byPh = inputs.find(el => normalize(el.getAttribute('placeholder') || '').includes(target));
      if (byPh) { setVal(byPh); return; }

      // 3) aria-label match
      let byAria = inputs.find(el => normalize(el.getAttribute('aria-label') || '').includes(target));
      if (byAria) { setVal(byAria); return; }

      // 4) preceding text node / sibling text match
      let byText = inputs.find(el => {
        const prev = el.previousElementSibling;
        if (prev && normalize(prev.textContent || '').includes(target)) return true;
        const parent = el.closest('.form-group, .field, [class*="input"], [class*="form"]');
        if (parent && normalize(parent.textContent || '').includes(target)) return true;
        return false;
      });
      if (byText) { setVal(byText); return; }

      throw new Error('Label not found: ' + raw);
    })()`,
  );
}

/** label로 입력 요소 존재 여부만 확인 (검증 전용, 입력하지 않음). */
export async function checkFillByLabel(tabId: number, label: string): Promise<void> {
  await evaluate(
    tabId,
    `(() => {
      const raw = ${JSON.stringify(label)};
      const normalize = (s) => s.replace(/[\\s\\u00A0]+/g, ' ').replace(/[\\u207A\\u⁺\\+]/g, '+').replace(/\\(.*\\)/, '').trim().toLowerCase();
      const target = normalize(raw);
      const labels = [...document.querySelectorAll('label')];
      if (labels.find(l => normalize(l.textContent || '').includes(target))) return;
      const inputs = [...document.querySelectorAll('input, textarea, select')];
      if (inputs.find(el => normalize(el.getAttribute('placeholder') || '').includes(target))) return;
      if (inputs.find(el => normalize(el.getAttribute('aria-label') || '').includes(target))) return;
      if (inputs.find(el => {
        const prev = el.previousElementSibling;
        if (prev && normalize(prev.textContent || '').includes(target)) return true;
        const parent = el.closest('.form-group, .field, [class*="input"], [class*="form"]');
        return parent && normalize(parent.textContent || '').includes(target);
      })) return;
      throw new Error('Label not found: ' + raw);
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
