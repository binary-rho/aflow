/** LLM/토큰 누수 방지: 텍스트에서 개인정보·토큰 패턴을 마스킹합니다. (페이지 요약용) */
function maskPII(text: string): string {
  if (!text || typeof text !== "string") return text;
  return text
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[이메일 마스킹]")
    .replace(/\b01[0-9]-?[0-9]{3,4}-?[0-9]{4}\b|\b0[0-9]{1,2}-?[0-9]{3,4}-?[0-9]{4}\b/g, "[전화 마스킹]")
    .replace(/\b[0-9]{4}[- ]?[0-9]{4}[- ]?[0-9]{4}[- ]?[0-9]{4}\b/g, "[카드 마스킹]")
    .replace(/\b[0-9]{6}-?[0-7][0-9]{6}\b/g, "[주민번호 마스킹]")
    .replace(/eyJ[A-Za-z0-9_-]{50,}/g, "[토큰 마스킹]")
    .replace(/\b[A-Za-z0-9+/=]{40,}\b/g, "[긴문자열 마스킹]");
}

/**
 * 페이지 요약(경량) JSON을 LLM에 넘길 때 사용하는 문자열로 포맷합니다.
 * 각 CTA/formField에 context(부모 맥락)와 unique selector를 포함하여
 * LLM이 정확한 요소를 지정하도록 합니다.
 */
export function formatPageSummaryForLLM(summary: PageSummaryPayload): string {
  const lines: string[] = [];
  if (summary.path) lines.push(`path: ${summary.path}`);
  if (summary.title) lines.push(`title: ${maskPII(summary.title)}`);
  if (summary.viewport) lines.push(`viewport: ${summary.viewport.width}x${summary.viewport.height} (${summary.viewport.mode})`);
  if (summary.headings?.length) lines.push(`headings: ${summary.headings.map((h) => maskPII(h)).join(" | ")}`);
  if (summary.ctas?.length) {
    lines.push("ctas:");
    for (const c of summary.ctas) {
      const parts: string[] = [];
      parts.push("  - \"" + (c.text ? maskPII(c.text) : "(no text)") + "\"");
      if (c.role) parts.push("[" + c.role + "]");
      if (c.context) parts.push("in " + c.context);
      if (c.gtmText) parts.push("gtm \"" + c.gtmText + "\"");
      if (c.selector) parts.push("→ " + c.selector);
      lines.push(parts.join(" "));
    }
  }
  if (summary.formFields?.length) {
    lines.push("formFields:");
    for (const f of summary.formFields) {
      const parts: string[] = [];
      const label = f.label || f.placeholder || f.name || "(unnamed)";
      parts.push("  - \"" + maskPII(label) + "\"");
      if (f.inputType) parts.push("[" + f.inputType + "]");
      if (f.context) parts.push("in " + f.context);
      if (f.selector) parts.push("→ " + f.selector);
      lines.push(parts.join(" "));
    }
  }
  if (summary.navItems?.length) lines.push(`nav: ${summary.navItems.map((n) => maskPII(n)).join(" | ")}`);
  if (summary.modalPhrases?.length) lines.push(`modals/toast: ${summary.modalPhrases.map((m) => maskPII(m)).join(" | ")}`);
  if (summary.testIds?.length) lines.push(`data-testid: ${summary.testIds.join(", ")}`);
  return lines.filter(Boolean).join("\n");
}

export interface PageSummaryPayload {
  path: string;
  title: string | null;
  h1: string | null;
  headings: string[];
  viewport?: { width: number; height: number; mode: "mobile" | "tablet" | "pc" };
  ctas: {
    text: string | null;
    role: string | null;
    selector: string | null;
    context: string | null;
    gtmText: string | null;
  }[];
  formFields: {
    name: string | null;
    placeholder: string | null;
    label: string | null;
    selector: string | null;
    context: string | null;
    inputType: string | null;
  }[];
  navItems: string[];
  modalPhrases: string[];
  testIds: string[];
}

/**
 * LLM에 넘길 때 사용하는 "정규화된 페이지 요약"만 수집하는 스크립트.
 * - input/textarea value는 수집하지 않음 (PII).
 * - 이메일/전화/카드/토큰 패턴은 페이지 컨텍스트에서 마스킹.
 * CDP evaluate로 실행 후 반환값(JSON 문자열)을 그대로 저장·전달합니다.
 */
export const DOM_PAGE_SUMMARY_SCRIPT = `
(function() {
  function mask(s) {
    if (!s || typeof s !== 'string') return s;
    return s
      .replace(/\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}\\b/g, '[이메일 마스킹]')
      .replace(/\\b01[0-9]-?[0-9]{3,4}-?[0-9]{4}\\b|\\b0[0-9]{1,2}-?[0-9]{3,4}-?[0-9]{4}\\b/g, '[전화 마스킹]')
      .replace(/\\b[0-9]{4}[- ]?[0-9]{4}[- ]?[0-9]{4}[- ]?[0-9]{4}\\b/g, '[카드 마스킹]')
      .replace(/eyJ[A-Za-z0-9_-]{50,}/g, '[토큰 마스킹]')
      .replace(/\\b[A-Za-z0-9+/=]{40,}\\b/g, '[긴문자열 마스킹]');
  }
  function text(el) {
    var main = (el.innerText || el.textContent || '').trim();
    var al = (el.getAttribute('aria-label') || '').trim();
    var parts = [main];
    if (al && main.indexOf(al) < 0) parts.push(al);
    [].slice.call(el.querySelectorAll('img[alt]')).forEach(function(im) {
      var a = (im.getAttribute('alt') || '').trim();
      if (a && main.indexOf(a) < 0) parts.push(a);
    });
    var t = parts.join(' ').trim().replace(/\\s+/g, ' ');
    return t ? mask(t).slice(0, 200) : null;
  }
  function validCls(c) {
    if (c.length <= 1 || !/^[a-zA-Z_-]/.test(c)) return false;
    if (/^(active|hover|focus|show|hide|open|close|visible|hidden|selected|disabled|animate|transition|fade|in|out|on|off|current|enabled|collapsed|expanded|toggled)$/i.test(c)) return false;
    if (/^(js-|ng-|v-|is-|has-|no-|not-|ui-|wp-|el-|ant-|data-)/i.test(c)) return false;
    if (/[-_](active|hover|focus|show|hide|open|close|visible|hidden|selected|disabled|current)$/i.test(c)) return false;
    return true;
  }
  function getContext(el) {
    var cur = el.parentElement;
    var d = 0;
    var innerCtx = null;
    var containerType = null;
    var headings = [];
    while (cur && d < 10 && cur !== document.body) {
      d++;
      var tag = cur.tagName.toLowerCase();
      var role = (cur.getAttribute('role') || '').trim();
      var cls = (typeof cur.className === 'string') ? cur.className.trim() : '';
      var isSemantic = 'section article nav header footer main aside form dialog'.split(' ').indexOf(tag) >= 0;
      var isRole = 'region navigation banner contentinfo main dialog form search'.split(' ').indexOf(role) >= 0;
      var ctxClass = cls ? (cls.split(/\\s+/).filter(function(c) {
        return /(card|item|product|banner|slide|menu|tab|modal|panel|group|login|signup|search|filter|content|area|popup|popover|bottomsheet|bottom-sheet|tooltip|toast|snackbar|drawer|overlay|layer)/i.test(c);
      })[0] || null) : null;
      if (!containerType) {
        if (tag === 'dialog' || role === 'dialog' || role === 'alertdialog') containerType = 'dialog';
        else if (/(bottom[-_]?sheet|bottomsheet)/i.test(cls)) containerType = 'bottomsheet';
        else if (role === 'tooltip') containerType = 'tooltip';
        else if (/(popup|popover)/i.test(cls) || cur.hasAttribute('popover')) containerType = 'popup';
        else if (cur.getAttribute('aria-modal') === 'true' || /\bmodal\b/i.test(cls)) containerType = 'modal';
        else if (/(toast|snackbar)/i.test(cls) || role === 'status') containerType = 'toast';
      }
      var hEl = cur.querySelector('h1, h2, h3, h4, h5, h6, [role="heading"]');
      var ht = hEl ? mask((hEl.innerText || '').trim().replace(/\\s+/g, ' ')).slice(0, 60) : null;
      if (!ht) {
        for (var ci = 0; ci < Math.min(cur.children.length, 5); ci++) {
          var ch = cur.children[ci];
          if (!ch || !ch.tagName) continue;
          var chtag = ch.tagName.toLowerCase();
          if (chtag === 'section' || chtag === 'ul' || chtag === 'ol' || chtag === 'table' || chtag === 'form') continue;
          if (ch.querySelector && ch.querySelector('section, article, ul, ol, table')) continue;
          var chtx = mask((ch.innerText || '').trim().replace(/\\s+/g, ' ')).slice(0, 60);
          if (chtx && chtx.length >= 2 && chtx.length <= 60) { ht = chtx; break; }
        }
      }
      var al = (cur.getAttribute('aria-label') || '').trim().slice(0, 60) || null;
      if (ht && headings.indexOf(ht) < 0) headings.push(ht);
      if ((isSemantic || isRole || ctxClass) && !innerCtx) {
        var name = ctxClass || (role && role !== tag ? role : tag);
        var desc = ht || al;
        innerCtx = desc ? name + '("' + desc + '")' : name;
      }
      cur = cur.parentElement;
    }
    if (containerType && innerCtx && innerCtx.indexOf(containerType) < 0) {
      innerCtx = containerType + ' > ' + innerCtx;
    } else if (containerType && !innerCtx) {
      innerCtx = containerType;
    }
    var outerHeading = headings.length > 1 ? headings[headings.length - 1] : null;
    if (innerCtx) {
      if (outerHeading && innerCtx.indexOf(outerHeading) < 0) {
        return innerCtx + ' in heading("' + outerHeading + '")';
      }
      return innerCtx;
    }
    if (outerHeading) return 'heading("' + outerHeading + '")';
    if (headings.length > 0) return 'heading("' + headings[0] + '")';
    return null;
  }
  function buildSelector(el) {
    var id = (el.id || '').trim();
    if (id && /^[a-zA-Z][\\w-]*$/.test(id)) {
      try { if (document.querySelectorAll('#' + id).length === 1) return '#' + id; } catch(e) {}
    }
    var tid = el.getAttribute('data-testid') || el.getAttribute('data-test-id');
    if (tid) {
      var s = '[data-testid="' + tid.replace(/"/g, '\\\\"') + '"]';
      try { if (document.querySelectorAll(s).length === 1) return s; } catch(e) {}
    }
    var tag = el.tagName.toLowerCase();
    var cls = (typeof el.className === 'string') ? el.className.trim() : '';
    if (cls) {
      var classes = cls.split(/\\s+/).filter(validCls);
      for (var i = 0; i < Math.min(classes.length, 4); i++) {
        try { var s = '.' + classes[i]; if (document.querySelectorAll(s).length === 1) return s; } catch(e) {}
      }
      for (var i = 0; i < Math.min(classes.length, 4); i++) {
        try { var s = tag + '.' + classes[i]; if (document.querySelectorAll(s).length === 1) return s; } catch(e) {}
      }
      var p = el.parentElement;
      if (p) {
        var pc = (typeof p.className === 'string') ? p.className.trim() : '';
        if (pc) {
          var pcArr = pc.split(/\\s+/).filter(validCls);
          for (var pi = 0; pi < Math.min(pcArr.length, 3); pi++) {
            for (var ci = 0; ci < Math.min(classes.length, 3); ci++) {
              try {
                var s = '.' + pcArr[pi] + ' .' + classes[ci];
                var all = document.querySelectorAll(s);
                if (all.length === 1) return s;
                if (all.length > 1) {
                  var parentCard = el.closest('.' + pcArr[pi]);
                  if (parentCard && parentCard.parentElement) {
                    var sameTag = [].slice.call(parentCard.parentElement.children).filter(function(n) { return n.tagName && n.tagName.toLowerCase() === parentCard.tagName.toLowerCase(); });
                    var k = sameTag.indexOf(parentCard) + 1;
                    var tagName = parentCard.tagName.toLowerCase();
                    var sUnique = tagName + '.' + pcArr[pi] + ':nth-of-type(' + k + ') .' + classes[ci];
                    try { if (document.querySelector(sUnique) === el) return sUnique; } catch(e2) {}
                  }
                }
              } catch(e) {}
            }
            try {
              var s = '.' + pcArr[pi] + ' > ' + tag;
              var allP = document.querySelectorAll(s);
              var parentsCount = document.querySelectorAll('.' + pcArr[pi]).length;
              if (allP.length === 1 && parentsCount <= 1) return s;
              if (allP.length >= 1 && parentsCount > 1) {
                var parentEl = el.closest('.' + pcArr[pi]);
                if (parentEl && parentEl.parentElement) {
                  var sameTagP = [].slice.call(parentEl.parentElement.children).filter(function(n) { return n.tagName && n.tagName.toLowerCase() === parentEl.tagName.toLowerCase(); });
                  var kP = sameTagP.indexOf(parentEl) + 1;
                  var tagP = parentEl.tagName.toLowerCase();
                  var sUniqueP = tagP + '.' + pcArr[pi] + ':nth-of-type(' + kP + ') > ' + tag;
                  try { if (document.querySelector(sUniqueP) === el) return sUniqueP; } catch(e2) {}
                }
              }
            } catch(e) {}
          }
        }
        var gp = p.parentElement;
        if (gp) {
          var gpc = (typeof gp.className === 'string') ? gp.className.trim() : '';
          if (gpc) {
            var gpArr = gpc.split(/\\s+/).filter(validCls);
            for (var gi = 0; gi < Math.min(gpArr.length, 2); gi++) {
              for (var ci = 0; ci < Math.min(classes.length, 3); ci++) {
                try {
                  var s = '.' + gpArr[gi] + ' .' + classes[ci];
                  var all = document.querySelectorAll(s);
                  if (all.length === 1) return s;
                  if (all.length > 1) {
                    var parentCard = el.closest('.' + gpArr[gi]);
                    if (parentCard && parentCard.parentElement) {
                      var sameTag = [].slice.call(parentCard.parentElement.children).filter(function(n) { return n.tagName && n.tagName.toLowerCase() === parentCard.tagName.toLowerCase(); });
                      var k = sameTag.indexOf(parentCard) + 1;
                      var tagName = parentCard.tagName.toLowerCase();
                      var sUnique = tagName + '.' + gpArr[gi] + ':nth-of-type(' + k + ') .' + classes[ci];
                      try { if (document.querySelector(sUnique) === el) return sUnique; } catch(e2) {}
                    }
                  }
                } catch(e) {}
              }
            }
          }
        }
      }
    }
    var al = (el.getAttribute('aria-label') || '').trim();
    if (al) {
      try { var s = tag + '[aria-label="' + al.replace(/"/g, '\\\\"') + '"]'; if (document.querySelectorAll(s).length === 1) return s; } catch(e) {}
    }
    var parts = [];
    var cur = el;
    for (var dd = 0; dd < 6; dd++) {
      if (!cur || cur === document.body) { parts.unshift('body'); break; }
      var t = cur.tagName.toLowerCase();
      var cid = (cur.id || '').trim();
      if (cid && /^[a-zA-Z][\\w-]*$/.test(cid) && dd > 0) { parts.unshift('#' + cid); break; }
      var sibs = cur.parentElement ? [].slice.call(cur.parentElement.children).filter(function(c) { return c.tagName && c.tagName.toLowerCase() === t; }) : [];
      var idx = sibs.indexOf(cur) + 1;
      var curCls = (typeof cur.className === 'string') ? cur.className.trim() : '';
      var mc = curCls ? curCls.split(/\\s+/).filter(validCls)[0] : null;
      parts.unshift(mc ? t + '.' + mc + ':nth-of-type(' + idx + ')' : t + ':nth-of-type(' + idx + ')');
      cur = cur.parentElement;
    }
    if (parts[0] !== 'body' && parts[0].charAt(0) !== '#') parts.unshift('body');
    return parts.join(' > ');
  }
  try {
    var root = document.body || document.documentElement;
    if (!root) return JSON.stringify({ path: '', title: null, h1: null, headings: [], viewport: null, ctas: [], formFields: [], navItems: [], modalPhrases: [], testIds: [] });
    var path = (location.pathname || '/').trim();
    var title = (document.title || '').trim() ? mask(document.title).slice(0, 150) : null;
    var vw = window.innerWidth || document.documentElement.clientWidth || 0;
    var vh = window.innerHeight || document.documentElement.clientHeight || 0;
    var host = (location.hostname || '').toLowerCase();
    var isMobileDomain = host.indexOf('m.') === 0 || host.indexOf('m-') === 0 || host.indexOf('mobile.') === 0;
    var vMode = isMobileDomain ? 'mobile' : vw < 768 ? 'mobile' : vw < 1024 ? 'tablet' : 'pc';
    var viewport = { width: vw, height: vh, mode: vMode };
    var headings = [];
    [].slice.call(root.querySelectorAll('h1, h2, h3')).forEach(function(el) {
      var t = text(el);
      if (t) headings.push(t);
    });
    var h1 = root.querySelector('h1');
    var firstH1 = h1 ? text(h1) : null;
    var ctas = [];
    root.querySelectorAll('button, a[href], [role="button"], [role="link"]').forEach(function(el) {
      var t = text(el);
      if (!t && !el.getAttribute('role')) return;
      var sel = buildSelector(el);
      var ctx = getContext(el);
      var gtm = (el.getAttribute('data-gtm-click-text') || '').trim() || null;
      ctas.push({ text: t, role: (el.getAttribute('role') || '').trim() || null, selector: sel, context: ctx, gtmText: gtm });
    });
    if (ctas.length > 80) ctas = ctas.slice(0, 80);
    var formFields = [];
    root.querySelectorAll('input:not([type="hidden"]), textarea, select').forEach(function(el) {
      var name = (el.getAttribute('name') || '').trim() || null;
      var placeholder = (el.getAttribute('placeholder') || '').trim() || null;
      var label = null;
      var id = (el.id || '').trim();
      if (id) {
        var lbl = document.querySelector('label[for="' + id.replace(/"/g, '\\\\"') + '"]');
        if (lbl) label = (lbl.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 80) || null;
      }
      if (!label && el.closest('label')) label = (el.closest('label').textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 80) || null;
      var sel = buildSelector(el);
      var ctx = getContext(el);
      var inputType = (el.type || '').toLowerCase() || null;
      formFields.push({ name: name, placeholder: placeholder, label: label, selector: sel, context: ctx, inputType: inputType });
    });
    if (formFields.length > 30) formFields = formFields.slice(0, 30);
    var navItems = [];
    (root.querySelectorAll('nav a, [role="navigation"] a, [role="tablist"] [role="tab"], header a, [class*="gnb"] a, [class*="menu"] a')).forEach(function(el) {
      var t = text(el);
      if (t) navItems.push(t);
    });
    if (navItems.length > 40) navItems = navItems.slice(0, 40);
    var modalPhrases = [];
    root.querySelectorAll('[role="dialog"], [role="alert"], .modal, .toast, [class*="modal"], [class*="toast"]').forEach(function(el) {
      var t = text(el);
      if (t) modalPhrases.push(t);
    });
    if (modalPhrases.length > 10) modalPhrases = modalPhrases.slice(0, 10);
    var testIds = [];
    root.querySelectorAll('[data-testid], [data-test-id]').forEach(function(el) {
      var id = el.getAttribute('data-testid') || el.getAttribute('data-test-id');
      if (id && testIds.indexOf(id) === -1) testIds.push(id);
    });
    if (testIds.length > 50) testIds = testIds.slice(0, 50);
    return JSON.stringify({
      path: path,
      title: title,
      h1: firstH1,
      headings: headings,
      viewport: viewport,
      ctas: ctas,
      formFields: formFields,
      navItems: navItems,
      modalPhrases: modalPhrases,
      testIds: testIds
    });
  } catch (e) {
    return JSON.stringify({ path: '', title: null, h1: null, headings: [], ctas: [], formFields: [], navItems: [], modalPhrases: [], testIds: [], error: e.message });
  }
})();
`;

/**
 * 검사 중인 페이지에서 클릭/표시 가능한 요소 목록을 수집합니다.
 * chrome.devtools.inspectedWindow.eval()로 페이지 컨텍스트에서 실행됩니다.
 * DevTools 패널에서만 사용 가능합니다.
 *
 * 수집 결과는 (1) DRR→DSL 변환 시 LLM에 전달하고,
 * (2) 추후 GUI 시나리오 빌더에서 "이 요소 클릭" / "이 입력란에 값 입력" 등으로 재사용할 수 있도록
 * 구조화된 타입(DOMElementSummary)으로 제공합니다.
 *
 * DOM_SNAPSHOT_SCRIPT는 시나리오 실행 시 CDP로 특정 탭에서 실행할 수 있도록 export합니다.
 */
export const DOM_SNAPSHOT_SCRIPT = `
(function() {
  try {
    var out = [];
    var seen = new Set();
    var root = document.body || document.documentElement;
    if (!root) return JSON.stringify([]);
    var candidates = root.querySelectorAll(
      'button, a[href], input:not([type="hidden"]), textarea, select, ' +
      '[role="button"], [role="link"], [role="textbox"], [data-testid], [data-test-id], ' +
      '[id]:not([id=""]), main, [role="main"], [role="banner"], [role="contentinfo"], ' +
      'header, footer, nav, [class*="logo"], [class*="menu"], [class*="btn"], [class*="button"], [class*="input"]'
    );
    var max = Math.min(candidates.length, 150);
    for (var i = 0; i < max; i++) {
      var el = candidates[i];
      var tag = el.tagName.toLowerCase();
      var role = (el.getAttribute('role') || '').trim();
      var imgAlts = [].slice.call(el.querySelectorAll('img[alt]')).map(function(i){ return i.getAttribute('alt') || ''; }).join(' ').trim();
      var text = (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('placeholder') || imgAlts || '').trim().replace(/\\s+/g, ' ').slice(0, 120);
      var id = (el.id || '').trim();
      var testId = el.getAttribute('data-testid') || el.getAttribute('data-test-id') || '';
      var selector = '';
      if (id && /^[a-zA-Z][\\w.-]*$/.test(id) && !seen.has('#' + id)) {
        selector = '#' + id;
        seen.add(selector);
      } else if (testId && !seen.has('[data-testid="' + testId + '"]')) {
        selector = '[data-testid="' + testId.replace(/"/g, '\\\\"') + '"]';
        seen.add(selector);
      }
      var type = 'other';
      if (tag === 'a' || role === 'link') type = 'link';
      else if (tag === 'button' || tag === 'input' && /^(submit|button|image)$/i.test(el.type) || role === 'button') type = 'button';
      else if (tag === 'input' || tag === 'textarea' || tag === 'select' || role === 'textbox' || role === 'combobox') type = 'input';
      else if (tag === 'main' || tag === 'nav' || role === 'main' || role === 'banner' || role === 'contentinfo' || tag === 'header' || tag === 'footer') type = 'landmark';
      var href = (tag === 'a' && el.getAttribute('href')) ? el.getAttribute('href') : null;
      var placeholder = (el.getAttribute('placeholder') || '').trim() || null;
      var name = (el.getAttribute('name') || '').trim() || null;
      var inputType = (tag === 'input' && el.type) ? el.type.toLowerCase() : null;
      if (selector || text || type === 'landmark' || role) {
        out.push({
          selector: selector || null,
          text: text || null,
          tag: tag,
          role: role || null,
          type: type,
          href: href,
          placeholder: placeholder,
          name: name,
          inputType: inputType
        });
      }
    }
    return JSON.stringify(out);
  } catch (e) {
    return JSON.stringify([{ error: e.message }]);
  }
})();
`;

/** 요소 종류 — GUI에서 필터/아이콘 표시용 */
export type DOMElementType = "button" | "link" | "input" | "landmark" | "other";

/** 페이지에서 추출한 한 요소의 요약. LLM 변환 + 추후 시나리오 빌더 GUI에서 공통 사용 */
export type DOMElementSummary = {
  selector: string | null;
  text: string | null;
  tag: string;
  role: string | null;
  /** 버튼/링크/입력/랜드마크 등 — GUI에서 구분 표시용 */
  type: DOMElementType;
  /** a 태그인 경우 href */
  href?: string | null;
  /** input/textarea placeholder */
  placeholder?: string | null;
  /** input name */
  name?: string | null;
  /** input type (text, password, submit 등) */
  inputType?: string | null;
};

async function getActiveTabIdForSnapshot(): Promise<number | null> {
  if (typeof chrome === "undefined" || !chrome.tabs?.query) return null;
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const tab = tabs?.find((t) => t.url && !t.url.startsWith("chrome"));
  return tab?.id ?? null;
}

async function evalOnTab(tabId: number, script: string): Promise<string | null> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: "EVAL_DOM_SCRIPT", tabId, script },
      (response: { ok?: boolean; result?: string; error?: string } | undefined) => {
        if (response?.ok && response.result != null) {
          resolve(typeof response.result === "string" ? response.result : null);
        } else {
          resolve(null);
        }
      },
    );
  });
}

async function runSnapshotScript(): Promise<string | null> {
  const tabId = await getActiveTabIdForSnapshot();
  if (!tabId) return null;
  return evalOnTab(tabId, DOM_SNAPSHOT_SCRIPT);
}

/** 스크립트가 반환한 JSON(또는 구 형식)을 DOMElementSummary[]로 정규화 */
function parseSnapshotPayload(raw: string): DOMElementSummary[] {
  let arr: any[];
  try {
    arr = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  const out: DOMElementSummary[] = [];
  for (const item of arr) {
    if (item && typeof item === "object" && item.error) continue;
    const s = item && typeof item === "object" ? item : {};
    const type = ["button", "link", "input", "landmark", "other"].includes(s.type) ? s.type : "other";
    out.push({
      selector: s.selector ?? null,
      text: s.text ?? null,
      tag: String(s.tag || "unknown").toLowerCase(),
      role: s.role ?? null,
      type,
      href: s.href ?? null,
      placeholder: s.placeholder ?? null,
      name: s.name ?? null,
      inputType: s.inputType ?? null,
    });
  }
  return out;
}

/**
 * 검사 중인 페이지에서 수집한 요소 목록을 구조화된 배열로 반환합니다.
 * 시나리오 빌더 GUI에서 "이 버튼 클릭", "이 입력란에 값 입력" 등으로 사용할 수 있습니다.
 * 실패 시 null.
 */
export async function getInspectedPageDOMElements(): Promise<DOMElementSummary[] | null> {
  const raw = await runSnapshotScript();
  if (raw == null) return null;
  return parseSnapshotPayload(raw);
}

/**
 * LLM에 넘길 때 사용하는 문자열. 여러 페이지일 때는 호출 측에서 "## Page N: label" 형태로 붙입니다.
 * 단일 페이지면 formatDomSummaryForLLM(elements) 한 번만 사용하면 됩니다.
 */
export function formatDomSummaryForLLM(elements: DOMElementSummary[]): string {
  return elements
    .map((e) => {
      const parts = [e.type, e.text || "(no text)", e.selector ? `selector: ${e.selector}` : ""].filter(Boolean);
      return parts.join(" | ");
    })
    .join("\n");
}

/**
 * 검사 중인 페이지의 DOM 요약을 JSON 문자열로 반환합니다.
 * DRR 변환 시 LLM에 넘기거나, 캡처된 페이지 목록(domSnapshots)에 저장할 때 사용합니다.
 * 구조화된 배열이 필요하면 getInspectedPageDOMElements()를 사용하세요.
 */
export async function getInspectedPageDOMSummary(): Promise<string | null> {
  const raw = await runSnapshotScript();
  if (raw == null) return null;
  const elements = parseSnapshotPayload(raw);
  return JSON.stringify(elements);
}

/**
 * 검사 중인 페이지의 경량 요약(PageSummaryPayload)을 반환합니다.
 * DRR 변환 시 현재 페이지 DOM을 자동으로 LLM에 전달할 때 사용합니다.
 */
export async function getInspectedPageSummary(): Promise<PageSummaryPayload | null> {
  const tabId = await getActiveTabIdForSnapshot();
  if (!tabId) return null;
  const raw = await evalOnTab(tabId, DOM_PAGE_SUMMARY_SCRIPT);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed.error) return null;
    return parsed as PageSummaryPayload;
  } catch {
    return null;
  }
}
