import * as cdp from "@/engine/cdp";
import { resolveElement } from "@/services/domMatcher";
import type { ActionFn } from "./index";

const CLICKABLE_BY_TEXT_SELECTOR = "button, a, [role='button'], [role='link']";

const isDynamicSelector = (s: string | undefined | null): boolean =>
  !!s && /_uid_|^#[\w-]*uid[\w-]*\d|\[name=["']?_[^"']*uid/i.test(s);

const MAX_SCROLL_RETRIES = 6;

/**
 * 클릭 함수가 "not found" 에러로 실패하면 페이지를 스크롤 다운하며 재시도.
 * lazy render로 뷰포트 밖 요소가 아직 DOM에 없는 경우를 대응.
 */
async function withScrollRetry(
  tabId: number,
  fn: () => Promise<void>,
): Promise<void> {
  for (let attempt = 0; attempt <= MAX_SCROLL_RETRIES; attempt++) {
    try {
      await fn();
      return;
    } catch (err: any) {
      const isNotFound =
        err?.message?.includes("not found") ||
        err?.message?.includes("찾을 수 없");
      if (!isNotFound || attempt === MAX_SCROLL_RETRIES) throw err;
      const atBottom = await cdp.isAtPageBottom(tabId);
      if (atBottom) throw err;
      console.log(`[flux] element not found, scrolling down (attempt ${attempt + 1}/${MAX_SCROLL_RETRIES})`);
      await cdp.scrollDownByViewport(tabId);
    }
  }
}

export const clickButtonAction: ActionFn = async (tabId, params, options) => {
  const skipClick = options?.validationOnly;
  let selector = params?.selector;
  const text = params?.text;
  const context = params?.context;
  const apiKey = options?.apiKey;
  const llmProvider = options?.llmProvider;

  if (isDynamicSelector(selector)) selector = undefined;

  if (selector) {
    let selectorWorked = false;
    try {
      let selectorValid = true;
      if (text || context) {
        selectorValid = await cdp.evaluate(
          tabId,
          `(() => {
            const selector = ${JSON.stringify(selector)};
            const expectedText = ${JSON.stringify(text || "")};
            const expectedContext = ${JSON.stringify(context || "")};
            const norm = (s) => (s || "").trim().replace(/\\s+/g, " ");
            const key = (s) => norm(s).replace(/\\s+/g, "").replace(/[\\u207A\\u2B]/g, "+").toLowerCase();
            const el = document.querySelector(selector);
            if (!el) return false;
            const elKey = key((el.innerText || el.textContent || "").trim());
            const textKey = key(expectedText);
            const isTextMatched = !textKey || elKey === textKey || elKey.includes(textKey) || textKey.includes(elKey);
            return isTextMatched;
          })()`,
        );
      }
      if (selectorValid) {
        await cdp.click(tabId, selector, { skipClick });
        selectorWorked = true;
      }
    } catch {
      console.warn(`[flux] selector failed: "${selector}"`);
    }
    if (selectorWorked) return;
    if (!text) throw new Error(`Element not found by selector "${selector}" and no text fallback`);
    console.log(`[flux] selector invalid, falling through to text matching: "${text}"`);
  }

  if (text) {
    console.log(`[flux] button.click: text="${text}", context="${context ?? "(none)"}"`);
    if (apiKey) {
      const resolved = await resolveElement(
        tabId,
        { action: "button.click", text, context },
        apiKey,
        llmProvider,
      );
      if (resolved) {
        console.log(`[flux] resolveElement → ${resolved.matchedBy}: "${resolved.selector}"`);
        try {
          await cdp.click(tabId, resolved.selector, { skipClick });
          return;
        } catch (err: any) {
          console.warn(`[flux] resolved selector click failed: ${err?.message}`);
        }
      } else {
        console.log("[flux] resolveElement → no match");
      }
    }
    if (context) {
      try {
        console.log("[flux] fallback → clickByTextWithContext");
        await withScrollRetry(tabId, () =>
          cdp.clickByTextWithContext(tabId, text, context, CLICKABLE_BY_TEXT_SELECTOR, {
            skipClick,
          }),
        );
        return;
      } catch (err: any) {
        console.warn(`[flux] clickByTextWithContext failed: ${err?.message}`);
      }
    }
    console.log("[flux] final fallback → clickByText (no context, picks topmost)");
    await withScrollRetry(tabId, () =>
      cdp.clickByText(tabId, text, CLICKABLE_BY_TEXT_SELECTOR, { skipClick }),
    );
  } else {
    throw new Error("button.click requires 'text' or 'selector' param");
  }
};

/** GNB(헤더/네비)에 있는 로그인 버튼만 클릭. 경로에 "GNB > 로그인"일 때 사용. */
export const gnbClickLoginAction: ActionFn = async (tabId, _params, options) => {
  await cdp.clickLoginInGNB(tabId, { skipClick: options?.validationOnly });
};

const HOVERABLE_SELECTOR = 'nav a, nav button, [role="menuitem"], [class*="menu"] a, [class*="menu"] button, [class*="gnb"] a, [class*="gnb"] button, [role="tab"], header a, header button, a, button, [role="button"]';

export const hoverAction: ActionFn = async (tabId, params, options) => {
  const selector = isDynamicSelector(params?.selector) ? undefined : params?.selector;
  const text = params?.text;
  const context = params?.context;
  const apiKey = options?.apiKey;
  const llmProvider = options?.llmProvider;

  if (selector) {
    let selectorWorked = false;
    try {
      if (text) {
        const selectorValid = await cdp.evaluate(
          tabId,
          `(() => {
            const el = document.querySelector(${JSON.stringify(selector)});
            if (!el) return false;
            const norm = (s) => (s || '').trim().replace(/\\s+/g, '').replace(/[\\u207A\\u2B]/g, '+').toLowerCase();
            const elKey = norm(el.innerText || el.textContent || '');
            const textKey = norm(${JSON.stringify(text)});
            return !textKey || elKey.includes(textKey) || textKey.includes(elKey);
          })()`,
        );
        if (selectorValid) {
          await cdp.hover(tabId, selector);
          selectorWorked = true;
        }
      } else {
        await cdp.hover(tabId, selector);
        selectorWorked = true;
      }
    } catch {
      console.warn(`[flux] hover selector failed: "${selector}"`);
    }
    if (selectorWorked) return;
    if (!text) throw new Error(`Hover target not found by selector "${selector}" and no text fallback`);
    console.log(`[flux] hover selector invalid, falling through to text matching: "${text}"`);
  }

  if (text) {
    console.log(`[flux] interaction.hover: text="${text}", context="${context ?? "(none)"}"`);

    if (apiKey) {
      const resolved = await resolveElement(
        tabId,
        { action: "button.click", text, context },
        apiKey,
        llmProvider,
      );
      if (resolved) {
        console.log(`[flux] hover resolveElement → ${resolved.matchedBy}: "${resolved.selector}"`);
        try {
          await cdp.hover(tabId, resolved.selector);
          return;
        } catch (err: any) {
          console.warn(`[flux] hover resolved selector failed: ${err?.message}`);
        }
      }
    }

    if (context) {
      try {
        console.log("[flux] hover fallback → hoverByTextWithContext");
        await withScrollRetry(tabId, () =>
          cdp.hoverByTextWithContext(tabId, text, context, HOVERABLE_SELECTOR),
        );
        return;
      } catch (err: any) {
        console.warn(`[flux] hoverByTextWithContext failed: ${err?.message}`);
      }
    }

    console.log("[flux] hover final fallback → hoverByText (no context)");
    await withScrollRetry(tabId, () =>
      cdp.hoverByText(tabId, text, HOVERABLE_SELECTOR),
    );
  } else {
    throw new Error("interaction.hover requires 'text' or 'selector' param");
  }
};

export const selectOptionAction: ActionFn = async (tabId, params, options) => {
  const selector = isDynamicSelector(params?.selector) ? undefined : params?.selector;
  const label = params?.label;
  const value = params?.value;

  if (!value && !options?.validationOnly) {
    throw new Error("form.select requires 'value' param");
  }

  if (options?.validationOnly) {
    if (selector) {
      await cdp.evaluate(
        tabId,
        `(() => { if (!document.querySelector(${JSON.stringify(selector)})) throw new Error("Select not found: " + ${JSON.stringify(selector)}); })()`,
      );
    } else if (label) {
      await cdp.checkFillByLabel(tabId, label);
    } else {
      throw new Error("form.select requires 'selector' or 'label'");
    }
    return;
  }

  if (selector) {
    await cdp.selectOption(tabId, selector, value);
  } else if (label) {
    await cdp.fillByLabel(tabId, label, value);
  } else {
    throw new Error("form.select requires 'selector' or 'label'");
  }
};

export const fillFormAction: ActionFn = async (tabId, params, options) => {
  const selector = isDynamicSelector(params?.selector) ? undefined : params?.selector;
  const label = params?.label;
  const value = params?.value;
  const context = params?.context;
  const apiKey = options?.apiKey;
  const llmProvider = options?.llmProvider;

  if (!value && !options?.validationOnly) {
    throw new Error("form.fill requires 'value' param");
  }

  if (options?.validationOnly) {
    if (selector) {
      await cdp.evaluate(
        tabId,
        `(() => { if (!document.querySelector(${JSON.stringify(selector)})) throw new Error("Element not found: " + ${JSON.stringify(selector)}); })()`,
      );
    } else if (label) {
      await cdp.checkFillByLabel(tabId, label);
    } else {
      throw new Error("form.fill requires 'selector' or 'label'");
    }
    return;
  }

  if (selector) {
    try {
      await cdp.type(tabId, selector, value);
      return;
    } catch {
      if (label) {
        await cdp.fillByLabel(tabId, label, value);
        return;
      }
      throw new Error(`Input not found by selector "${selector}" and no label fallback`);
    }
  }

  if (label) {
    if (apiKey) {
      const resolved = await resolveElement(
        tabId,
        { action: "form.fill", label, context },
        apiKey,
        llmProvider,
      );
      if (resolved) {
        try {
          await cdp.type(tabId, resolved.selector, value);
          return;
        } catch {
          // resolved selector failed — fall through to fillByLabel
        }
      }
    }
    await cdp.fillByLabel(tabId, label, value);
  } else {
    throw new Error("form.fill requires 'selector' or 'label'");
  }
};

const CHECK_CLICK_SCRIPT = `
function fluxCheckClick(el) {
  var isCheckable = el.matches('input[type="checkbox"], input[type="radio"]');
  if (isCheckable) {
    var isHidden = el.offsetParent === null ||
                   getComputedStyle(el).display === 'none' ||
                   getComputedStyle(el).visibility === 'hidden' ||
                   el.offsetWidth === 0;
    if (isHidden && el.id) {
      var lbl = document.querySelector('label[for="' + el.id.replace(/"/g, '\\\\"') + '"]');
      if (lbl) { lbl.click(); return; }
    }
    if (isHidden) {
      var parentLabel = el.closest('label');
      if (parentLabel) { parentLabel.click(); return; }
    }
  }
  el.click();
  if (isCheckable) {
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
}`;

export const checkAction: ActionFn = async (tabId, params, options) => {
  const selector = params?.selector;
  const label = params?.label;
  const checked = params?.checked;
  const context = params?.context;
  /** true면 목표 checked 비교 없이 한 번만 클릭(실제 사용자 클릭과 동일한 토글) */
  const clickOnly = params?.clickOnly === true;

  if (options?.validationOnly) {
    if (selector) {
      await cdp.evaluate(
        tabId,
        `(() => { if (!document.querySelector(${JSON.stringify(selector)})) throw new Error("Element not found: " + ${JSON.stringify(selector)}); })()`,
      );
    }
    return;
  }

  const hasDynamicSelector =
    typeof selector === "string" && /_uid_|uid_/i.test(selector);

  if (selector && !hasDynamicSelector) {
    try {
      await cdp.evaluate(
        tabId,
        `(() => {
          ${CHECK_CLICK_SCRIPT}
          var el = document.querySelector(${JSON.stringify(selector)});
          if (!el) throw new Error('Element not found: ' + ${JSON.stringify(selector)});
          var clickOnly = ${JSON.stringify(clickOnly)};
          var wantChecked = ${JSON.stringify(checked)};
          if (!clickOnly && wantChecked !== null && wantChecked !== undefined && el.checked !== undefined && el.checked === wantChecked) return;
          fluxCheckClick(el);
        })()`,
      );
      return;
    } catch {
      if (!label) throw new Error(`Checkbox not found by selector "${selector}" and no label fallback`);
    }
  }

  if (label) {
    await cdp.evaluate(
      tabId,
      `(() => {
        ${CHECK_CLICK_SCRIPT}
        var allCheckables = document.querySelectorAll('input[type="checkbox"], input[type="radio"], [role="checkbox"], [role="radio"], [role="switch"]');
        var norm = function(s) { return (s || '').trim().replace(/\\s+/g, ' ').toLowerCase(); };
        var key = function(s) { return norm(s).replace(/\\s+/g, '').replace(/[\\u207A⁺]/g, '+'); };
        var target = key(${JSON.stringify(label || "")});
        var contextKey = key(${JSON.stringify(context || "")});
        var clickOnly = ${JSON.stringify(clickOnly)};
        var wantChecked = ${JSON.stringify(checked)};

        function getCandidateText(cb, lbl) {
          var parts = [];
          if (lbl) {
            parts.push(lbl.textContent || '');
            var img = lbl.querySelector('img[alt]');
            if (img && img.getAttribute('alt')) parts.push(img.getAttribute('alt'));
          }
          var wrap = cb.closest('[data-gtm-event-label], [data-gtm-click-text], [data-gtm-click-location], .c-checkbox, .c-card-box');
          var src = wrap || cb;
          if (src && src.getAttribute) {
            parts.push(src.getAttribute('data-gtm-event-label') || '');
            parts.push(src.getAttribute('data-gtm-click-text') || '');
            parts.push(src.getAttribute('data-gtm-click-location') || '');
          }
          return key(parts.join(' '));
        }

        function getContextText(cb) {
          var parent = cb.closest('li, article, section, dl, .card, [class*="card"], [class*="product"], [class*="priceplan"], [role="dialog"], .modal, [class*="modal"], nav, header') || cb.parentElement;
          return key(parent ? (parent.textContent || '') : '');
        }

        var best = null;
        var bestScore = -1;
        for (var i = 0; i < allCheckables.length; i++) {
          var cb = allCheckables[i];
          var id = cb.id || '';
          var lbl = id ? document.querySelector('label[for="' + id.replace(/"/g, '\\\\"') + '"]') : cb.closest('label');
          var candidateKey = getCandidateText(cb, lbl);
          if (!candidateKey) continue;
          var textMatch = candidateKey.indexOf(target) >= 0 || target.indexOf(candidateKey) >= 0;
          if (!textMatch) continue;
          var score = 100;
          if (contextKey) {
            var ctx = getContextText(cb);
            if (ctx.indexOf(contextKey) >= 0) score += 60;
          }
          if (score > bestScore) {
            best = cb;
            bestScore = score;
          }
        }

        if (best) {
          if (!clickOnly && wantChecked !== null && wantChecked !== undefined && best.checked !== undefined && best.checked === wantChecked) return;
          fluxCheckClick(best);
          return;
        }

        var labels = document.querySelectorAll('label');
        for (var j = 0; j < labels.length; j++) {
          var labelText = (labels[j].textContent || '') + ' ' + ((labels[j].querySelector('img[alt]') && labels[j].querySelector('img[alt]').getAttribute('alt')) || '');
          if (key(labelText).indexOf(target) < 0) continue;
          var inp = labels[j].querySelector('input[type="checkbox"], input[type="radio"]') ||
                    (labels[j].getAttribute('for') ? document.getElementById(labels[j].getAttribute('for')) : null);
          if (inp) {
            if (!clickOnly && wantChecked !== null && wantChecked !== undefined && inp.checked !== undefined && inp.checked === wantChecked) return;
            fluxCheckClick(inp);
            return;
          }
          labels[j].click();
          return;
        }

        throw new Error('Checkbox/radio not found with label: ' + ${JSON.stringify(label)});
      })()`,
    );
    return;
  }

  throw new Error("form.check requires 'selector' or 'label'");
};

export const keypressAction: ActionFn = async (tabId, params, options) => {
  const key = params?.key;
  const selector = params?.selector;

  if (!key) throw new Error("keyboard.press requires 'key' param");

  if (options?.validationOnly) return;

  const targetSelector = selector ? JSON.stringify(selector) : "null";
  await cdp.evaluate(
    tabId,
    `(() => {
      var el = ${targetSelector} ? document.querySelector(${targetSelector}) : document.activeElement || document.body;
      if (!el) el = document.body;
      el.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { key: ${JSON.stringify(key)}, bubbles: true }));
    })()`,
  );
};
