import * as cdp from "@/engine/cdp";
import { resolveElement } from "@/services/domMatcher";
import type { ActionFn } from "./index";

const CLICKABLE_BY_TEXT_SELECTOR = "button, a, [role='button'], [role='link']";

export const clickButtonAction: ActionFn = async (tabId, params, options) => {
  const skipClick = options?.validationOnly;
  const selector = params?.selector;
  const text = params?.text;
  const context = params?.context;
  const apiKey = options?.apiKey;

  if (selector) {
    try {
      await cdp.click(tabId, selector, { skipClick });
      return;
    } catch {
      if (text) {
        await cdp.clickByText(tabId, text, CLICKABLE_BY_TEXT_SELECTOR, { skipClick });
        return;
      }
      throw new Error(`Element not found by selector "${selector}" and no text fallback`);
    }
  }

  if (text) {
    if (apiKey) {
      const resolved = await resolveElement(
        tabId,
        { action: "button.click", text, context },
        apiKey,
      );
      if (resolved) {
        try {
          await cdp.click(tabId, resolved.selector, { skipClick });
          return;
        } catch {
          // resolved selector failed at runtime — fall through to clickByText
        }
      }
    }
    if (context) {
      try {
        await cdp.clickByTextWithContext(tabId, text, context, CLICKABLE_BY_TEXT_SELECTOR, {
          skipClick,
        });
        return;
      } catch {
        // context fallback failed — fall through to text-only click
      }
    }
    await cdp.clickByText(tabId, text, CLICKABLE_BY_TEXT_SELECTOR, { skipClick });
  } else {
    throw new Error("button.click requires 'text' or 'selector' param");
  }
};

/** GNB(헤더/네비)에 있는 로그인 버튼만 클릭. 경로에 "GNB > 로그인"일 때 사용. */
export const gnbClickLoginAction: ActionFn = async (tabId, _params, options) => {
  await cdp.clickLoginInGNB(tabId, { skipClick: options?.validationOnly });
};

const HOVERABLE_SELECTOR = 'nav a, nav button, [role="menuitem"], [class*="menu"] a, [class*="menu"] button, [class*="gnb"] a, [class*="gnb"] button, [role="tab"], header a, header button, a, button, [role="button"]';

export const hoverAction: ActionFn = async (tabId, params) => {
  const selector = params?.selector;
  const text = params?.text;

  if (selector) {
    try {
      await cdp.hover(tabId, selector);
      return;
    } catch {
      if (text) {
        await cdp.hoverByText(tabId, text, HOVERABLE_SELECTOR);
        return;
      }
      throw new Error(`Hover target not found by selector "${selector}" and no text fallback`);
    }
  }

  if (text) {
    await cdp.hoverByText(tabId, text, HOVERABLE_SELECTOR);
  } else {
    throw new Error("interaction.hover requires 'text' or 'selector' param");
  }
};

export const selectOptionAction: ActionFn = async (tabId, params, options) => {
  const selector = params?.selector;
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
  const selector = params?.selector;
  const label = params?.label;
  const value = params?.value;
  const context = params?.context;
  const apiKey = options?.apiKey;

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

  if (options?.validationOnly) {
    if (selector) {
      await cdp.evaluate(
        tabId,
        `(() => { if (!document.querySelector(${JSON.stringify(selector)})) throw new Error("Element not found: " + ${JSON.stringify(selector)}); })()`,
      );
    }
    return;
  }

  if (selector) {
    try {
      await cdp.evaluate(
        tabId,
        `(() => {
          ${CHECK_CLICK_SCRIPT}
          var el = document.querySelector(${JSON.stringify(selector)});
          if (!el) throw new Error('Element not found: ' + ${JSON.stringify(selector)});
          var wantChecked = ${JSON.stringify(checked)};
          if (wantChecked !== null && wantChecked !== undefined && el.checked !== undefined && el.checked === wantChecked) return;
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
        var target = ${JSON.stringify(label.trim().toLowerCase())};
        var wantChecked = ${JSON.stringify(checked)};

        for (var i = 0; i < allCheckables.length; i++) {
          var cb = allCheckables[i];
          var id = cb.id || '';
          var lbl = id ? document.querySelector('label[for="' + id.replace(/"/g, '\\\\"') + '"]') : cb.closest('label');
          if (!lbl) continue;
          var lblText = norm(lbl.textContent);
          if (lblText.indexOf(target) < 0 && target.indexOf(lblText) < 0) continue;
          if (wantChecked !== null && wantChecked !== undefined && cb.checked !== undefined && cb.checked === wantChecked) return;
          fluxCheckClick(cb);
          return;
        }

        var labels = document.querySelectorAll('label');
        for (var j = 0; j < labels.length; j++) {
          if (norm(labels[j].textContent).indexOf(target) < 0) continue;
          var inp = labels[j].querySelector('input[type="checkbox"], input[type="radio"]') ||
                    (labels[j].getAttribute('for') ? document.getElementById(labels[j].getAttribute('for')) : null);
          if (inp) {
            if (wantChecked !== null && wantChecked !== undefined && inp.checked !== undefined && inp.checked === wantChecked) return;
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
