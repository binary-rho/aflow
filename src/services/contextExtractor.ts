/**
 * 요소의 매칭용 컨텍스트(context / nearestLandmark / accessibleName) 추출 로직의 단일 소스.
 *
 * 왜 문자열 빌더인가: 이 로직은 페이지 컨텍스트(CDP Runtime.evaluate)에서 실행돼야 한다.
 * 녹화(recorder.ts 주입 스크립트)와 실행 요약(domSnapshot.ts) 양쪽이 **동일한 함수**로
 * context를 만들어야, 저장한 값과 매칭 시 비교하는 값이 대칭이 된다. 예전엔 recorder가
 * 조잡한 텍스트 덩어리를, domSnapshot이 구조화 문자열을 만들어 서로 안 맞았다.
 *
 * textMatch.ts의 buildClientNormalizerScript와 같은 패턴: JS 문자열을 뽑아 주입.
 * 노출 함수(주입된 스코프의 지역 함수): __fluxGetContext, __fluxGetNearestLandmark,
 * __fluxGetAccessibleName. 의존 헬퍼(__fluxMask)도 함께 정의해 자립적으로 동작한다.
 */

/**
 * 페이지 컨텍스트에 주입할 context 추출기 함수들의 JS 소스를 반환한다.
 * 주입 스크립트(IIFE) 안에서 이 문자열을 펼쳐 넣으면 아래 함수들이 지역 스코프에 정의된다.
 */
export function buildContextExtractorScript(): string {
  return `
  function __fluxMask(s) {
    if (!s || typeof s !== 'string') return s;
    return s
      .replace(/\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}\\b/g, '[이메일 마스킹]')
      .replace(/\\b01[0-9]-?[0-9]{3,4}-?[0-9]{4}\\b|\\b0[0-9]{1,2}-?[0-9]{3,4}-?[0-9]{4}\\b/g, '[전화 마스킹]')
      .replace(/\\b[0-9]{4}[- ]?[0-9]{4}[- ]?[0-9]{4}[- ]?[0-9]{4}\\b/g, '[카드 마스킹]')
      .replace(/eyJ[A-Za-z0-9_-]{50,}/g, '[토큰 마스킹]')
      .replace(/\\b[A-Za-z0-9+/=]{40,}\\b/g, '[긴문자열 마스킹]');
  }

  function __fluxGetContext(el) {
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
        else if (cur.getAttribute('aria-modal') === 'true' || /\\bmodal\\b/i.test(cls)) containerType = 'modal';
        else if (/(toast|snackbar)/i.test(cls) || role === 'status') containerType = 'toast';
      }
      var hEl = cur.querySelector('h1, h2, h3, h4, h5, h6, [role="heading"]');
      var ht = hEl ? __fluxMask((hEl.innerText || '').trim().replace(/\\s+/g, ' ')).slice(0, 60) : null;
      if (!ht) {
        for (var ci = 0; ci < Math.min(cur.children.length, 5); ci++) {
          var ch = cur.children[ci];
          if (!ch || !ch.tagName) continue;
          var chtag = ch.tagName.toLowerCase();
          if (chtag === 'section' || chtag === 'ul' || chtag === 'ol' || chtag === 'table' || chtag === 'form') continue;
          if (ch.querySelector && ch.querySelector('section, article, ul, ol, table')) continue;
          var chtx = __fluxMask((ch.innerText || '').trim().replace(/\\s+/g, ' ')).slice(0, 60);
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

  function __fluxGetNearestLandmark(el) {
    var cur = el.parentElement;
    var hops = 0;
    while (cur && hops < 12 && cur !== document.body) {
      hops++;
      var tag = cur.tagName.toLowerCase();
      var role = (cur.getAttribute('role') || '').trim().toLowerCase();
      if (tag === 'dialog' || role === 'dialog' || role === 'alertdialog') return 'dialog';
      if (tag === 'form' || role === 'form') return 'form';
      if (tag === 'header' || role === 'banner') return 'header';
      if (tag === 'nav' || role === 'navigation') return 'nav';
      if (tag === 'footer' || role === 'contentinfo') return 'footer';
      if (tag === 'main' || role === 'main') return 'main';
      if (tag === 'section' || role === 'region') return 'section';
      cur = cur.parentElement;
    }
    return null;
  }

  function __fluxGetAccessibleName(el, fallbackText) {
    var aria = (el.getAttribute('aria-label') || '').trim();
    if (aria) return aria;
    var labelledBy = (el.getAttribute('aria-labelledby') || '').trim();
    if (labelledBy) {
      var parts = labelledBy.split(/\\s+/).map(function(id) {
        var ref = document.getElementById(id);
        return ref ? (ref.textContent || '').trim() : '';
      }).filter(Boolean);
      if (parts.length) return parts.join(' ').slice(0, 120);
    }
    var title = (el.getAttribute('title') || '').trim();
    if (title) return title;
    return fallbackText || null;
  }
`;
}
