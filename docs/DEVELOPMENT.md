# flux - 개발 문서

## 1. 프로젝트 개요

flux는 DRR(Design Review Request) 문서를 실행 가능한 시나리오로 변환하고, Chrome DevTools Protocol(CDP)을 통해 브라우저에서 자동 실행하는 Chrome 확장 프로그램입니다.

### 핵심 기능

- **DRR-to-DSL 변환**: 자연어 시나리오 입력을 LLM(GPT-4o-mini)으로 구조화된 DSL로 변환
- **시나리오 자동 실행**: CDP를 통해 검사 중인 탭에서 클릭, 입력, 네비게이션 등을 자동 수행
- **직접 생성 (녹화)**: 사용자의 실제 브라우저 조작을 캡처하여 시나리오로 변환
- **검증 모드**: 실제 클릭/입력 없이 각 스텝의 요소 존재 여부만 순차 검증
- **화면 녹화**: 시나리오 실행 중 검사 탭의 화면을 녹화하여 파일로 저장

### 기술 스택

| 구분 | 기술 |
|------|------|
| 런타임/빌드 | Vite 6, TypeScript |
| UI | React 18, Tailwind CSS 4, Radix UI |
| 라우팅 | react-router 7 |
| 아이콘 | lucide-react |
| LLM | OpenAI API (gpt-4o-mini) |
| 브라우저 자동화 | Chrome DevTools Protocol (chrome.debugger) |
| 상태 저장 | localStorage |

---

## 2. 아키텍처

### 2.1 디렉터리 구조

```
src/
├── actions/              # 실행 가능한 액션 구현체
│   ├── index.ts          # 액션 레지스트리 (이름 -> 함수 매핑)
│   ├── navigation.ts     # nav.goto, nav.wait, scroll.to
│   ├── interaction.ts    # button.click, form.fill, form.check, hover, keypress
│   ├── auth.ts           # auth.login, auth.signup
│   └── assertion.ts      # assert.visible, assert.hidden, assert.text
├── engine/               # 핵심 엔진
│   ├── cdp.ts            # Chrome DevTools Protocol 래퍼
│   ├── runner.ts          # 시나리오 실행 엔진 (스텝 순차 실행, 새 탭 전환)
│   ├── recorder.ts       # 사용자 조작 녹화 (이벤트 수집, 스크립트 주입)
│   └── actionRegistry.ts # 액션 실행 위임
├── services/             # 외부 서비스 연동
│   ├── llm.ts            # OpenAI API 호출, DRR->DSL 변환 프롬프트
│   ├── domSnapshot.ts    # 페이지 DOM 요약 수집 스크립트
│   └── domMatcher.ts     # DOM 요소 텍스트 매칭 (한영 동의어 포함)
├── stores/               # localStorage 기반 저장소
│   ├── scenarioStore.ts  # 시나리오 CRUD
│   ├── groupsStore.ts    # 시나리오 그룹 관리
│   ├── settingsStore.ts  # API 키, 속도 프리셋
│   ├── domCacheStore.ts  # 방문 페이지 DOM 캐시
│   └── domCaptureStore.ts # 실행 중 DOM 캡처
├── app/                  # UI 레이어
│   ├── pages/
│   │   ├── ScenarioList.tsx   # 메인: 시나리오 목록, DRR 입력, 녹화
│   │   ├── ScenarioRunner.tsx # 시나리오 실행 화면
│   │   └── ActionRegistry.tsx # 액션 도감
│   └── components/
│       ├── Layout.tsx         # 헤더 (아이콘 + 로고)
│       ├── ScenarioCard.tsx   # 시나리오 카드 (검증 버튼 포함)
│       ├── DrrInputBox.tsx    # DRR 입력 + 토큰 칩 UI
│       ├── DrrResultView.tsx  # 변환 결과 DSL 뷰
│       └── SettingsModal.tsx  # API 키 설정
├── background.ts         # Service Worker (시나리오 실행/녹화 메시지 핸들링)
└── hooks/
    └── useInspectedTabUrl.ts  # 검사 탭 URL 실시간 추적
```

### 2.2 데이터 흐름

```
[사용자 입력]
    |
    v
DRR 텍스트 + 토큰 칩 ──> LLM (llm.ts) ──> DSL (JSON)
    |                                          |
    v                                          v
직접 생성 (recorder.ts)              시나리오 저장 (scenarioStore)
    |                                          |
    v                                          v
RecordedEvent[] ──> background.ts ──>   시나리오 실행 (runner.ts)
                    시나리오 변환              |
                                              v
                                    CDP (cdp.ts) ──> 브라우저 탭
```

### 2.3 메시지 프로토콜 (DevTools Panel <-> Service Worker)

| 메시지 타입 | 방향 | 설명 |
|------------|------|------|
| `RUN_SCENARIO` | Panel -> SW | 시나리오 실행 요청 |
| `RUNNER_STATUS` | SW -> Panel | 실행 상태 브로드캐스트 |
| `START_RECORDING` | Panel -> SW | 녹화 시작 |
| `STOP_RECORDING` | Panel -> SW | 녹화 종료 + 시나리오 반환 |
| `PAUSE` / `RESUME` / `CANCEL` | Panel -> SW | 실행 제어 |

---

## 3. 액션 레지스트리

시나리오의 각 스텝은 액션 레지스트리에 등록된 함수를 호출합니다.

### 3.1 레지스트리 현황

실제 서비스 레포(Nuxt 2 + Vue 2 + Bootstrap-Vue, ~1,253 라우트)에서 추출한 **147개** 액션을 9개 카테고리로 정리했습니다.

| 카테고리 | 전체 | 구현됨 | 주요 소스 |
|----------|------|--------|-----------|
| `nav.*` | 18 | 2 | LinkUtil, $router, AppBridge, 미들웨어 |
| `auth.*` | 17 | 2 | LoginUtil, AppLoginUtil, verifyRealName, OAuth2 |
| `button.*` | 20 | 5 | BxButton, BxLink, BxDialog, GNB/LNB |
| `form.*` | 23 | 7 | BxInput*, BxDatePicker, BxFile, VeeValidate |
| `interaction.*` | 21 | 1 | BxDialog, BxBottomSheet, bx-accordion, bx-tab, Swiper |
| `keyboard.*` | 8 | 5 | @keyup.enter, @keydown, @keypress |
| `scroll.*` | 7 | 1 | scrollTo, bx-pagination, scrollToSection |
| `assert.*` | 21 | 7 | 자동화 테스트용 검증 액션 |
| `service.*` | 29 | 0 | 결제, 가입, 장바구니, 상담, 데이터, 로밍 등 |
| **합계** | **164** | **30** | |

구현된 액션 중 일부는 에일리어스(동일 구현체를 다른 ID로 매핑)입니다.
예: `form.input_text` -> `form.fill` 구현체 재사용, `keyboard.enter` -> `keyboard.press` 구현체 재사용.

### 3.2 에일리어스 매핑

기존 구현체로 처리 가능한 새 ID들은 `actions/index.ts`에서 동일 함수로 매핑됩니다:

| 새 ID | 매핑 대상 | 구현체 |
|-------|----------|--------|
| `button.link_click`, `button.cta_click`, `button.banner_click` | `button.click` | `clickButtonAction` |
| `form.input_text`, `form.input_password`, `form.input_number` | `form.fill` | `fillFormAction` |
| `form.checkbox_check`, `form.radio_select` | `form.check` | `checkAction` |
| `form.select_dropdown` | `form.select` | `selectOptionAction` |
| `keyboard.enter`, `keyboard.escape`, `keyboard.tab`, `keyboard.keydown` | `keyboard.press` | `keypressAction` |
| `assert.element_visible` | `assert.visible` | `assertVisibleAction` |
| `assert.element_hidden` | `assert.hidden` | `assertHiddenAction` |
| `assert.text_content` | `assert.text` | `assertTextAction` |

### 3.3 액션 구현 확장 방법

1. `src/app/data.ts`의 `ACTION_REGISTRY`에서 `status: 'missing'`인 액션 확인
2. `src/actions/` 하위에 실행 함수 구현
3. `src/actions/index.ts`의 `registry` 객체에 매핑 등록
4. 필요 시 `src/engine/cdp.ts`에 CDP 래퍼 함수 추가
5. `data.ts`에서 해당 액션의 `status`를 `'implemented'`로 변경

---

## 4. 녹화 시스템 (직접 생성)

### 4.1 동작 원리

1. **시작**: CDP로 대상 탭에 attach, `Runtime.addBinding`으로 이벤트 전송 채널 생성
2. **스크립트 주입**: `INJECT_SCRIPT`를 페이지에 주입하여 DOM 이벤트 리스너 등록
3. **이벤트 수집**: 사용자 조작을 실시간으로 Service Worker에 전달
4. **페이지 전환 대응**: `Page.frameNavigated` 이벤트 시 스크립트 재주입
5. **새 탭 대응**: `chrome.tabs.onCreated`로 새 탭 감지, 자동으로 attach + 스크립트 주입
6. **종료**: 수집된 이벤트를 시나리오 스텝으로 변환

### 4.2 수집하는 이벤트

| 이벤트 | 트리거 | 변환 액션 |
|--------|--------|----------|
| `click` | 버튼, 링크, 탭, 메뉴아이템, summary 등 클릭 | `button.click` |
| `check` | 체크박스/라디오 클릭 (label 포함) | `form.check` |
| `input` | 텍스트 입력 필드 change | `form.fill` |
| `select` | `<select>` 드롭다운 옵션 선택 | `form.select` |
| `hover` | 메뉴/GNB/드롭다운 등에 400ms 이상 체류 | `interaction.hover` |
| `scroll` | 120px 이상 스크롤 이동 | `scroll.to` |
| `keypress` | Enter, Escape, Tab 키 입력 | `keyboard.press` |
| `nav` | 페이지 이동 (frameNavigated) | `nav.goto` |

### 4.3 노이즈 필터링

- **호버**: 400ms dwell time 기반. `mouseenter`에서 타이머 시작, `mouseleave`에서 취소. 스치듯 지나간 것은 자동 필터링.
- **스크롤**: 최소 120px 이동 + 250ms 간격 디바운싱
- **중복 방지**: 직전 스텝과 동일한 액션+파라미터면 스킵

---

## 5. 시나리오 실행 엔진

### 5.1 실행 흐름

1. CDP로 대상 탭에 attach
2. document 접근 가능 여부 확인
3. 스텝 순차 실행: `executeAction(tabId, actionId, params, options)`
4. 각 스텝 사이에 속도 프리셋에 따른 딜레이
5. 스텝 실행 후 새 탭 열림 감지 -> 자동 전환
6. DOM 스냅샷 캡처 (학습용)
7. 완료/에러/취소 시 CDP detach

### 5.2 새 탭 자동 전환

`chrome.tabs.onCreated` 리스너로 현재 탭에서 열린 새 탭(`openerTabId` 일치)을 감지합니다.
새 탭 로드 완료 시 CDP를 새 탭에 attach하고 이후 스텝을 새 탭에서 실행합니다.
시나리오 종료 시 원래 탭 + 추가 탭 모두 detach합니다.

### 5.3 CDP 안정성

빈번한 시나리오 실행 시 "Already attached" 에러를 방지하기 위해 참조 카운팅 방식을 사용합니다.

```
attachToTab(tabId):  refCount++ (이미 attached면 카운트만 증가)
detachFromTab(tabId): refCount-- (0이 될 때만 실제 detach)
```

### 5.4 속도 프리셋

| 프리셋 | 스텝 간 딜레이 |
|--------|---------------|
| 느리게 | 3,000ms |
| 보통 | 1,000ms |
| 빠르게 | 200ms |

검증 모드는 별도로 800ms 고정입니다.

---

## 6. DRR-to-DSL 변환

### 6.1 입력 형식

사용자는 자연어 텍스트에 구조화된 토큰 칩을 조합하여 시나리오를 기술합니다.

**지원하는 토큰:**

| 토큰 | 역할 | 예시 |
|------|------|------|
| `[button: ...]` | 클릭 대상 버튼 | `[button: 신청하기]` |
| `[form: ...]` | 입력 필드 | `[form: 아이디=test@email.com]` |
| `[context: ...]` | 위치 맥락 | `[context: 이벤트 배너 아래]` |
| `[nav: ...]` | 이동 경로 | `[nav: /mobile]` |
| `[domain: ...]` | 도메인 | `[domain: stg.example.com/mobile]` |
| `[gnb: ...]` | GNB 메뉴 클릭 | `[gnb: 로그인]` |
| `[gnb-main: ...]` | GNB 대메뉴 | `[gnb-main: 스토어]` |
| `[gnb-sub: ...]` | GNB 소메뉴 | `[gnb-sub: 휴대폰]` |
| `[popup: ...]` | 팝업/모달 처리 | `[popup: 닫기]` |

### 6.2 변환 파이프라인

1. 토큰 칩 파싱 -> 구조화된 입력
2. 방문한 페이지의 DOM 요약 첨부 (학습된 페이지)
3. LLM 호출 (SYSTEM_PROMPT + 사용자 입력 + DOM 컨텍스트)
4. JSON DSL 응답 파싱
5. `baseUrl` 후처리 (example.com -> 실제 호스트)
6. 시나리오 저장

---

## 7. DOM 스냅샷

### 7.1 수집 방식

페이지 이동 시 자동으로 DOM 요약을 수집하여 캐시합니다.
DRR 변환 시 모든 방문 페이지의 DOM 정보가 LLM에 전달됩니다.

### 7.2 수집 내용

- 페이지 경로, 제목, 헤딩
- CTA (버튼, 링크) 목록 + 컨텍스트 + CSS 셀렉터
- 폼 필드 (input, textarea, select) + 라벨 + 셀렉터
- 네비게이션 항목
- 모달/토스트 문구
- data-testid 속성

### 7.3 PII 마스킹

수집된 텍스트에서 이메일, 전화번호, 카드번호, 주민번호, JWT 토큰 패턴을 자동 마스킹합니다.

---

## 8. UI 기능 목록

### 8.1 시나리오 목록 (ScenarioList)

- 시나리오 카드 목록 (드래그 앤 드롭 정렬)
- 그룹 탭 관리
- DRR 입력 + 토큰 칩 UI
- 변환 결과 DSL 표시 + 클립보드 복사
- 직접 생성 (녹화) 버튼
- 검증 버튼 (카드별, 진행 상태 토스트)
- 학습된 페이지 수 표시 + info 툴팁
- DOM 캐시 초기화

### 8.2 시나리오 실행 (ScenarioRunner)

- 스텝별 진행 상태 시각화 (idle/running/success/failed/todo)
- 실행 중 스텝 자동 스크롤 (화면 중앙 포커싱)
- 속도 프리셋 선택 (느리게/보통/빠르게)
- 일시정지 / 이어서 실행 / 취소 / 다시 실행
- 화면 녹화 (검사 탭 캡처, 자동 다운로드)
- 제목 인라인 편집
- 검증 전용 모드

### 8.3 설정

- OpenAI API 키 설정
- 스텝 딜레이 프리셋

---

## 9. 빌드 및 배포

### 빌드

```bash
pnpm build
```

`vite build` 후 `manifest.json`을 `dist/`에 복사합니다.

### Chrome 설치

1. `chrome://extensions` 접속
2. "개발자 모드" 활성화
3. "압축해제된 확장 프로그램을 로드합니다" -> `dist/` 폴더 선택
4. 개발자 도구(F12) -> "flux" 탭에서 사용

### manifest.json 권한

| 권한 | 용도 |
|------|------|
| `debugger` | CDP 통신 (시나리오 실행, 녹화) |
| `activeTab` | 현재 탭 접근 |
| `storage` | 확장 프로그램 저장소 |
| `devtools` | DevTools 패널 등록 |
| `tabs` | 탭 URL 조회, 새 탭 감지 |
| `tabCapture` | 화면 녹화 |

---

## 10. 향후 과제

### 10.1 액션 레지스트리 고도화

실제 서비스 레포에서 컴포넌트 라이브러리를 분석하여 가능한 모든 인터랙션을 추출하고,
그 결과를 기반으로 액션 레지스트리를 확장합니다.

추출 프롬프트 예시는 별도 문서를 참고하세요.

### 10.2 DRR 문서 직접 파싱

기존 DRR 문서 형식(`|| 항목 || 내용 || ...`)을 직접 파싱하여 시나리오 골격을 자동 생성하는 기능.
현재는 자연어 입력 + 토큰 칩 방식만 지원합니다.

### 10.3 실행 안정성 개선

- 페이지 로드 완료 대기 로직 강화 (현재 고정 딜레이 기반)
- 동적 렌더링 요소 대기 (MutationObserver 기반 폴링)
- 에러 발생 시 자동 재시도 (configurable retry count)

### 10.4 리포트 기능

- 시나리오 실행 결과를 구조화된 리포트로 출력
- 성공/실패 스텝별 스크린샷 첨부
- 실행 시간, 에러 로그 포함
