/**
 * Active Scope Resolver — 활성 모달/오버레이를 찾아 검색 범위를 좁히는 단일 진실 원천.
 *
 * 정책(strict가 아니라 우선순위):
 *   1. 활성 모달이 있으면 그 자손에서 먼저 찾는다
 *   2. 거기서 못 찾으면 document 전체로 fallback
 *   → 모달 떴는데 본문 input 잡는 버그 방지 + 모달이 비표준이라 못 잡을 때의 안전망
 *
 * 활성 모달 우선순위 (UHDC PC FO 문서 기준):
 *   1. body > .modal[role="dialog"][aria-modal="true"] (display:none 제외)
 *   2. .modal-dialog 컨테이너
 *   3. .m-bv-modal (프로젝트 공통 시그니처 클래스)
 *
 * 같은 패턴: services/textMatch.ts의 buildClientNormalizerScript()와 동일하게,
 * TS 코드용 유틸은 따로 두지 않고 CDP 인라인 JS 주입용 문자열만 제공한다.
 */

/**
 * 페이지 컨텍스트에서 실행될 활성 모달 탐지 함수의 JS 문자열.
 *
 * 주입 후 사용:
 *   fluxFindActiveModal() → Element | null
 *   fluxQueryInScope(selector) → Element | null  // 모달 우선 + document fallback
 *   fluxQueryAllInScope(selector) → Element[]
 *   fluxActiveRoot() → Element  // 검색 root (모달 또는 body)
 */
export function buildClientActiveScopeScript(): string {
  return `
    var fluxFindActiveModal = function() {
      // 표준 신호 가산치 — role/aria/popover가 있으면 거의 확실한 모달
      var STANDARD_SIGNAL_SCORE = 10;
      // position별 오버레이 가산 (fixed가 모달/시트의 가장 강한 동작 신호)
      var POSITION_SCORE = { fixed: 4, absolute: 1, sticky: 1 };
      // 키워드 우선순위 가산 — sheet/dialog/modal이 가장 강함
      var KEYWORD_SCORE = [
        { re: /(bottom[-_]?sheet|sheet|dialog|modal)/i, score: 4 },
        { re: /(popup|popover|drawer)/i, score: 3 },
        { re: /(layer|overlay)/i, score: 2 }
      ];
      // 표준 신호가 없는 후보는 화면의 이 비율 이상을 덮어야 모달로 인정 (본문 유틸 클래스 오탐 방지)
      var MIN_OVERLAY_AREA_RATIO = 0.06;

      // 1. 후보 수집: 표준 신호 + 모달성 클래스/id 키워드
      var SELECTOR =
        '[role="dialog"], [role="alertdialog"], [aria-modal="true"], [popover], ' +
        '.modal, [class*="modal"], [id*="modal"], [id*="_BV_modal_"], ' +
        '[class*="sheet"], [class*="popup"], [class*="popover"], ' +
        '[class*="drawer"], [class*="layer"], [class*="overlay"], .m-bv-modal, .modal-dialog';
      var candidates = [].slice.call(document.querySelectorAll(SELECTOR));
      if (candidates.length === 0) return null;

      var vw = window.innerWidth || document.documentElement.clientWidth || 1;
      var vh = window.innerHeight || document.documentElement.clientHeight || 1;
      var screenArea = vw * vh;

      function hasStandardSignal(el) {
        var role = (el.getAttribute('role') || '').toLowerCase();
        return role === 'dialog' || role === 'alertdialog' ||
          el.getAttribute('aria-modal') === 'true' || el.hasAttribute('popover');
      }
      function keywordSignature(el) {
        var cls = (typeof el.className === 'string') ? el.className : '';
        var sig = cls + ' ' + (el.id || '');
        return sig;
      }

      // 2. 가시성·면적·동작 필터 + 점수 계산
      var scored = [];
      for (var i = 0; i < candidates.length; i++) {
        var el = candidates[i];
        var styleAttr = (el.getAttribute('style') || '').toLowerCase();
        if (styleAttr.indexOf('display: none') >= 0 || styleAttr.indexOf('display:none') >= 0) continue;
        if (el.getAttribute('aria-hidden') === 'true') continue;
        var cs;
        try { cs = window.getComputedStyle(el); } catch (e) { cs = null; }
        if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) continue;
        var rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;

        var standard = hasStandardSignal(el);
        var area = rect.width * rect.height;
        var areaRatio = area / screenArea;
        // 표준 신호 없는 작은 후보는 모달이 아닐 가능성 높음 → 제외
        if (!standard && areaRatio < MIN_OVERLAY_AREA_RATIO) continue;

        var score = 0;
        if (standard) score += STANDARD_SIGNAL_SCORE;
        var pos = cs ? cs.position : '';
        if (POSITION_SCORE[pos]) score += POSITION_SCORE[pos];
        var z = cs ? parseInt(cs.zIndex, 10) : NaN;
        if (!isNaN(z) && z > 0) score += Math.min(z / 100, 5);
        score += Math.min(areaRatio * 4, 4);
        var sig = keywordSignature(el);
        for (var k = 0; k < KEYWORD_SCORE.length; k++) {
          if (KEYWORD_SCORE[k].re.test(sig)) { score += KEYWORD_SCORE[k].score; break; }
        }
        scored.push({ el: el, score: score, area: area, idx: i });
      }
      if (scored.length === 0) return null;

      // 3. 최고 점수 선택. 동점이면 면적 큰 것 → DOM 뒤쪽(나중에 열린 것) 우선
      scored.sort(function(a, b) {
        if (b.score !== a.score) return b.score - a.score;
        if (b.area !== a.area) return b.area - a.area;
        return b.idx - a.idx;
      });
      var best = scored[0].el;

      // 4. 중첩 정리: best를 감싸는 더 바깥 모달 후보가 있으면 그쪽을 root로
      //    (modal-content는 본문 루트지만, 헤더/푸터를 포함하는 modal 컨테이너가 따로 있으면 그걸 택)
      for (var s = 0; s < scored.length; s++) {
        var cand = scored[s].el;
        if (cand !== best && cand.contains(best) && scored[s].score >= scored[0].score - 4) {
          best = cand;
        }
      }
      return best;
    };
    var fluxActiveRoot = function() {
      return fluxFindActiveModal() || document.body || document.documentElement;
    };
    var fluxQueryInScope = function(selector) {
      var modal = fluxFindActiveModal();
      if (modal) {
        var hit = modal.querySelector(selector);
        if (hit) return hit;
      }
      return document.querySelector(selector);
    };
    var fluxQueryAllInScope = function(selector) {
      var modal = fluxFindActiveModal();
      if (modal) {
        var inModal = [].slice.call(modal.querySelectorAll(selector));
        if (inModal.length > 0) return inModal;
      }
      return [].slice.call(document.querySelectorAll(selector));
    };
  `;
}
