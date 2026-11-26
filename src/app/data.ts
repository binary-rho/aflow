export type { DSL, DSLStep } from "@/services/llm";

export type ActionStatus = 'implemented' | 'missing' | 'deprecated';

export interface ActionDefinition {
  id: string;
  name: string;
  description: string;
  status: ActionStatus;
  params?: string[];
}

export type ExecutionStatus = 'idle' | 'running' | 'success' | 'failed' | 'skipped' | 'waiting';

export interface ScenarioStep {
  id: string;
  actionId: string; // References ActionDefinition
  params?: Record<string, any>;
  description?: string; // Optional override description
}

/** 후속 시나리오 체인 최대 길이 (순환 방지) */
export const SCENARIO_CHAIN_MAX = 8;

export interface Scenario {
  id: string;
  title: string;
  description: string;
  tags: string[];
  urlPattern: string;
  groupIds?: string[];
  steps: ScenarioStep[];
  createdAt: string;
  /** 이 시나리오 성공 직후, 같은 탭에서 이어서 실행할 시나리오 id (첫 nav.goto 생략) */
  followUpScenarioId?: string;
}

export interface ScenarioGroup {
  id: string;
  name: string;
}

// ---------------------------------------------------------------------------
// ACTION REGISTRY — 실제 서비스 레포에서 추출한 147개 + flux 내부 액션
// status: 'implemented' = actions/index.ts에 실행 함수가 있음
//         'missing'     = 정의만 있고 실행 함수 미구현
// ---------------------------------------------------------------------------

export const ACTION_REGISTRY: Record<string, ActionDefinition> = {
  // ── nav.* (17) ──────────────────────────────────────────────────────────
  'nav.goto':              { id: 'nav.goto', name: '페이지 이동', description: 'Vue Router를 통해 특정 경로로 이동합니다 ($router.push).', status: 'implemented', params: ['path', 'query', 'hash'] },
  'nav.replace':           { id: 'nav.replace', name: '페이지 교체', description: '현재 히스토리를 교체하며 이동합니다 ($router.replace).', status: 'missing', params: ['path', 'query'] },
  'nav.back':              { id: 'nav.back', name: '뒤로가기', description: '브라우저 히스토리에서 뒤로 이동합니다.', status: 'missing', params: [] },
  'nav.go':                { id: 'nav.go', name: '히스토리 이동', description: '히스토리 스택에서 지정된 만큼 앞/뒤로 이동합니다.', status: 'missing', params: ['delta'] },
  'nav.goLink':            { id: 'nav.goLink', name: '범용 링크 이동', description: 'LinkUtil.goLink를 통해 상대경로, 절대경로, tel:, 새창 등을 자동 분기합니다.', status: 'missing', params: ['linkUrl', 'isBlank'] },
  'nav.external':          { id: 'nav.external', name: '외부 URL 이동', description: 'window.location.href로 외부 URL로 이동합니다.', status: 'missing', params: ['url'] },
  'nav.open_new_window':   { id: 'nav.open_new_window', name: '새 창 열기', description: 'window.open으로 새 탭/창에서 URL을 엽니다.', status: 'missing', params: ['url', 'target'] },
  'nav.nuxt_link':         { id: 'nav.nuxt_link', name: 'NuxtLink 이동', description: '<nuxt-link>를 통한 선언적 라우터 이동입니다.', status: 'missing', params: ['to'] },
  'nav.redirect':          { id: 'nav.redirect', name: '미들웨어 리다이렉트', description: 'Nuxt 미들웨어에서 조건부 리다이렉트합니다.', status: 'missing', params: ['path', 'query'] },
  'nav.separated_service': { id: 'nav.separated_service', name: '분리 서비스 이동', description: '/about/, /benefit-event/ 등 분리 서비스 경로는 전체 페이지 이동합니다.', status: 'missing', params: ['path'] },
  'nav.reload':            { id: 'nav.reload', name: '페이지 새로고침', description: 'location.reload()로 현재 페이지를 새로고침합니다.', status: 'missing', params: [] },
  'nav.wait':              { id: 'nav.wait', name: '대기', description: '지정 시간(ms)만큼 대기합니다.', status: 'implemented', params: ['ms'] },
  'nav.app_open_browser':  { id: 'nav.app_open_browser', name: '앱 외부 브라우저 열기', description: 'AppBridge.pluginOpenBrowser로 외부 브라우저/웹뷰를 엽니다.', status: 'missing', params: ['url'] },
  'nav.app_open_popup_webview': { id: 'nav.app_open_popup_webview', name: '앱 팝업 웹뷰 열기', description: 'AppBridge.pluginOpenPopupWebview로 앱 내 팝업 웹뷰를 엽니다.', status: 'missing', params: ['requestCode', 'url'] },
  'nav.app_open_app':      { id: 'nav.app_open_app', name: '다른 앱 실행', description: 'AppBridge.pluginOpenApp으로 외부 앱을 실행합니다.', status: 'missing', params: ['packageName'] },
  'nav.app_open_dialer':   { id: 'nav.app_open_dialer', name: '전화 앱 열기', description: 'AppBridge.pluginOpenDialer로 전화 다이얼러를 엽니다.', status: 'missing', params: ['phoneNumber'] },
  'nav.app_deep_link':     { id: 'nav.app_deep_link', name: '딥링크 처리', description: '딥링크를 처리하여 앱 내 특정 화면으로 이동합니다.', status: 'missing', params: ['deepUrl'] },
  'nav.app_load_url':      { id: 'nav.app_load_url', name: '앱 URL 로드', description: 'AppBridge.pluginLoadUrl로 앱 웹뷰에서 URL을 직접 로드합니다.', status: 'missing', params: ['contextName', 'url'] },

  // ── auth.* (16) ─────────────────────────────────────────────────────────
  'auth.login':            { id: 'auth.login', name: '일반 로그인', description: 'ID/비밀번호로 로그인합니다.', status: 'missing', params: ['userId', 'password', 'loginType'] },
  'auth.logout':           { id: 'auth.logout', name: '로그아웃', description: '세션을 종료하고 로그아웃합니다.', status: 'missing', params: [] },
  'auth.sns_login':        { id: 'auth.sns_login', name: 'SNS 소셜 로그인', description: 'SNS 계정(카카오, 네이버 등)으로 로그인합니다.', status: 'missing', params: ['snsType', 'accessToken'] },
  'auth.app_login':        { id: 'auth.app_login', name: '앱 자동 로그인', description: '앱 환경에서 저장된 인증정보로 자동 로그인합니다.', status: 'missing', params: [] },
  'auth.app_lgid_login':   { id: 'auth.app_lgid_login', name: 'LG ID 로그인', description: 'AppBridge를 통해 LG ID로 로그인합니다.', status: 'missing', params: [] },
  'auth.simple_login':     { id: 'auth.simple_login', name: '간편 로그인', description: '간편 인증 후 로그인합니다.', status: 'missing', params: ['authData'] },
  'auth.second_login':     { id: 'auth.second_login', name: '2차 인증 로그인', description: '2차 인증(비밀번호 재확인)을 수행합니다.', status: 'missing', params: ['password'] },
  'auth.oauth2_login':     { id: 'auth.oauth2_login', name: 'OAuth2 로그인', description: 'OAuth2 프로토콜을 통한 로그인 및 세션 검증을 수행합니다.', status: 'missing', params: ['redirectUrl'] },
  'auth.signup':           { id: 'auth.signup', name: '회원가입', description: '회원가입을 수행합니다.', status: 'missing', params: [] },
  'auth.verify_real_name': { id: 'auth.verify_real_name', name: '실명 본인인증', description: '실명(KYC) 인증을 수행합니다.', status: 'missing', params: ['name', 'sid', 'phoneNumber', 'certType'] },
  'auth.phone_cert':       { id: 'auth.phone_cert', name: '휴대폰 본인인증', description: '휴대폰 인증번호 발송/확인을 통해 본인인증합니다.', status: 'missing', params: ['phoneNumber', 'certificationNumber'] },
  'auth.ipin_cert':        { id: 'auth.ipin_cert', name: 'IPIN 인증', description: 'IPIN 팝업을 열어 본인인증합니다.', status: 'missing', params: [] },
  'auth.password_confirm': { id: 'auth.password_confirm', name: '비밀번호 재확인', description: '중요 작업 전 비밀번호 재입력으로 본인확인합니다.', status: 'missing', params: ['password'] },
  'auth.password_change':  { id: 'auth.password_change', name: '비밀번호 변경', description: '비밀번호를 변경합니다.', status: 'missing', params: ['currentPassword', 'newPassword'] },
  'auth.create_o2o_session': { id: 'auth.create_o2o_session', name: 'O2O 세션 생성', description: '온라인-오프라인 연계 세션을 생성합니다.', status: 'missing', params: ['sessionParams'] },
  'auth.recaptcha':        { id: 'auth.recaptcha', name: 'reCAPTCHA 인증', description: '봇 방지 reCAPTCHA를 수행합니다.', status: 'missing', params: [] },
  'auth.biz_login':        { id: 'auth.biz_login', name: '기업 회원 로그인', description: '기업 계정으로 로그인합니다.', status: 'missing', params: ['userId', 'password'] },

  // ── button.* (19) ───────────────────────────────────────────────────────
  'button.click':          { id: 'button.click', name: '버튼 클릭', description: '텍스트, 셀렉터 또는 data 속성으로 버튼을 클릭합니다.', status: 'implemented', params: ['text', 'selector', 'context'] },
  'button.link_click':     { id: 'button.link_click', name: '링크 클릭', description: 'BxLink, nuxt-link, a 태그 등 링크를 클릭합니다.', status: 'missing', params: ['text', 'selector', 'href'] },
  'button.cta_click':      { id: 'button.cta_click', name: 'CTA 버튼 클릭', description: '페이지 하단 고정 CTA 버튼을 클릭합니다.', status: 'missing', params: ['text', 'selector'] },
  'button.dialog_confirm': { id: 'button.dialog_confirm', name: '다이얼로그 확인', description: 'BxDialog 모달에서 확인/예 버튼을 클릭합니다.', status: 'missing', params: [] },
  'button.dialog_cancel':  { id: 'button.dialog_cancel', name: '다이얼로그 취소', description: 'BxDialog 모달에서 취소/아니오 버튼을 클릭합니다.', status: 'missing', params: [] },
  'button.modal_close':    { id: 'button.modal_close', name: '모달 닫기 버튼', description: '모달/팝업/바텀시트의 닫기(X) 버튼을 클릭합니다.', status: 'missing', params: ['modalId'] },
  'button.popup_close':    { id: 'button.popup_close', name: '팝업 닫기', description: 'BxPopup, BxPopupPage의 닫기 버튼을 클릭합니다.', status: 'missing', params: ['selector'] },
  'button.share':          { id: 'button.share', name: '공유 버튼 클릭', description: '공유 팝업을 열어 URL을 공유합니다.', status: 'missing', params: [] },
  'button.copy_url':       { id: 'button.copy_url', name: 'URL 복사', description: '클립보드에 URL을 복사합니다.', status: 'missing', params: ['url'] },
  'button.download':       { id: 'button.download', name: '다운로드 버튼', description: '파일을 다운로드합니다.', status: 'missing', params: ['fileUrl', 'fileName'] },
  'button.print':          { id: 'button.print', name: '인쇄 버튼', description: '현재 페이지/영수증을 인쇄합니다.', status: 'missing', params: [] },
  'button.refresh':        { id: 'button.refresh', name: '새로고침 버튼', description: '특정 데이터나 페이지를 새로고침합니다.', status: 'missing', params: [] },
  'button.gnb_menu':       { id: 'button.gnb_menu', name: 'GNB 메뉴 열기', description: '헤더의 전체메뉴(햄버거) 버튼을 클릭하여 사이드바를 엽니다.', status: 'missing', params: [] },
  'button.gnb_search':     { id: 'button.gnb_search', name: 'GNB 검색 버튼', description: '헤더의 검색 아이콘을 클릭합니다.', status: 'missing', params: [] },
  'button.gnb_cart':       { id: 'button.gnb_cart', name: 'GNB 장바구니', description: '헤더의 장바구니 아이콘을 클릭하여 /cart로 이동합니다.', status: 'missing', params: [] },
  'button.lnb_menu':       { id: 'button.lnb_menu', name: 'LNB 메뉴 클릭', description: '마이페이지 등 좌측 메뉴의 항목을 클릭합니다.', status: 'missing', params: ['menuIndex', 'subMenuIndex'] },
  'button.radio_select':   { id: 'button.radio_select', name: '라디오 버튼 클릭', description: 'BxRadio/BxRadioGroup에서 라디오 옵션을 선택합니다.', status: 'missing', params: ['value', 'groupName'] },
  'button.quit_confirm':   { id: 'button.quit_confirm', name: '중단 확인 클릭', description: '가입/결제 등 프로세스 중단 확인 팝업에서 확인을 클릭합니다.', status: 'missing', params: [] },
  'button.banner_click':   { id: 'button.banner_click', name: '배너 클릭', description: '배너 이미지/텍스트를 클릭하여 링크로 이동합니다.', status: 'missing', params: ['bannerIndex', 'linkUrl'] },
  'gnb.clickLogin':        { id: 'gnb.clickLogin', name: 'GNB 로그인 클릭', description: '헤더/GNB에 있는 로그인 버튼만 클릭합니다.', status: 'implemented', params: [] },

  // ── form.* (20) ─────────────────────────────────────────────────────────
  'form.fill':             { id: 'form.fill', name: '폼 입력 (범용)', description: '텍스트 입력 필드에 값을 입력합니다.', status: 'implemented', params: ['label', 'value', 'selector', 'context'] },
  'form.input_text':       { id: 'form.input_text', name: '텍스트 입력', description: 'v-model 바인딩된 텍스트 입력 필드에 값을 입력합니다.', status: 'implemented', params: ['selector', 'value', 'label'] },
  'form.input_password':   { id: 'form.input_password', name: '비밀번호 입력', description: '비밀번호 필드에 값을 입력합니다.', status: 'missing', params: ['selector', 'value'] },
  'form.input_number':     { id: 'form.input_number', name: '숫자 입력', description: '숫자만 입력 가능한 필드에 값을 입력합니다.', status: 'missing', params: ['selector', 'value'] },
  'form.input_email':      { id: 'form.input_email', name: '이메일 입력', description: '이메일 필드(아이디 + 도메인)에 값을 입력합니다.', status: 'missing', params: ['emailId', 'emailDomain'] },
  'form.input_phone':      { id: 'form.input_phone', name: '전화번호 입력', description: '전화번호 입력 필드에 값을 입력합니다.', status: 'missing', params: ['phoneNumber'] },
  'form.search':           { id: 'form.search', name: '검색어 입력', description: '검색 컴포넌트에 검색어를 입력하고 검색합니다.', status: 'missing', params: ['keyword'] },
  'form.input_clear':      { id: 'form.input_clear', name: '입력값 삭제', description: '입력 필드의 삭제(X) 버튼을 클릭하여 값을 초기화합니다.', status: 'missing', params: ['selector'] },
  'form.check':            { id: 'form.check', name: '체크박스/라디오 토글', description: '체크박스 또는 라디오를 클릭합니다. clickOnly:true면 목표 상태 없이 한 번 클릭(토글), 아니면 checked로 목표 on/off를 맞춥니다.', status: 'implemented', params: ['label', 'selector', 'context', 'clickOnly', 'checked'] },
  'form.checkbox_check':   { id: 'form.checkbox_check', name: '체크박스 선택/해제', description: '체크박스의 체크 상태를 변경합니다.', status: 'implemented', params: ['selector', 'label', 'checked'] },
  'form.checkbox_all':     { id: 'form.checkbox_all', name: '전체 선택/해제', description: '전체 동의, 전체 선택 체크박스를 토글합니다.', status: 'missing', params: ['selector', 'checked'] },
  'form.radio_select':     { id: 'form.radio_select', name: '라디오 버튼 선택', description: '라디오 그룹에서 옵션을 선택합니다.', status: 'implemented', params: ['name', 'value'] },
  'form.toggle_switch':    { id: 'form.toggle_switch', name: '토글 스위치 전환', description: '토글 ON/OFF 상태를 전환합니다.', status: 'missing', params: ['selector', 'value'] },
  'form.select':           { id: 'form.select', name: '드롭다운 선택', description: 'select 요소에서 옵션을 선택합니다.', status: 'implemented', params: ['label', 'value', 'optionText', 'selector', 'context'] },
  'form.select_dropdown':  { id: 'form.select_dropdown', name: '커스텀 드롭다운 선택', description: '커스텀 드롭다운(div/button 기반)에서 옵션을 선택합니다.', status: 'implemented', params: ['label', 'selector', 'optionText', 'context'] },
  'form.datepicker_select': { id: 'form.datepicker_select', name: '날짜 선택', description: '날짜 선택기에서 날짜를 선택합니다.', status: 'missing', params: ['selector', 'date'] },
  'form.file_upload':      { id: 'form.file_upload', name: '파일 업로드', description: 'input[type=file]로 파일을 첨부합니다.', status: 'missing', params: ['selector', 'filePath', 'maxCount'] },
  'form.file_delete':      { id: 'form.file_delete', name: '첨부파일 삭제', description: '업로드된 파일을 삭제합니다.', status: 'missing', params: ['selector', 'fileIndex'] },
  'form.submit':           { id: 'form.submit', name: '폼 제출', description: '폼 유효성 검사 후 제출합니다.', status: 'missing', params: ['formSelector'] },
  'form.validate':         { id: 'form.validate', name: '폼 유효성 검사', description: '폼 필드의 유효성을 검사합니다.', status: 'missing', params: ['formSelector'] },
  'form.find_address':     { id: 'form.find_address', name: '주소 검색/선택', description: '주소를 검색하고 선택합니다.', status: 'missing', params: ['keyword'] },
  'form.terms_agree':      { id: 'form.terms_agree', name: '약관 동의', description: '약관 동의 체크박스를 선택합니다.', status: 'missing', params: ['termId', 'agreed'] },
  'form.terms_agree_all':  { id: 'form.terms_agree_all', name: '약관 전체 동의', description: '모든 약관에 전체 동의합니다.', status: 'missing', params: ['agreed'] },

  // ── interaction.* (21) ──────────────────────────────────────────────────
  'interaction.hover':     { id: 'interaction.hover', name: '호버', description: '요소에 마우스를 올려 호버 효과를 트리거합니다.', status: 'implemented', params: ['text', 'selector', 'context'] },
  'interaction.modal_open':    { id: 'interaction.modal_open', name: '모달 열기', description: '모달/팝업을 엽니다.', status: 'missing', params: ['modalId', 'type'] },
  'interaction.modal_close':   { id: 'interaction.modal_close', name: '모달 닫기', description: '열린 모달/팝업을 닫습니다.', status: 'missing', params: ['modalId'] },
  'interaction.bottomsheet_open':  { id: 'interaction.bottomsheet_open', name: '바텀시트 열기', description: '하단에서 올라오는 시트를 표시합니다.', status: 'missing', params: ['sheetId'] },
  'interaction.bottomsheet_close': { id: 'interaction.bottomsheet_close', name: '바텀시트 닫기', description: '열린 바텀시트를 닫습니다.', status: 'missing', params: ['sheetId'] },
  'interaction.popup_page_open':   { id: 'interaction.popup_page_open', name: '풀스크린 팝업 열기', description: '전체화면 팝업 페이지를 엽니다.', status: 'missing', params: ['popupId'] },
  'interaction.dialog_alert':  { id: 'interaction.dialog_alert', name: '알림 다이얼로그 표시', description: '알림/에러 메시지 다이얼로그를 표시합니다.', status: 'missing', params: ['message', 'type'] },
  'interaction.toast_show':    { id: 'interaction.toast_show', name: '토스트 메시지 표시', description: '하단 토스트 알림을 표시합니다.', status: 'missing', params: ['message'] },
  'interaction.accordion_toggle': { id: 'interaction.accordion_toggle', name: '아코디언 열기/닫기', description: '아코디언 섹션을 열거나 닫습니다.', status: 'missing', params: ['accordionId', 'expanded'] },
  'interaction.tab_switch':    { id: 'interaction.tab_switch', name: '탭 전환', description: '탭을 전환합니다.', status: 'missing', params: ['tabIndex', 'tabId'] },
  'interaction.tooltip_toggle': { id: 'interaction.tooltip_toggle', name: '툴팁 토글', description: '툴팁을 표시하거나 숨깁니다.', status: 'missing', params: ['selector'] },
  'interaction.dropdown_toggle': { id: 'interaction.dropdown_toggle', name: '드롭다운 메뉴 토글', description: '드롭다운을 열거나 닫습니다.', status: 'missing', params: ['selector'] },
  'interaction.dropdown_select': { id: 'interaction.dropdown_select', name: '드롭다운 항목 선택', description: '열린 드롭다운에서 특정 항목을 선택합니다.', status: 'missing', params: ['selector', 'itemValue', 'itemText'] },
  'interaction.drag':          { id: 'interaction.drag', name: '드래그', description: '모달 드래그로 요소를 이동합니다.', status: 'missing', params: ['selector', 'offsetX', 'offsetY'] },
  'interaction.swipe':         { id: 'interaction.swipe', name: '스와이프', description: '터치 스와이프로 캐러셀/슬라이더를 조작합니다.', status: 'missing', params: ['selector', 'direction'] },
  'interaction.pull_to_refresh': { id: 'interaction.pull_to_refresh', name: '풀투리프레시', description: '아래로 당겨 새로고침합니다.', status: 'missing', params: [] },
  'interaction.carousel_slide':  { id: 'interaction.carousel_slide', name: '캐러셀 슬라이드', description: '배너/상품 캐러셀에서 좌우로 슬라이드합니다.', status: 'missing', params: ['selector', 'direction', 'slideIndex'] },
  'interaction.rotate_gesture':  { id: 'interaction.rotate_gesture', name: '회전 제스처', description: '터치로 360도 회전을 조작합니다.', status: 'missing', params: ['selector', 'angle'] },
  'interaction.sidebar_open':    { id: 'interaction.sidebar_open', name: '사이드바 열기', description: 'GNB 사이드바를 엽니다.', status: 'missing', params: ['type'] },
  'interaction.sidebar_close':   { id: 'interaction.sidebar_close', name: '사이드바 닫기', description: '열린 GNB 사이드바를 닫습니다.', status: 'missing', params: [] },
  'interaction.notice_popup':    { id: 'interaction.notice_popup', name: '공지 팝업 표시', description: '공지사항 팝업을 표시합니다.', status: 'missing', params: ['popupId'] },

  // ── keyboard.* (7) ──────────────────────────────────────────────────────
  'keyboard.press':        { id: 'keyboard.press', name: '키보드 입력 (범용)', description: '지정한 키를 입력합니다.', status: 'implemented', params: ['key', 'selector'] },
  'keyboard.enter':        { id: 'keyboard.enter', name: 'Enter 키 입력', description: 'Enter 키를 눌러 폼 제출, 검색 실행 등을 트리거합니다.', status: 'implemented', params: ['selector'] },
  'keyboard.escape':       { id: 'keyboard.escape', name: 'Escape 키 입력', description: 'Escape 키를 눌러 모달/팝업을 닫습니다.', status: 'implemented', params: [] },
  'keyboard.arrow_up':     { id: 'keyboard.arrow_up', name: '위 화살표 키', description: '드롭다운 목록에서 위쪽 항목으로 이동합니다.', status: 'missing', params: ['selector'] },
  'keyboard.arrow_down':   { id: 'keyboard.arrow_down', name: '아래 화살표 키', description: '드롭다운 목록에서 아래쪽 항목으로 이동합니다.', status: 'missing', params: ['selector'] },
  'keyboard.tab':          { id: 'keyboard.tab', name: 'Tab 키 입력', description: 'Tab 키로 다음 포커스 요소로 이동합니다.', status: 'implemented', params: [] },
  'keyboard.keydown':      { id: 'keyboard.keydown', name: '키 다운 이벤트', description: '특정 키의 keydown 이벤트를 발생시킵니다.', status: 'implemented', params: ['selector', 'key', 'keyCode'] },
  'keyboard.keyup':        { id: 'keyboard.keyup', name: '키 업 이벤트', description: '특정 키의 keyup 이벤트를 발생시킵니다.', status: 'missing', params: ['selector', 'key', 'keyCode'] },

  // ── scroll.* (6) ────────────────────────────────────────────────────────
  'scroll.to':             { id: 'scroll.to', name: '절대 위치 스크롤', description: '지정한 y 위치로 스크롤합니다.', status: 'implemented', params: ['y', 'x'] },
  'scroll.to_top':         { id: 'scroll.to_top', name: '최상단 스크롤', description: '페이지 최상단으로 스크롤합니다.', status: 'missing', params: [] },
  'scroll.to_section':     { id: 'scroll.to_section', name: '섹션으로 스크롤', description: '특정 섹션/요소로 스크롤합니다.', status: 'missing', params: ['selector', 'refName', 'behavior'] },
  'scroll.to_element':     { id: 'scroll.to_element', name: '요소로 스크롤', description: '특정 DOM 요소가 보일 때까지 스크롤합니다.', status: 'missing', params: ['selector'] },
  'scroll.by':             { id: 'scroll.by', name: '상대 스크롤', description: '현재 위치에서 delta만큼 스크롤. 가로만(deltaX)이면 탭바 등 가로 스크롤 영역을 자동 탐색.', status: 'implemented', params: ['deltaX', 'deltaY', 'selector'] },
  'scroll.page':           { id: 'scroll.page', name: '페이지 스크롤', description: '페이지를 특정 방향/량만큼 스크롤합니다.', status: 'missing', params: ['direction', 'amount'] },
  'scroll.pagination':     { id: 'scroll.pagination', name: '페이지네이션 이동', description: '특정 페이지 번호를 클릭합니다.', status: 'missing', params: ['pageNo'] },
  'scroll.tab_center':     { id: 'scroll.tab_center', name: '탭 중앙 스크롤', description: '선택된 탭이 가운데로 오도록 가로 스크롤합니다.', status: 'missing', params: ['tabIndex'] },

  // ── assert.* (17) ───────────────────────────────────────────────────────
  'assert.visible':        { id: 'assert.visible', name: '요소 표시 확인 (레거시)', description: '요소가 표시되는지 확인합니다.', status: 'implemented', params: ['selector', 'text'] },
  'assert.hidden':         { id: 'assert.hidden', name: '요소 숨김 확인 (레거시)', description: '요소가 숨겨져 있는지 확인합니다.', status: 'implemented', params: ['selector', 'text'] },
  'assert.text':           { id: 'assert.text', name: '텍스트 확인 (레거시)', description: '요소의 텍스트를 확인합니다.', status: 'implemented', params: ['selector', 'expected'] },
  'assert.elementHidden':  { id: 'assert.elementHidden', name: '요소 숨김 확인', description: '요소가 화면에 숨겨져 있는지 확인합니다.', status: 'implemented', params: ['selector', 'text'] },
  'assert.element_exists': { id: 'assert.element_exists', name: '요소 존재 확인', description: '특정 셀렉터/텍스트의 요소가 DOM에 존재하는지 확인합니다.', status: 'missing', params: ['selector', 'text'] },
  'assert.element_not_exists': { id: 'assert.element_not_exists', name: '요소 미존재 확인', description: '특정 요소가 DOM에 존재하지 않는지 확인합니다.', status: 'missing', params: ['selector', 'text'] },
  'assert.element_visible': { id: 'assert.element_visible', name: '요소 가시성 확인', description: '요소가 화면에 보이는지 확인합니다.', status: 'implemented', params: ['selector'] },
  'assert.element_hidden': { id: 'assert.element_hidden', name: '요소 숨김 확인', description: '요소가 화면에 숨겨져 있는지 확인합니다.', status: 'implemented', params: ['selector'] },
  'assert.text_content':   { id: 'assert.text_content', name: '텍스트 내용 확인', description: '요소의 텍스트 내용이 기대값과 일치하는지 확인합니다.', status: 'implemented', params: ['selector', 'expectedText', 'exact'] },
  'assert.text_contains':  { id: 'assert.text_contains', name: '텍스트 포함 확인', description: '요소의 텍스트에 특정 문자열이 포함되어 있는지 확인합니다.', status: 'missing', params: ['selector', 'containsText'] },
  'assert.input_value':    { id: 'assert.input_value', name: '입력값 확인', description: '입력 필드의 값이 기대값과 일치하는지 확인합니다.', status: 'missing', params: ['selector', 'expectedValue'] },
  'assert.checkbox_checked': { id: 'assert.checkbox_checked', name: '체크박스 상태 확인', description: '체크박스의 선택/해제 상태를 확인합니다.', status: 'missing', params: ['selector', 'checked'] },
  'assert.url':            { id: 'assert.url', name: 'URL 확인', description: '현재 페이지 URL이 기대 경로와 일치하는지 확인하고, 필요 시 쿼리도 비교합니다.', status: 'implemented', params: ['expectedPath', 'expectedQuery'] },
  'assert.toast':          { id: 'assert.toast', name: '토스트 메시지 확인', description: '토스트 알림이 표시되었고 메시지 내용이 일치하는지 확인합니다.', status: 'missing', params: ['expectedMessage'] },
  'assert.dialog':         { id: 'assert.dialog', name: '다이얼로그 확인', description: '다이얼로그가 표시되었고 내용이 일치하는지 확인합니다.', status: 'missing', params: ['expectedMessage', 'dialogType'] },
  'assert.modal_open':     { id: 'assert.modal_open', name: '모달 열림 확인', description: '특정 모달/팝업이 열려 있는지 확인합니다.', status: 'missing', params: ['modalId'] },
  'assert.modal_closed':   { id: 'assert.modal_closed', name: '모달 닫힘 확인', description: '특정 모달/팝업이 닫혀 있는지 확인합니다.', status: 'missing', params: ['modalId'] },
  'assert.login_status':   { id: 'assert.login_status', name: '로그인 상태 확인', description: '사용자의 로그인/비로그인 상태를 확인합니다.', status: 'missing', params: ['expectedStatus'] },
  'assert.disabled':       { id: 'assert.disabled', name: '비활성화 상태 확인', description: '버튼/입력 요소의 disabled 상태를 확인합니다.', status: 'missing', params: ['selector', 'disabled'] },
  'assert.loading':        { id: 'assert.loading', name: '로딩 상태 확인', description: '로딩 인디케이터의 표시/숨김 상태를 확인합니다.', status: 'missing', params: ['visible'] },
  'assert.error_message':  { id: 'assert.error_message', name: '에러 메시지 확인', description: '에러 메시지가 표시되었는지 확인합니다.', status: 'missing', params: ['selector', 'expectedMessage'] },

  // ── service.* (26) ──────────────────────────────────────────────────────
  'service.payment_select_method': { id: 'service.payment_select_method', name: '결제 수단 선택', description: '결제 방법(신용카드, 네이버페이, 카카오페이 등)을 선택합니다.', status: 'missing', params: ['paymentMethod'] },
  'service.payment_submit':    { id: 'service.payment_submit', name: '결제 실행', description: '선택된 결제 수단으로 결제를 실행합니다.', status: 'missing', params: ['paymentMethod', 'amount'] },
  'service.payment_cancel':    { id: 'service.payment_cancel', name: '결제 취소', description: '진행 중인 결제를 취소합니다.', status: 'missing', params: [] },
  'service.signup_step_next':  { id: 'service.signup_step_next', name: '가입 다음 단계', description: '가입 프로세스에서 다음 단계로 진행합니다.', status: 'missing', params: ['currentStep'] },
  'service.signup_step_back':  { id: 'service.signup_step_back', name: '가입 이전 단계', description: '가입 프로세스에서 이전 단계로 돌아갑니다.', status: 'missing', params: ['currentStep'] },
  'service.signup_quit':       { id: 'service.signup_quit', name: '가입 중단', description: '가입 프로세스를 중단합니다.', status: 'missing', params: [] },
  'service.signup_complete':   { id: 'service.signup_complete', name: '가입 완료', description: '가입 프로세스를 완료합니다.', status: 'missing', params: [] },
  'service.cart_add':          { id: 'service.cart_add', name: '장바구니 추가', description: '상품을 장바구니에 추가합니다.', status: 'missing', params: ['productId', 'productType'] },
  'service.cart_delete':       { id: 'service.cart_delete', name: '장바구니 삭제', description: '장바구니에서 상품을 삭제합니다.', status: 'missing', params: ['basketNo'] },
  'service.order_submit':      { id: 'service.order_submit', name: '주문 제출', description: '주문을 제출합니다.', status: 'missing', params: ['orderData'] },
  'service.preorder_reserve':  { id: 'service.preorder_reserve', name: '사전예약 신청', description: '사전예약 상품을 예약합니다.', status: 'missing', params: ['productId', 'reservationData'] },
  'service.addon_subscribe':   { id: 'service.addon_subscribe', name: '부가서비스 가입', description: '부가서비스/패스를 가입합니다.', status: 'missing', params: ['serviceCode'] },
  'service.addon_unsubscribe': { id: 'service.addon_unsubscribe', name: '부가서비스 해지', description: '가입된 부가서비스를 해지합니다.', status: 'missing', params: ['serviceCode'] },
  'service.consultation_submit': { id: 'service.consultation_submit', name: '상담 신청', description: '전화/온라인 상담을 신청합니다.', status: 'missing', params: ['consultType', 'formData'] },
  'service.inquiry_submit':    { id: 'service.inquiry_submit', name: '문의 등록', description: '온라인 1:1 문의를 등록합니다.', status: 'missing', params: ['subject', 'content', 'attachments'] },
  'service.feedback_submit':   { id: 'service.feedback_submit', name: '피드백 제출', description: '서비스 피드백을 제출합니다.', status: 'missing', params: ['content', 'attachments'] },
  'service.data_charge':       { id: 'service.data_charge', name: '데이터 충전', description: '데이터 충전을 신청합니다.', status: 'missing', params: ['chargeType', 'amount'] },
  'service.data_gift':         { id: 'service.data_gift', name: '데이터 선물', description: '다른 사용자에게 데이터를 선물합니다.', status: 'missing', params: ['recipientPhone', 'amount'] },
  'service.recontract':        { id: 'service.recontract', name: '약정갱신 신청', description: '인터넷/IPTV 약정갱신을 신청합니다.', status: 'missing', params: ['formData'] },
  'service.number_transfer':   { id: 'service.number_transfer', name: '번호이동', description: '타 통신사에서 번호이동 가입합니다.', status: 'missing', params: ['phoneNumber', 'carrierInfo'] },
  'service.wish_number':       { id: 'service.wish_number', name: '희망번호 선택', description: '가입 시 희망 번호를 선택합니다.', status: 'missing', params: ['wishNumber'] },
  'service.lost_device':       { id: 'service.lost_device', name: '분실기기 신고', description: '분실/도난 기기를 신고합니다.', status: 'missing', params: ['deviceInfo'] },
  'service.coupon_download':   { id: 'service.coupon_download', name: '쿠폰 다운로드', description: '이벤트/멤버십 쿠폰을 다운로드합니다.', status: 'missing', params: ['couponId'] },
  'service.membership_card':   { id: 'service.membership_card', name: '멤버십 카드 조회', description: '멤버십 카드/등급 정보를 조회합니다.', status: 'missing', params: [] },
  'service.notification_read': { id: 'service.notification_read', name: '알림 읽음 처리', description: '알림함에서 알림을 읽음 처리합니다.', status: 'missing', params: ['notificationId'] },
  'service.notification_read_all': { id: 'service.notification_read_all', name: '알림 전체 읽음', description: '모든 알림을 읽음 처리합니다.', status: 'missing', params: [] },
  'service.app_chatbot':       { id: 'service.app_chatbot', name: '챗봇 열기', description: '챗봇을 엽니다.', status: 'missing', params: ['url'] },
  'service.app_notification_setting': { id: 'service.app_notification_setting', name: '알림 설정 열기', description: '기기 알림 설정을 엽니다.', status: 'missing', params: [] },
  'service.excel_upload':      { id: 'service.excel_upload', name: '엑셀 파일 업로드', description: '엑셀 파일을 업로드하여 대량 데이터를 처리합니다.', status: 'missing', params: ['filePath'] },
  'service.roaming_signup':    { id: 'service.roaming_signup', name: '로밍 서비스 가입', description: '로밍 요금제/부가서비스에 가입합니다.', status: 'missing', params: ['planCode'] },
  'service.product_line_switch': { id: 'service.product_line_switch', name: '회선 전환', description: '다른 회선(번호)으로 전환하여 마이페이지를 조회합니다.', status: 'missing', params: ['lineId'] },
};

export const MOCK_SCENARIOS: Scenario[] = [
  {
    id: 'sc_preorder_std',
    title: '신규 기기 사전 예약 (표준)',
    description: '메인 랜딩 페이지에서 시작하여 사전 예약까지 완료하는 표준 흐름입니다.',
    tags: ['주문', '핵심'],
    urlPattern: 'flux.app/products/*',
    createdAt: '2023-10-25',
    steps: [
      { id: 's1', actionId: 'nav.goto', params: { url: '/products/new-device' } },
      { id: 's2', actionId: 'auth.login', params: { role: 'standard_user' } },
      { id: 's3', actionId: 'order.startPreorder' },
      { id: 's4', actionId: 'kyc.verifyIdentity', description: '신원확인 진행 (신분증+안면인증)' },
      { id: 's5', actionId: 'payment.addCard' },
      { id: 's6', actionId: 'order.submit' },
    ],
  },
  {
    id: 'sc_guest_checkout',
    title: '비회원 주문 (게스트)',
    description: '로그인 없이 장바구니에서 바로 주문하는 흐름입니다.',
    tags: ['주문', '게스트'],
    urlPattern: 'flux.app/cart',
    createdAt: '2023-10-26',
    steps: [
      { id: 's1', actionId: 'nav.goto', params: { url: '/cart' } },
      { id: 's2', actionId: 'order.startPreorder' },
      { id: 's3', actionId: 'payment.addCard' },
    ],
  },
  {
    id: 'sc_admin',
    title: '관리자 대시보드 진입',
    description: '어드민 계정으로 로그인 후 통계 페이지 확인',
    tags: ['관리자', '모니터링'],
    urlPattern: 'flux.app/admin',
    createdAt: '2023-10-27',
    steps: [
      { id: 's1', actionId: 'nav.goto', params: { url: '/admin' } },
      { id: 's2', actionId: 'auth.login', params: { role: 'admin' } },
    ],
  },
];
