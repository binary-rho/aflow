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
  checked: boolean;
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

  function getSelector(el) {
    if (!el || !(el instanceof Element)) return null;
    if (el.id) return '#' + escapeCss(el.id);

    var dataTestId = el.getAttribute('data-testid');
    if (dataTestId) return '[data-testid=\"' + dataTestId.replace(/\"/g, '\\\\\"') + '\"]';
    var dataTest = el.getAttribute('data-test');
    if (dataTest) return '[data-test=\"' + dataTest.replace(/\"/g, '\\\\\"') + '\"]';

    var name = el.getAttribute('name');
    if (name) return el.tagName.toLowerCase() + '[name=\"' + name.replace(/\"/g, '\\\\\"') + '\"]';

    var ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return el.tagName.toLowerCase() + '[aria-label=\"' + ariaLabel.replace(/\"/g, '\\\\\"') + '\"]';

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
    var parent = el.closest('li, article, section, .card, [class*="card"], [role="dialog"], .modal, [class*="modal"], nav, header') || el.parentElement;
    if (!parent) return null;
    return norm(parent.textContent || '').slice(0, 80) || null;
  }

  function getFieldLabel(el) {
    var id = (el.id || '').trim();
    if (id) {
      var byFor = document.querySelector('label[for="' + id.replace(/"/g, '\\\\"') + '"]');
      if (byFor) return norm(byFor.textContent || '');
    }
    var inLabel = el.closest('label');
    if (inLabel) return norm(inLabel.textContent || '');
    return norm(el.getAttribute('aria-label') || '') || norm(el.getAttribute('placeholder') || '') || norm(el.getAttribute('name') || '');
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
    var rawTarget = event.target instanceof Element ? event.target : null;
    if (!rawTarget) return;

    var checkTarget = rawTarget.closest(CHECKABLE);
    if (!checkTarget) {
      var labelEl = rawTarget.closest('label');
      if (labelEl) {
        var forId = labelEl.getAttribute('for');
        var assocInput = forId ? document.getElementById(forId) : labelEl.querySelector(CHECKABLE);
        if (assocInput && assocInput.closest(CHECKABLE)) {
          checkTarget = assocInput;
        }
      }
    }
    if (checkTarget) {
      var now = Date.now();
      if (checkTarget === lastCheckEl && now - lastCheckTs < CHECK_DEDUP_MS) return;
      lastCheckEl = checkTarget;
      lastCheckTs = now;
      var chkLabel = getFieldLabel(checkTarget);
      var checked = checkTarget.checked !== undefined ? !checkTarget.checked : true;
      var chkSelector = getSelector(checkTarget);
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
        var parentLabel = checkTarget.id
          ? document.querySelector('label[for="' + checkTarget.id.replace(/"/g, '\\\\"') + '"]')
          : checkTarget.closest('label');
        if (parentLabel) {
          var altImg = parentLabel.querySelector('img[alt]');
          if (altImg && altImg.getAttribute('alt')) chkLabel = norm(altImg.getAttribute('alt'));
          var txtSpan = parentLabel.querySelector('.txt, .title, .tit, [class*="name"]');
          if (txtSpan) chkLabel = norm(txtSpan.textContent || '') || chkLabel;
        }
      }

      send({ type: 'check', label: chkLabel || chkSelector || '', checked: checked, selector: chkSelector, context: chkContext, ts: Date.now() });
      return;
    }

    var target = rawTarget.closest(CLICKABLE);
    if (!target) {
      target = rawTarget.closest('[tabindex]:not([tabindex="-1"]), [onclick]');
    }
    if (!target) return;
    var text = getText(target);
    if (!text) return;
    var context = getContext(target);
    var href = target.getAttribute('href');
    var inHeader = !!target.closest('header, nav, [role="navigation"], [class*="gnb"], [class*="menu"]');
    var selector = getSelector(target);
    send({ type: 'click', text: text, selector: selector, context: context, href: href || null, inHeader: inHeader, ts: Date.now() });
  }, true);

  document.addEventListener('change', function(event) {
    var el = event.target;
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) return;
    if (el.disabled || (el instanceof HTMLInputElement && el.type === 'hidden')) return;

    if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
      return;
    }

    var label = getFieldLabel(el);
    if (!label) return;
    var value = String(el.value || '').trim();
    if (!value) return;
    var context = getContext(el);
    var selector = getSelector(el);
    if (el instanceof HTMLSelectElement) {
      var optText = el.options[el.selectedIndex] ? norm(el.options[el.selectedIndex].textContent || '') : value;
      send({ type: 'select', label: label, value: value, optionText: optText, selector: selector, context: context, ts: Date.now() });
    } else {
      send({ type: 'input', label: label, value: value, selector: selector, context: context, ts: Date.now() });
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
    var el = event.target instanceof Element ? event.target : null;
    var selector = el ? getSelector(el) : null;
    var context = el ? getContext(el) : null;
    send({ type: 'keypress', key: event.key, selector: selector, context: context, ts: Date.now() });
  }, true);
})();
`;

let activeTabId: number | null = null;
let collectedLogs: RecordedEvent[] = [];
let startUrl = "";
let debuggerEventListener: ((source: { tabId: number }, method: string, params?: any) => void) | null = null;
let bindingListener: ((source: { tabId: number }, method: string, params?: any) => void) | null = null;
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

  bindingListener = (source: { tabId: number }, method: string, params?: any) => {
    if (!attachedRecordingTabs.has(source.tabId)) return;
    if (method === "Runtime.bindingCalled" && params?.name === BINDING_NAME) {
      try {
        const event = JSON.parse(params.payload) as RecordedEvent;
        collectedLogs.push(event);
      } catch {}
    }
    if (method === "Page.frameNavigated" && (!params?.frame?.parentId)) {
      const url = params?.frame?.url || "";
      collectedLogs.push({ type: "nav", url, ts: Date.now() });
      setTimeout(() => injectRecorderScript(source.tabId), 500);
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
