import * as cdp from "./cdp";

export interface RecordedClickEvent {
  type: "click";
  text: string;
  selector?: string | null;
  context?: string | null;
  inHeader?: boolean;
  href?: string | null;
  ts: number;
}

export interface RecordedInputEvent {
  type: "input";
  label: string;
  value: string;
  selector?: string | null;
  context?: string | null;
  ts: number;
}

export interface RecordedNavEvent {
  type: "nav";
  url: string;
  ts: number;
}

export interface RecordedScrollEvent {
  type: "scroll";
  x: number;
  y: number;
  ts: number;
}

export interface RecordedHoverEvent {
  type: "hover";
  text: string;
  selector?: string | null;
  context?: string | null;
  ts: number;
}

export interface RecordedSelectEvent {
  type: "select";
  label: string;
  value: string;
  optionText: string;
  selector?: string | null;
  context?: string | null;
  ts: number;
}

export interface RecordedCheckEvent {
  type: "check";
  label: string;
  /** true: 목표 checked 없이 한 번 클릭만 (토글). 녹화 기본값 */
  clickOnly?: boolean;
  /** clickOnly가 아닐 때만: 클릭 후 기대 체크 상태 (레거시/수동 DSL) */
  checked?: boolean;
  selector?: string | null;
  context?: string | null;
  ts: number;
}

export interface RecordedKeyEvent {
  type: "keypress";
  key: string;
  selector?: string | null;
  context?: string | null;
  ts: number;
}

export type RecordedEvent =
  | RecordedClickEvent
  | RecordedInputEvent
  | RecordedNavEvent
  | RecordedScrollEvent
  | RecordedHoverEvent
  | RecordedSelectEvent
  | RecordedCheckEvent
  | RecordedKeyEvent;

export interface StopRecordingResult {
  startUrl: string;
  endUrl: string;
  logs: RecordedEvent[];
}

const BINDING_NAME = "__fluxRecorderPush";

const INJECT_SCRIPT = `
(function() {
  if (window.__fluxRecorderActive) return;
  window.__fluxRecorderActive = true;

  var norm = function(s) { return (s || '').trim().replace(/\\s+/g, ' '); };
  var CLICKABLE = 'button, a, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="option"], summary, details';
  var CHECKABLE = 'input[type="checkbox"], input[type="radio"], [role="checkbox"], [role="radio"], [role="switch"]';

  function getText(el) {
    var parts = [el.textContent || '', el.getAttribute('aria-label') || ''];
    el.querySelectorAll('img[alt]').forEach(function(img) { parts.push(img.getAttribute('alt') || ''); });
    return norm(parts.join(' '));
  }

  function escapeCss(value) {
    try {
      if (window.CSS && typeof window.CSS.escape === 'function') {
        return window.CSS.escape(value);
      }
    } catch (e) {}
    return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\\\$&');
  }

  function isLikelyStableId(id) {
    if (!id) return false;
    var value = String(id).trim();
    if (!value) return false;
    var lower = value.toLowerCase();
    if (lower.indexOf('_uid_') === 0 || lower.indexOf('uid_') === 0 || lower.indexOf('ember') === 0 || lower.indexOf('headlessui-') === 0) {
      return false;
    }
    return true;
  }

  function isLikelyStableName(name) {
    if (!name) return false;
    var value = String(name).trim().toLowerCase();
    if (!value) return false;
    if (value.indexOf('_uid_') === 0 || value.indexOf('uid_') === 0) return false;
    return true;
  }

  function buildAttrSelector(tagName, attrName, attrValue) {
    if (!attrValue) return null;
    return tagName + '[' + attrName + '="' + String(attrValue).replace(/"/g, '\\\\"') + '"]';
  }

  // 의미 없는/상태성 클래스를 걸러, selector에 쓸 만한 안정 클래스만 남긴다.
  // (domSnapshot.validCls와 같은 취지: active/open 등 토글성·프레임워크 접두사 제외)
  function isStableClass(c) {
    if (!c || c.length <= 1 || !/^[a-zA-Z_-]/.test(c)) return false;
    if (/^(active|hover|focus|show|hide|open|close|visible|hidden|selected|disabled|current|enabled|collapsed|expanded|toggled|on|off|in|out)$/i.test(c)) return false;
    if (/^(js-|ng-|v-|is-|has-|no-|not-|ui-|el-|ant-|data-v-)/i.test(c)) return false;
    if (/[-_](active|hover|focus|show|hide|open|close|visible|hidden|selected|disabled|current)$/i.test(c)) return false;
    return true;
  }

  // 안정 클래스 조합으로 document에서 유일한 selector를 찾는다. 없으면 null.
  function buildStableClassSelector(el, tagName) {
    var raw = (typeof el.className === 'string') ? el.className.trim() : '';
    if (!raw) return null;
    var classes = raw.split(/\\s+/).filter(isStableClass);
    for (var i = 0; i < Math.min(classes.length, 4); i++) {
      var s = '.' + escapeCss(classes[i]);
      try { if (document.querySelectorAll(s).length === 1) return s; } catch (e) {}
      var st = tagName + s;
      try { if (document.querySelectorAll(st).length === 1) return st; } catch (e) {}
    }
    return null;
  }

  /**
   * @param opts.allowBrittle true면 안정 식별자가 전혀 없을 때 nth-of-type 체인이라도 반환.
   *   click은 text/context가 함께 저장돼 폴백되므로 false(불안정하면 null 반환 → text에 맡김).
   *   input/checkbox 등 selector가 꼭 필요한 경우엔 true로 호출.
   */
  function getSelector(el, opts) {
    var allowBrittle = opts && opts.allowBrittle;
    if (!el || !(el instanceof Element)) return null;
    var tagName = el.tagName.toLowerCase();
    if (el.id && isLikelyStableId(el.id)) return '#' + escapeCss(el.id);

    var dataTestId = el.getAttribute('data-testid');
    var dataTestSelector = buildAttrSelector(tagName, 'data-testid', dataTestId);
    if (dataTestSelector) return dataTestSelector;
    var dataTest = el.getAttribute('data-test');
    var dataTestSimpleSelector = buildAttrSelector(tagName, 'data-test', dataTest);
    if (dataTestSimpleSelector) return dataTestSimpleSelector;

    var gtmLabel = el.getAttribute('data-gtm-event-label');
    var gtmLabelSelector = buildAttrSelector(tagName, 'data-gtm-event-label', gtmLabel);
    if (gtmLabelSelector) return gtmLabelSelector;

    var gtmClickText = el.getAttribute('data-gtm-click-text');
    var gtmClickTextSelector = buildAttrSelector(tagName, 'data-gtm-click-text', gtmClickText);
    if (gtmClickTextSelector) return gtmClickTextSelector;

    var ecProduct = el.getAttribute('data-ec-product_id');
    var ecProductSelector = buildAttrSelector(tagName, 'data-ec-product_id', ecProduct);
    if (ecProductSelector) return ecProductSelector;

    var name = el.getAttribute('name');
    if (isLikelyStableName(name)) {
      var nameSelector = buildAttrSelector(tagName, 'name', name);
      if (nameSelector) return nameSelector;
    }

    var ariaLabel = el.getAttribute('aria-label');
    var ariaLabelSelector = buildAttrSelector(tagName, 'aria-label', ariaLabel);
    if (ariaLabelSelector) return ariaLabelSelector;

    var gtmContainer = el.closest('[data-gtm-event-label]');
    if (gtmContainer) {
      var containerLabel = gtmContainer.getAttribute('data-gtm-event-label');
      if (containerLabel) {
        var clickable = el.closest('button, a, [role="button"], [role="link"]');
        var clickableTag = clickable ? clickable.tagName.toLowerCase() : tagName;
        return '[data-gtm-event-label="' + containerLabel.replace(/"/g, '\\\\"') + '"] ' + clickableTag;
      }
    }

    // 안정 식별자가 없을 때: 의미 있는 클래스로 유일 selector 시도
    var byClass = buildStableClassSelector(el, tagName);
    if (byClass) return byClass;

    // 부모의 안정 클래스 + 자식 tag 조합으로도 한 번 시도(카드 내부 버튼 등)
    var p = el.parentElement;
    if (p) {
      var pByClass = buildStableClassSelector(p, p.tagName.toLowerCase());
      if (pByClass) {
        var combo = pByClass + ' > ' + tagName;
        try { if (document.querySelectorAll(combo).length === 1) return combo; } catch (e) {}
      }
    }

    // 여기까지 왔으면 nth-of-type 체인밖에 없다 = 재생 시점에 다른 요소를 가리킬 위험(brittle).
    // click은 text/context가 함께 저장돼 폴백되므로 selector를 비워 text 매칭에 맡긴다.
    // 단 input/checkbox처럼 selector가 꼭 필요한 경우(allowBrittle)엔 nth라도 반환.
    if (!allowBrittle) return null;

    var parts = [];
    var node = el;
    var maxDepth = 4;
    while (node && node.nodeType === 1 && node !== document.body && maxDepth > 0) {
      var tag = node.tagName.toLowerCase();
      var parent = node.parentElement;
      if (!parent) break;
      var siblings = Array.prototype.filter.call(parent.children, function(child) {
        return child.tagName === node.tagName;
      });
      var idx = siblings.indexOf(node);
      var nth = idx >= 0 ? ':nth-of-type(' + (idx + 1) + ')' : '';
      parts.unshift(tag + nth);
      node = parent;
      maxDepth -= 1;
    }
    if (parts.length === 0) return null;
    return parts.join(' > ');
  }

  function getContext(el) {
    var gtmContainer = el.closest('[data-gtm-event-label]');
    if (gtmContainer) {
      var gtmLabel = gtmContainer.getAttribute('data-gtm-event-label');
      if (gtmLabel) return gtmLabel.trim().slice(0, 100);
    }
    var parent = el.closest('li, article, section, dl, .card, [class*="card"], [class*="product"], [class*="priceplan"], [role="dialog"], .modal, [class*="modal"], nav, header') || el.parentElement;
    if (!parent) return null;
    return norm(parent.textContent || '').slice(0, 80) || null;
  }

  function getFieldLabel(el) {
    var id = (el.id || '').trim();
    if (id) {
      var byFor = document.querySelector('label[for="' + id.replace(/"/g, '\\\\"') + '"]');
      if (byFor) {
        // label 태그가 존재해도 안이 비어있을 수 있다(주민번호 뒷자리 등 Vue 컴포넌트가
        // label을 placeholder로 대신 쓰는 패턴). 빈 결과면 다음 폴백으로 진행.
        var byForText = norm(byFor.textContent || '');
        if (byForText) return byForText;
      }
    }
    var inLabel = el.closest('label');
    if (inLabel) {
      var inLabelText = norm(inLabel.textContent || '');
      if (inLabelText) return inLabelText;
    }
    return norm(el.getAttribute('aria-label') || '')
      || norm(el.getAttribute('placeholder') || '')
      || norm(el.getAttribute('title') || '')
      || norm(el.getAttribute('name') || '');
  }

  function send(data) {
    try { window['${BINDING_NAME}'](JSON.stringify(data)); } catch(e) {}
  }

  var lastScrollY = window.scrollY || 0;
  var lastScrollTs = 0;
  var SCROLL_MIN_DELTA_PX = 120;
  var SCROLL_MIN_INTERVAL_MS = 250;

  var lastCheckEl = null;
  var lastCheckTs = 0;
  var CHECK_DEDUP_MS = 300;

  document.addEventListener('click', function(event) {
    // input debounce가 펜딩 중일 때 사용자가 마우스로 다음 버튼/결과를 클릭하면
    // 모달이 닫히거나 화면이 전환되며 input 이벤트가 손실된다.
    // (예: 주소 검색 input → 검색 결과 클릭 → 모달 닫힘 → input step 누락)
    // click 처리 전에 먼저 flush해서 input → click 순서로 항상 기록되게 한다.
    // 펜딩이 없으면 noop이라 일반 click엔 영향 없음.
    flushAllPendingInputs();

    var rawTarget = event.target instanceof Element ? event.target : null;
    if (!rawTarget) return;

    var checkTarget = rawTarget.closest(CHECKABLE);
    if (!checkTarget) {
      var labelEl = rawTarget.closest('label');
      if (labelEl) {
        var forId = labelEl.getAttribute('for');
        var assocInput = forId ? document.getElementById(forId) : labelEl.querySelector(CHECKABLE);
        if (assocInput && assocInput.matches(CHECKABLE)) {
          checkTarget = assocInput;
        }
      }
    }
    // 텍스트(span 등)를 클릭했고 label과 input이 형제이거나 컨테이너로 묶인 경우.
    // 5G/LTE 라디오 탭, 요금제 카드 라디오/체크처럼 라벨 텍스트만 클릭되는 케이스를 잡는다.
    if (!checkTarget) {
      var radioBox = rawTarget.closest(
        '.c-radio-box, .c-radio, .c-card-radio, .c-card-radio-2, .text-radio, .text-chkbox, .c-checkbox, .c-card-box, [class*="radio"], [class*="checkbox"], li'
      );
      if (radioBox) {
        var boxInput = radioBox.querySelector(CHECKABLE);
        // 라벨 for로 가리키는 input이 box 밖에 있을 수도 있으니 그것도 시도
        if (!boxInput) {
          var lblInBox = radioBox.querySelector('label[for]');
          var fid = lblInBox && lblInBox.getAttribute('for');
          if (fid) {
            var byFor = document.getElementById(fid);
            if (byFor && byFor.matches(CHECKABLE)) boxInput = byFor;
          }
        }
        if (boxInput) checkTarget = boxInput;
      }
    }
    if (checkTarget) {
      var now = Date.now();
      if (checkTarget === lastCheckEl && now - lastCheckTs < CHECK_DEDUP_MS) return;
      lastCheckEl = checkTarget;
      lastCheckTs = now;
      var chkLabel = getFieldLabel(checkTarget);
      var chkSelector = getSelector(checkTarget, { allowBrittle: true });
      var chkContext = getContext(checkTarget);

      var wrapper = checkTarget.closest('[data-gtm-event-label], .c-checkbox, .c-card-box');
      if (wrapper) {
        var gtmLabel = wrapper.getAttribute('data-gtm-event-label');
        if (gtmLabel) {
          var cleanGtm = gtmLabel.replace(/^[^:]*:\\s*/, '').trim();
          if (cleanGtm) chkLabel = cleanGtm;
        }
      }
      if (!chkLabel || chkLabel.length > 40) {
        // label[for] → 감싼 label → 라디오/체크 컨테이너 순으로 텍스트 출처를 넓게 탐색.
        // (5G 요금제처럼 <label class="text-radio"><span class="txt">…</span> 구조 포함)
        var labelSource = (checkTarget.id
          ? document.querySelector('label[for="' + checkTarget.id.replace(/"/g, '\\\\"') + '"]')
          : null)
          || checkTarget.closest('label')
          || checkTarget.closest('.c-radio-box, .c-radio, .c-card-radio, .c-card-radio-2, .c-checkbox, .c-card-box, li');
        if (labelSource) {
          var altImg = labelSource.querySelector('img[alt]');
          var txtSpan = labelSource.querySelector('.txt, .title, .tit, .contents__title, [class*="name"]');
          if (txtSpan && norm(txtSpan.textContent || '')) chkLabel = norm(txtSpan.textContent || '');
          else if (altImg && altImg.getAttribute('alt')) chkLabel = norm(altImg.getAttribute('alt'));
        }
      }

      // selector가 위치기반(nth 2개+)이면 재생 때 다른 항목을 가리키기 쉽다.
      // label이 충분하면(2자 이상) selector를 비워 label 매칭에 맡긴다.
      var brittle = chkSelector && (chkSelector.match(/:nth-(of-type|child)\\(/g) || []).length >= 2;
      if (brittle && chkLabel && chkLabel.length >= 2) {
        chkSelector = null;
      }

      var role = (checkTarget.getAttribute('role') || '').toLowerCase();
      var isRadio = (checkTarget instanceof HTMLInputElement && checkTarget.type === 'radio') || role === 'radio';
      var isCheckbox = (checkTarget instanceof HTMLInputElement && checkTarget.type === 'checkbox') || role === 'checkbox' || role === 'switch';
      var payload = {
        type: 'check',
        // label에는 진짜 텍스트만. chkLabel이 비었다고 selector 문자열(nth 체인 등)을
        // 라벨로 넣으면 재생이 "그 selector 문자열을 텍스트로 가진 항목"을 찾아 실패한다.
        label: chkLabel || '',
        selector: chkSelector,
        context: chkContext,
        ts: Date.now()
      };
      function readCurrentChecked(el) {
        if (el instanceof HTMLInputElement) return !!el.checked;
        var ac = el.getAttribute('aria-checked');
        if (ac === 'true') return true;
        if (ac === 'false') return false;
        return null;
      }
      // capture 직후 el.checked는 토글 전. 그런데 setTimeout(0)도 Vue nextTick
      // (microtask)보다 빠를 수 있어 여전히 토글 전이다. 짧은 폴링으로 토글이
      // 일어날 때까지 기다린다(최대 ~100ms). 변하면 즉시 종료.
      function awaitToggleThenSend(initial) {
        var attempts = 0;
        var MAX_ATTEMPTS = 10;
        var INTERVAL_MS = 10;
        function tick() {
          var now = readCurrentChecked(checkTarget);
          if (now !== initial || attempts >= MAX_ATTEMPTS) {
            if (now === null) payload.clickOnly = true;
            else payload.checked = now;
            send(payload);
            return;
          }
          attempts++;
          setTimeout(tick, INTERVAL_MS);
        }
        setTimeout(tick, 0);
      }
      if (isRadio) {
        // 라디오 클릭=항상 선택. capture 시점과 무관하게 의도가 명확.
        payload.checked = true;
        send(payload);
      } else if (isCheckbox) {
        awaitToggleThenSend(readCurrentChecked(checkTarget));
      } else {
        payload.clickOnly = true;
        send(payload);
      }
      return;
    }

    var target = rawTarget.closest(CLICKABLE);
    if (!target) {
      target = rawTarget.closest('[tabindex]:not([tabindex="-1"]), [onclick]');
    }
    if (!target) return;
    var text = getText(target);
    // text가 있으면 text 기반(selector는 없어도 됨).
    // text가 없으면(CSS ::before 아이콘 버튼 등) selector로라도 기록해야 누락되지 않는다.
    // → 이때는 brittle nth라도 확보. text·selector 둘 다 없으면 식별 불가라 버린다.
    var selector = text ? getSelector(target) : getSelector(target, { allowBrittle: true });
    if (!text && !selector) return;
    var context = getContext(target);
    var href = target.getAttribute('href');
    var inHeader = !!target.closest('header, nav, [role="navigation"], [class*="gnb"], [class*="menu"]');
    send({ type: 'click', text: text, selector: selector, context: context, href: href || null, inHeader: inHeader, ts: Date.now() });
  }, true);

  /**
   * 입력 이벤트 처리 정책:
   *   - input 이벤트로 타이핑 중간 값을 잡고 debounce(400ms)로 묶음 → 타임스탬프가 빠르게 확보
   *   - change(blur) 이벤트는 backup. 같은 selector+value면 dedupe로 1회만 전송
   *   - select는 label 없어도 selector 기반으로 잡힘
   *   - keydown 직전 pending flush → 엔터 누르면 input이 항상 keypress보다 먼저 전송
   */
  var INPUT_DEBOUNCE_MS = 400;
  var inputDebounceTimers = new Map(); // selector → timeoutId
  var inputPending = new Map();        // selector → { el, ts }
  var lastSentInputs = new Map();      // selector → value (dedupe)

  function flushPendingInputForSelector(selector) {
    var timer = inputDebounceTimers.get(selector);
    if (timer != null) {
      clearTimeout(timer);
      inputDebounceTimers.delete(selector);
    }
    var pending = inputPending.get(selector);
    inputPending.delete(selector);
    if (!pending) return;
    sendInputIfChanged(pending.el, pending.ts);
  }

  function flushAllPendingInputs() {
    var selectors = Array.from(inputDebounceTimers.keys());
    selectors.forEach(flushPendingInputForSelector);
  }

  function sendInputIfChanged(el, ts) {
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return;
    if (el.disabled || (el instanceof HTMLInputElement && (el.type === 'hidden' || el.type === 'checkbox' || el.type === 'radio'))) return;
    var label = getFieldLabel(el);
    if (!label) return;
    var value = String(el.value || '').trim();
    if (!value) return;
    var selector = getSelector(el, { allowBrittle: true });
    var dedupeKey = (selector || '') + '\\x1f' + value;
    if (lastSentInputs.get(selector || '') === value) return;
    lastSentInputs.set(selector || '', value);
    var context = getContext(el);
    send({ type: 'input', label: label, value: value, selector: selector, context: context, ts: ts });
    void dedupeKey;
  }

  function sendSelect(el, ts) {
    if (!(el instanceof HTMLSelectElement)) return;
    if (el.disabled) return;
    var value = String(el.value || '').trim();
    if (!value) return;
    var selector = getSelector(el, { allowBrittle: true });
    if (lastSentInputs.get(selector || '') === value) return;
    lastSentInputs.set(selector || '', value);
    // select는 label이 없어도 selector로 매칭 가능. 다만 가능한 한 채워서 보냄.
    var label = getFieldLabel(el) || norm(el.getAttribute('title') || '') || null;
    var optText = el.options[el.selectedIndex] ? norm(el.options[el.selectedIndex].textContent || '') : value;
    var context = getContext(el);
    send({ type: 'select', label: label, value: value, optionText: optText, selector: selector, context: context, ts: ts });
  }

  // input 이벤트: 타이핑 중간에 발생. debounce로 묶음.
  document.addEventListener('input', function(event) {
    var el = event.target;
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return;
    if (el.disabled || (el instanceof HTMLInputElement && (el.type === 'hidden' || el.type === 'checkbox' || el.type === 'radio'))) return;
    var selector = getSelector(el, { allowBrittle: true }) || '';
    var existing = inputDebounceTimers.get(selector);
    if (existing != null) clearTimeout(existing);
    inputPending.set(selector, { el: el, ts: Date.now() });
    var timer = setTimeout(function() {
      inputDebounceTimers.delete(selector);
      var pending = inputPending.get(selector);
      inputPending.delete(selector);
      if (pending) sendInputIfChanged(pending.el, pending.ts);
    }, INPUT_DEBOUNCE_MS);
    inputDebounceTimers.set(selector, timer);
  }, true);

  // change 이벤트: blur/select 변경 시 백업. select는 여기서만 확정.
  document.addEventListener('change', function(event) {
    var el = event.target;
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) return;
    if (el.disabled || (el instanceof HTMLInputElement && el.type === 'hidden')) return;
    if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) return;
    if (el instanceof HTMLSelectElement) {
      sendSelect(el, Date.now());
    } else {
      // input/textarea의 change → debounce 펜딩이 있으면 그걸 먼저 flush
      var selector = getSelector(el, { allowBrittle: true }) || '';
      flushPendingInputForSelector(selector);
      sendInputIfChanged(el, Date.now());
    }
  }, true);

  var HOVER_TARGETS = 'nav a, nav button, [role="menuitem"], [class*="menu"] a, [class*="menu"] button, [class*="gnb"] a, [class*="gnb"] button, [role="tab"], header a, header button, [class*="dropdown"] > button, [class*="dropdown"] > a';
  var HOVER_DWELL_MS = 400;
  var hoverTimer = null;
  var lastHoverText = '';

  document.addEventListener('mouseenter', function(event) {
    var target = event.target instanceof Element ? event.target.closest(HOVER_TARGETS) : null;
    if (!target) return;
    var text = getText(target);
    if (!text || text === lastHoverText) return;
    if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
    var capturedTarget = target;
    var capturedText = text;
    hoverTimer = setTimeout(function() {
      hoverTimer = null;
      lastHoverText = capturedText;
      var selector = getSelector(capturedTarget);
      var context = getContext(capturedTarget);
      send({ type: 'hover', text: capturedText, selector: selector, context: context, ts: Date.now() });
    }, HOVER_DWELL_MS);
  }, true);

  document.addEventListener('mouseleave', function(event) {
    var target = event.target instanceof Element ? event.target.closest(HOVER_TARGETS) : null;
    if (!target) return;
    if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
  }, true);

  window.addEventListener('scroll', function() {
    var now = Date.now();
    var y = window.scrollY || 0;
    var x = window.scrollX || 0;
    var deltaY = Math.abs(y - lastScrollY);
    var interval = now - lastScrollTs;
    if (deltaY < SCROLL_MIN_DELTA_PX || interval < SCROLL_MIN_INTERVAL_MS) return;
    lastScrollY = y;
    lastScrollTs = now;
    send({ type: 'scroll', x: x, y: y, ts: now });
  }, { passive: true });

  var CAPTURE_KEYS = { Enter: true, Escape: true, Tab: true };
  document.addEventListener('keydown', function(event) {
    if (!CAPTURE_KEYS[event.key]) return;
    // 엔터 등을 키프레스로 기록하기 전에 pending input debounce를 먼저 flush.
    // 이렇게 해야 "사용자가 타이핑 → 엔터" 시퀀스가 항상 [input, keypress] 순서로 저장됨.
    flushAllPendingInputs();
    var el = event.target instanceof Element ? event.target : null;
    var selector = el ? getSelector(el) : null;
    var context = el ? getContext(el) : null;
    send({ type: 'keypress', key: event.key, selector: selector, context: context, ts: Date.now() });
  }, true);

  // 페이지 전환·탭 숨김 시 마지막 보루로 펜딩 input을 flush.
  // SPA 라우팅/모달 닫힘으로 input 이벤트만 발생하고 blur/change 없이 사라지는 케이스 대비.
  window.addEventListener('pagehide', flushAllPendingInputs, true);
  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'hidden') flushAllPendingInputs();
  }, true);

  // 한글 IME 조합 종료 시 펜딩 input을 즉시 flush.
  // 일부 브라우저/IME 조합에서 keydown(Enter)이 compositionend보다 먼저 발화하면,
  // flushAllPendingInputs 시점에 inputPending이 비어 input step이 손실된다.
  // compositionend 후 짧은 마이크로 지연으로 최종 input 이벤트가 들어올 시간을 주고 flush.
  document.addEventListener('compositionend', function(event) {
    var target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
    setTimeout(function() {
      var selector = getSelector(target, { allowBrittle: true }) || '';
      flushPendingInputForSelector(selector);
    }, 0);
  }, true);

  // focusout 시 펜딩 input을 flush.
  // maxlength 도달 시 Vue 컴포넌트가 자동으로 다음 input으로 focus() 옮기는 패턴(전화번호
  // 뒷자리, 주민번호 뒷자리 등)에서는 click·change·keydown 모두 발생하지 않아 기존
  // flush 경로를 못 탄다. focusout은 포커스가 다른 요소로 옮겨갈 때 항상 발생한다.
  document.addEventListener('focusout', function(event) {
    var target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
    var selector = getSelector(target, { allowBrittle: true }) || '';
    flushPendingInputForSelector(selector);
  }, true);

  // beforeinput도 안전망: 일부 SPA에서 contenteditable이나 커스텀 컴포넌트가
  // native input 이벤트를 누락시키는 경우, beforeinput에서 값 변화를 감지해 펜딩에 올린다.
  // (정상 input 이벤트가 또 오면 동일 selector라 덮어쓰기될 뿐 영향 없음)
})();
`;

let activeTabId: number | null = null;
let collectedLogs: RecordedEvent[] = [];
let startUrl = "";
let debuggerEventListener: ((source: chrome.debugger.Debuggee, method: string, params?: any) => void) | null = null;
let bindingListener: ((source: chrome.debugger.Debuggee, method: string, params?: any) => void) | null = null;
let tabCreatedListener: ((tab: chrome.tabs.Tab) => void) | null = null;
const attachedRecordingTabs = new Set<number>();

async function injectRecorderScript(tabId: number): Promise<void> {
  try {
    await cdp.evaluate(tabId, INJECT_SCRIPT);
  } catch {
    // page may not be ready yet
  }
}

async function attachAndInjectRecording(tabId: number): Promise<void> {
  await cdp.attachToTab(tabId);
  attachedRecordingTabs.add(tabId);
  await sendCmd(tabId, "Page.enable");
  await sendCmd(tabId, "Runtime.enable");
  await sendCmd(tabId, "Runtime.addBinding", { name: BINDING_NAME });
  await injectRecorderScript(tabId);
}

export async function startRecording(tabId: number): Promise<void> {
  collectedLogs = [];
  activeTabId = tabId;
  attachedRecordingTabs.clear();

  await cdp.attachToTab(tabId);
  attachedRecordingTabs.add(tabId);

  try {
    startUrl = await cdp.evaluate(tabId, "location.href") || "";
  } catch {
    startUrl = "";
  }

  await sendCmd(tabId, "Page.enable");
  await sendCmd(tabId, "Runtime.enable");
  await sendCmd(tabId, "Runtime.addBinding", { name: BINDING_NAME });

  bindingListener = (source: chrome.debugger.Debuggee, method: string, params?: any) => {
    const sourceTabId = source.tabId;
    if (sourceTabId == null || !attachedRecordingTabs.has(sourceTabId)) return;
    if (method === "Runtime.bindingCalled" && params?.name === BINDING_NAME) {
      try {
        const event = JSON.parse(params.payload) as RecordedEvent;
        console.log("[flux recorder] raw event:", JSON.stringify(event));
        collectedLogs.push(event);
      } catch {}
    }
    if (method === "Page.frameNavigated" && (!params?.frame?.parentId)) {
      const url = params?.frame?.url || "";
      collectedLogs.push({ type: "nav", url, ts: Date.now() });
      setTimeout(() => injectRecorderScript(sourceTabId), 500);
    }
  };
  chrome.debugger.onEvent.addListener(bindingListener);

  tabCreatedListener = (tab: chrome.tabs.Tab) => {
    if (tab.openerTabId != null && attachedRecordingTabs.has(tab.openerTabId) && tab.id != null) {
      const newTabId = tab.id;
      collectedLogs.push({ type: "nav", url: tab.pendingUrl || tab.url || "", ts: Date.now() });
      activeTabId = newTabId;
      setTimeout(async () => {
        try {
          await attachAndInjectRecording(newTabId);
        } catch {}
      }, 800);
    }
  };
  chrome.tabs.onCreated.addListener(tabCreatedListener);

  await injectRecorderScript(tabId);
}

export async function stopRecording(tabId: number): Promise<StopRecordingResult> {
  const lastActiveTab = activeTabId ?? tabId;
  let endUrl = "";
  try {
    endUrl = await cdp.evaluate(lastActiveTab, "location.href") || "";
  } catch {
    try { endUrl = await cdp.evaluate(tabId, "location.href") || ""; } catch {}
  }

  if (bindingListener) {
    chrome.debugger.onEvent.removeListener(bindingListener);
    bindingListener = null;
  }
  if (tabCreatedListener) {
    chrome.tabs.onCreated.removeListener(tabCreatedListener);
    tabCreatedListener = null;
  }

  for (const tid of attachedRecordingTabs) {
    await cdp.detachFromTab(tid).catch(() => {});
  }
  attachedRecordingTabs.clear();

  const logs = [...collectedLogs];
  const result: StopRecordingResult = {
    startUrl: startUrl || "",
    endUrl,
    logs,
  };

  collectedLogs = [];
  activeTabId = null;
  startUrl = "";

  return result;
}

function sendCmd(tabId: number, method: string, params?: Record<string, any>): Promise<any> {
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
