import * as cdp from "@/engine/cdp";
import {
  resolveAndClick,
  resolveAndHover,
  resolveAndFill,
  isDynamicSelector,
  isBrittleSelector,
  withScrollRetry,
} from "@/services/targetResolver";
import { resolveElement } from "@/services/domMatcher";
import type { ActionFn } from "./index";

export const clickButtonAction: ActionFn = async (tabId, params, options) => {
  if (!params?.text && !params?.selector) {
    throw new Error("button.click requires 'text' or 'selector' param");
  }
  const result = await resolveAndClick(
    tabId,
    {
      selector: params?.selector,
      text: params?.text,
      context: params?.context,
    },
    {
      skipClick: options?.validationOnly,
      apiKey: options?.apiKey,
      llmProvider: options?.llmProvider,
    },
  );
  if (result.status !== "resolved") {
    throw new Error(result.reason);
  }
  return {
    strategy: result.strategy,
    selector: result.selector,
    ambiguous: result.ambiguous,
    candidates: result.candidates,
  };
};

/** GNB(헤더/네비)에 있는 로그인 버튼만 클릭. 경로에 "GNB > 로그인"일 때 사용. */
export const gnbClickLoginAction: ActionFn = async (tabId, _params, options) => {
  await cdp.clickLoginInGNB(tabId, { skipClick: options?.validationOnly });
};

export const hoverAction: ActionFn = async (tabId, params, options) => {
  if (!params?.text && !params?.selector) {
    throw new Error("interaction.hover requires 'text' or 'selector' param");
  }
  const result = await resolveAndHover(
    tabId,
    {
      selector: params?.selector,
      text: params?.text,
      context: params?.context,
    },
    {
      apiKey: options?.apiKey,
      llmProvider: options?.llmProvider,
    },
  );
  if (result.status !== "resolved") {
    throw new Error(result.reason);
  }
  return {
    strategy: result.strategy,
    selector: result.selector,
    ambiguous: result.ambiguous,
    candidates: result.candidates,
  };
};

export const selectOptionAction: ActionFn = async (tabId, params, options) => {
  const selector = isDynamicSelector(params?.selector) ? undefined : params?.selector;
  const label = params?.label;
  const value = params?.value;
  const optionText = params?.optionText;

  if (!value && !optionText && !options?.validationOnly) {
    throw new Error("form.select requires 'value' or 'optionText' param");
  }

  if (options?.validationOnly) {
    if (selector) {
      await cdp.evaluate(
        tabId,
        `(() => { if (!document.querySelector(${JSON.stringify(selector)})) throw new Error("Select not found: " + ${JSON.stringify(selector)}); })()`,
      );
    } else if (label) {
      await cdp.checkSelectByLabel(tabId, label);
    } else {
      throw new Error("form.select requires 'selector' or 'label'");
    }
    return;
  }

  if (selector) {
    await cdp.selectOption(tabId, selector, value ?? "", optionText);
  } else if (label) {
    await cdp.selectByLabel(tabId, label, value ?? "", optionText);
  } else {
    throw new Error("form.select requires 'selector' or 'label'");
  }
};

export const selectDropdownAction: ActionFn = async (tabId, params, options) => {
  const selector = isDynamicSelector(params?.selector) ? undefined : params?.selector;
  const label = params?.label;
  const optionText = params?.optionText;
  const context = params?.context;

  if (!optionText && !options?.validationOnly) {
    throw new Error("form.select_dropdown requires 'optionText' param");
  }

  if (options?.validationOnly) {
    if (selector) {
      await cdp.evaluate(
        tabId,
        `(() => { if (!document.querySelector(${JSON.stringify(selector)})) throw new Error("Dropdown trigger not found: " + ${JSON.stringify(selector)}); })()`,
      );
    } else if (label) {
      await cdp.evaluate(
        tabId,
        `(() => {
          var norm = function(s) { return (s || '').trim().replace(/\\s+/g, ' ').toLowerCase(); };
          var target = norm(${JSON.stringify(label)});
          var triggers = document.querySelectorAll('[role="combobox"], [aria-haspopup="listbox"], [aria-haspopup="true"], [class*="select"] button, [class*="select"] [role="button"], [class*="dropdown"] button, [class*="dropdown"] [role="button"]');
          for (var i = 0; i < triggers.length; i++) {
            var el = triggers[i];
            var ariaLabel = norm(el.getAttribute('aria-label') || '');
            if (ariaLabel && ariaLabel.includes(target)) return;
            var id = (el.id || '').trim();
            if (id) {
              var lbl = document.querySelector('label[for="' + id.replace(/"/g, '\\\\"') + '"]');
              if (lbl && norm(lbl.textContent || '').includes(target)) return;
            }
            var parentLabel = el.closest('label');
            if (parentLabel && norm(parentLabel.textContent || '').includes(target)) return;
            var prev = el.previousElementSibling;
            if (prev && norm(prev.textContent || '').includes(target)) return;
            var parent = el.closest('.form-group, .field, [class*="select"], [class*="dropdown"], dt, dd, dl');
            if (parent && norm(parent.textContent || '').includes(target)) return;
          }
          throw new Error('Custom dropdown trigger not found for label: ' + ${JSON.stringify(label)});
        })()`,
      );
    } else {
      throw new Error("form.select_dropdown requires 'selector' or 'label'");
    }
    return;
  }

  await withScrollRetry(tabId, async () => {
    await cdp.evaluate(
      tabId,
      `(async () => {
        var norm = function(s) { return (s || '').trim().replace(/\\s+/g, ' ').toLowerCase(); };
        var key = function(s) { return norm(s).replace(/\\s+/g, ''); };
        var selectorParam = ${JSON.stringify(selector ?? "")};
        var labelParam = ${JSON.stringify(label ?? "")};
        var optionTextParam = ${JSON.stringify(optionText ?? "")};
        var contextParam = ${JSON.stringify(context ?? "")};

        // Phase 1: Find trigger
        var trigger = null;
        if (selectorParam) {
          trigger = document.querySelector(selectorParam);
        }
        if (!trigger && labelParam) {
          var targetLabel = norm(labelParam);
          var candidates = document.querySelectorAll(
            '[role="combobox"], [aria-haspopup="listbox"], [aria-haspopup="true"], ' +
            'select, ' +
            '[class*="select"] button, [class*="select"] [role="button"], [class*="select"] > div, ' +
            '[class*="dropdown"] button, [class*="dropdown"] [role="button"], ' +
            '[class*="combo"] button, [class*="combo"] [role="button"]'
          );
          var best = null;
          var bestScore = -1;
          for (var i = 0; i < candidates.length; i++) {
            var el = candidates[i];
            var score = 0;
            var ariaLabel = norm(el.getAttribute('aria-label') || '');
            if (ariaLabel && ariaLabel.includes(targetLabel)) score = 100;
            if (!score) {
              var id = (el.id || '').trim();
              if (id) {
                var lbl = document.querySelector('label[for="' + id.replace(/"/g, '\\\\"') + '"]');
                if (lbl && norm(lbl.textContent || '').includes(targetLabel)) score = 90;
              }
            }
            if (!score) {
              var parentLabel = el.closest('label');
              if (parentLabel && norm(parentLabel.textContent || '').includes(targetLabel)) score = 85;
            }
            if (!score) {
              var prev = el.previousElementSibling;
              if (prev && norm(prev.textContent || '').includes(targetLabel)) score = 70;
            }
            if (!score) {
              var parent = el.closest('.form-group, .field, [class*="select"], [class*="dropdown"], dt, dd, dl, div');
              if (parent) {
                var heading = parent.querySelector('dt, label, [class*="label"], [class*="title"]');
                if (heading && norm(heading.textContent || '').includes(targetLabel)) score = 60;
                else if (norm(parent.textContent || '').includes(targetLabel)) score = 40;
              }
            }
            if (score <= 0) continue;
            if (contextParam) {
              var ctxParent = el.closest('li, article, section, dl, .card, [class*="card"], [role="dialog"], .modal, [class*="modal"]') || el.parentElement;
              if (ctxParent && key(ctxParent.textContent || '').includes(key(contextParam))) score += 50;
            }
            if (score > bestScore) {
              best = el;
              bestScore = score;
            }
          }
          trigger = best;
        }
        if (!trigger) throw new Error('Custom dropdown trigger not found: ' + (labelParam || selectorParam));

        // Scroll into view
        var r = trigger.getBoundingClientRect();
        if (r.top >= window.innerHeight || r.bottom <= 0) {
          trigger.scrollIntoView({ block: 'center' });
          await new Promise(function(ok) { setTimeout(ok, 150); });
        }

        // Phase 2: Click trigger to open
        trigger.click();
        trigger.dispatchEvent(new Event('input', { bubbles: true }));

        // Wait + find option with retry
        var optKey = key(optionTextParam);
        var optionEl = null;

        for (var attempt = 0; attempt < 3; attempt++) {
          await new Promise(function(ok) { setTimeout(ok, attempt === 0 ? 300 : 300); });

          var optionCandidates = document.querySelectorAll(
            '[role="option"], [role="menuitem"], [role="menuitemradio"], ' +
            '[class*="option"], [class*="item"], li'
          );
          var visibleOpts = [];
          for (var j = 0; j < optionCandidates.length; j++) {
            var opt = optionCandidates[j];
            var rect = opt.getBoundingClientRect();
            if (rect.width < 1 || rect.height < 1) continue;
            var st = window.getComputedStyle(opt);
            if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) continue;
            visibleOpts.push(opt);
          }

          // Exact match first, then substring
          for (var k = 0; k < visibleOpts.length; k++) {
            if (key(visibleOpts[k].textContent || '') === optKey) {
              optionEl = visibleOpts[k];
              break;
            }
          }
          if (!optionEl) {
            for (var k2 = 0; k2 < visibleOpts.length; k2++) {
              var oKey = key(visibleOpts[k2].textContent || '');
              if (oKey.includes(optKey) || optKey.includes(oKey)) {
                optionEl = visibleOpts[k2];
                break;
              }
            }
          }
          if (optionEl) break;
        }

        if (!optionEl) throw new Error('Option not found in dropdown: ' + optionTextParam);

        // Click option
        var optRect = optionEl.getBoundingClientRect();
        if (optRect.top >= window.innerHeight || optRect.bottom <= 0) {
          optionEl.scrollIntoView({ block: 'center' });
          await new Promise(function(ok) { setTimeout(ok, 100); });
        }
        optionEl.click();
      })()`,
    );
  });
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

  const result = await resolveAndFill(
    tabId,
    { selector, label, context },
    value,
    { apiKey, llmProvider },
  );
  if (result.status !== "resolved") {
    throw new Error(result.reason);
  }
  return {
    strategy: result.strategy,
    selector: result.selector,
    ambiguous: result.ambiguous,
    candidates: result.candidates,
  };
};

const CHECK_CLICK_SCRIPT = `
// 체크/라디오 클릭 직전 분홍 하이라이트를 잠깐 그려, 무엇이 선택됐는지 눈에 보이게 한다.
// 라디오 input 자체는 화면 밖/숨김인 경우가 많아, 보이는 라벨 쪽을 하이라이트한다.
function fluxCheckHighlight(visibleEl) {
  try {
    if (!visibleEl) return;
    var old = document.getElementById('__flux_highlight__');
    if (old) old.remove();
    var r = visibleEl.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;
    var ov = document.createElement('div');
    ov.id = '__flux_highlight__';
    ov.style.cssText = 'position:fixed;left:' + r.left + 'px;top:' + r.top +
      'px;width:' + r.width + 'px;height:' + r.height +
      'px;border:2px solid #ff2d78;border-radius:4px;background:rgba(255,45,120,0.15);' +
      'pointer-events:none;z-index:2147483647;box-sizing:border-box;transition:opacity .3s;opacity:1;';
    document.body.appendChild(ov);
    setTimeout(function() { ov.style.opacity = '0'; setTimeout(function() { ov.remove(); }, 300); }, 450);
  } catch (e) {}
}
function fluxCheckClick(el) {
  var isCheckable = el.matches('input[type="checkbox"], input[type="radio"]');
  // 화면 밖(캐러셀 등)이면 끌어오고, 보이는 라벨을 하이라이트.
  var lblForView = (isCheckable && el.id)
    ? document.querySelector('label[for="' + el.id.replace(/"/g, '\\\\"') + '"]')
    : (isCheckable ? el.closest('label') : null);
  var viewTarget = lblForView || el;
  try { viewTarget.scrollIntoView({ block: 'center', inline: 'center' }); } catch (e) {}
  fluxCheckHighlight(viewTarget);
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
}`;

/** label이 실제 텍스트가 아니라 CSS selector 문자열로 잘못 저장된 경우 걸러낸다. */
function looksLikeSelector(s: unknown): boolean {
  if (typeof s !== "string") return false;
  return /:nth-(of-type|child)\(|^\s*[.#]|>\s|\[[\w-]+[=\]]/.test(s);
}

export const checkAction: ActionFn = async (tabId, params, options) => {
  const selector = params?.selector;
  // 과거 녹화에서 label에 selector 문자열이 박힌 데이터가 있어, 그런 label은 버린다.
  const label = looksLikeSelector(params?.label) ? undefined : params?.label;
  const checked = params?.checked;
  const context = looksLikeSelector(params?.context) ? undefined : params?.context;
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

  // selector가 동적(_uid_)이거나 위치기반(nth 2개+)이면 신뢰하지 않는다.
  // 라디오/체크는 nth selector가 재생 때 다른 항목(예: 계좌이체↔신용카드)을 가리키기 쉬워,
  // label이 있으면 label 매칭을 우선한다. selector는 label이 없을 때만 최후 수단.
  const unreliableSelector =
    isDynamicSelector(selector) || isBrittleSelector(selector);
  const trustSelector = selector && !unreliableSelector;

  if (trustSelector) {
    try {
      await cdp.evaluate(
        tabId,
        `(() => {
          ${CHECK_CLICK_SCRIPT}
          var nodes = document.querySelectorAll(${JSON.stringify(selector)});
          // selector가 모호(다수 매칭) + label이 있으면 label 매칭이 더 정확하다.
          // 예: input[name="radio"]가 페이지에 12개 → 첫 매칭은 의도와 다를 가능성 큼.
          // throw하면 catch에서 label 폴백(아래 if (label) 블록)으로 자연스럽게 넘어간다.
          var hasLabel = ${JSON.stringify(Boolean(label))};
          if (nodes.length > 1 && hasLabel) {
            throw new Error('selector ambiguous (' + nodes.length + ' matches), falling back to label');
          }
          var el = nodes[0];
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
  // 신뢰 못 할 selector인데 label도 없으면, 그 selector라도 최후로 시도(아예 못 누르는 것보단 낫다)
  if (!label && selector) {
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
  }

  if (label) {
   try {
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

        function isVisible(cb) {
          var rect = cb.getBoundingClientRect();
          if (rect.width < 1 || rect.height < 1) return false;
          var st = window.getComputedStyle(cb);
          if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) return false;
          return true;
        }

        var best = null;
        var bestScore = -1;
        for (var i = 0; i < allCheckables.length; i++) {
          var cb = allCheckables[i];
          if (!isVisible(cb)) continue;
          var id = cb.id || '';
          var lbl = id ? document.querySelector('label[for="' + id.replace(/"/g, '\\\\"') + '"]') : cb.closest('label');
          var candidateKey = getCandidateText(cb, lbl);
          if (!candidateKey) continue;
          var exactMatch = candidateKey === target;
          var partialMatch = candidateKey.indexOf(target) >= 0 || target.indexOf(candidateKey) >= 0;
          if (!exactMatch && !partialMatch) continue;
          var score = exactMatch ? 160 : 100;
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
    } catch (codeErr: any) {
      // 코드 매칭(label) 실패 → 아래 AI 폴백으로 넘어간다.
      console.warn(`[flux] check label matching failed, trying AI: ${codeErr?.message}`);
    }
  }

  // ── AI 폴백 ──────────────────────────────────────────────
  // selector·label 코드 매칭이 모두 실패했으면, 실행 시점 DOM을 캡처해 AI에게
  // "이 의도에 맞는 요소"를 물어 그 selector를 클릭한다(모든 액션 공통 정책).
  const intentText = (!looksLikeSelector(params?.label) && params?.label) || undefined;
  if ((intentText || context) && options?.apiKey) {
    const resolved = await resolveElement(
      tabId,
      {
        action: "button.click",
        text: intentText,
        context: context ?? undefined,
      },
      options.apiKey,
      options.llmProvider,
    );
    if (resolved) {
      await cdp.evaluate(
        tabId,
        `(() => {
          ${CHECK_CLICK_SCRIPT}
          var el = document.querySelector(${JSON.stringify(resolved.selector)});
          if (!el) throw new Error('AI-resolved element not found: ' + ${JSON.stringify(resolved.selector)});
          fluxCheckClick(el);
        })()`,
      );
      return {
        strategy: resolved.matchedBy === "llm" ? "matcher-llm" : "matcher-fast-path",
        selector: resolved.selector,
        ambiguous: resolved.ambiguous,
        candidates: resolved.candidates,
      };
    }
  }

  throw new Error(
    label
      ? `Checkbox/radio not found with label "${label}" (code + AI both failed)`
      : "form.check requires 'selector' or 'label'",
  );
};

export const keypressAction: ActionFn = async (tabId, params, options) => {
  const key = params?.key;
  const selector = isDynamicSelector(params?.selector) ? undefined : params?.selector;

  if (!key) throw new Error("keyboard.press requires 'key' param");

  if (options?.validationOnly) return;

  // 엔터는 "직전에 입력한 input"에 가야 검색이 발동한다. 그래서:
  // - 현재 focus가 이미 input/textarea면 그대로 둔다(직전 fill이 잡아둔 focus).
  // - selector가 input/textarea를 가리킬 때만 focus를 옮긴다(검색 버튼 등으로 옮겨 빈 엔터가 가는 것 방지).
  if (key === "Enter") {
    const focusIsInput = await cdp.evaluate(
      tabId,
      `(() => { var a = document.activeElement; return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA'); })()`,
    );
    if (!focusIsInput && selector) {
      await cdp.focusElement(tabId, selector);
    }
  } else if (selector) {
    await cdp.focusElement(tabId, selector);
  }
  // 합성 KeyboardEvent는 isTrusted=false라 검색창 submit이 무시된다.
  // CDP 실제 키입력으로 보내 진짜 사용자 엔터처럼 동작시킨다.
  await cdp.pressKey(tabId, key);
};
