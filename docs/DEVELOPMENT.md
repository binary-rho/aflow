# aflow - 개발 문서

## 1. 프로젝트 개요

aflow는 DRR(Design Review Request) 문서를 실행 가능한 시나리오로 변환하고, Chrome DevTools Protocol(CDP)을 통해 브라우저에서 자동 실행하는 Chrome 확장 프로그램입니다.

### 핵심 기능

- **DRR-to-DSL 변환**: 자연어 시나리오 입력을 LLM(로컬 LLM / GPT-4o / Claude 중 선택)으로 구조화된 DSL로 변환
- **시나리오 자동 실행**: CDP를 통해 대상 탭(Side Panel이 열린 창의 활성 탭)에서 클릭, 입력, 네비게이션 등을 자동 수행
- **직접 생성 (녹화)**: 사용자의 실제 브라우저 조작을 캡처하여 시나리오로 변환
- **검증 모드**: 실제 클릭/입력 없이 각 스텝의 요소 존재 여부만 순차 검증
- **화면 녹화**: 시나리오 실행 중 대상 탭의 화면을 녹화하여 파일로 저장

### 기술 스택

| 구분 | 기술 |
|------|------|
| 런타임/빌드 | Vite 6, TypeScript |
| UI | React 18, Tailwind CSS 4, Radix UI |
| 라우팅 | react-router 7 (Hash Router) |
| 플로우 캔버스 | @xyflow/react |
| 아이콘 | lucide-react |
| LLM | 로컬/사내 LLM(OpenAI 호환), OpenAI(gpt-4o, 매처는 gpt-4o-mini), Anthropic(Claude, 사내 게이트웨이 지원) |
| 브라우저 자동화 | Chrome DevTools Protocol (chrome.debugger) |
| 상태 저장 | `localStorage`(시나리오·설정·플로우, 패널에서 접근) + `chrome.storage`(selector 캐시·DOM 스냅샷, Service Worker에서 접근) |

---

## 2. 아키텍처

### 2.1 디렉터리 구조

```
src/
├── background.ts         # Service Worker: 메시지 허브 (실행/녹화/제어, 녹화 → 시나리오 변환)
├── actions/              # 실행 가능한 액션 구현체
│   ├── index.ts          # 액션 레지스트리 (이름 -> 함수 매핑, 별칭 포함)
│   ├── navigation.ts     # nav.goto, nav.wait, scroll.to, scroll.by
│   ├── interaction.ts    # button.click, form.fill/check/select/select_dropdown, hover, keypress, gnb.clickLogin
│   ├── assertion.ts      # assert.visible, assert.hidden, assert.text, assert.url
│   └── auth.ts           # (미사용) auth.login/signup 스텁 — 레지스트리에 등록되어 있지 않음
├── engine/               # 핵심 엔진
│   ├── cdp.ts            # CDP 래퍼 (attach 참조 카운팅, 대기 전략, 클릭/입력/스크롤 프리미티브)
│   ├── runner.ts         # 시나리오 실행 엔진 (스텝 순차 실행, 체인 실행, 새 탭 전환)
│   ├── recorder.ts       # 사용자 조작 녹화 (이벤트 수집, 스크립트 주입)
│   └── actionRegistry.ts # 액션 실행 위임 (StepResult 생성)
├── services/             # 요소 매칭 / LLM / DOM 요약
│   ├── llm.ts            # DRR -> DSL 변환 (로컬/OpenAI/Anthropic, 시스템 프롬프트, 토큰 파싱)
│   ├── intentDsl.ts      # DSL <-> IntentScenario 어댑터 (의도 기반 중간 표현)
│   ├── domSnapshot.ts    # 페이지 DOM 요약 수집 (CTA·폼·셀렉터, PII 마스킹)
│   ├── domMatcher.ts     # 요소 매칭: 캐시 -> fast path -> LLM 후보 선택
│   ├── targetResolver.ts # 클릭/호버/입력 대상 해결 사다리 (selector -> matcher -> text+context -> text)
│   ├── scopeResolver.ts  # 활성 모달/바텀시트 스코프 판별 (탐지·실행 공용)
│   ├── textMatch.ts      # 텍스트 정규화·매칭 (한영 동의어)
│   ├── contextExtractor.ts # 요소 주변 컨텍스트 추출 스크립트 (녹화/실행 공용)
│   └── urlMatch.ts       # URL 비교 (같은 페이지 판단, 시나리오 시작 URL)
├── stores/               # 저장소
│   ├── scenarioStore.ts  # 시나리오 CRUD                       (localStorage)
│   ├── groupsStore.ts    # 시나리오 그룹 관리                  (localStorage)
│   ├── settingsStore.ts  # LLM 설정·API 키·속도 프리셋         (localStorage, SW에는 메시지로 전달)
│   ├── flowCompositionStore.ts # 플로우 그래프(노드+엣지)      (localStorage)
│   ├── selectorCacheStore.ts   # 성공 selector 학습 캐시       (chrome.storage.local)
│   └── domCaptureStore.ts      # 마지막 실행의 DOM 스냅샷      (chrome.storage.session)
├── lib/                  # 순수 유틸
│   ├── scenarioChain.ts  # followUp 체인 펼치기
│   ├── flowLinearPath.ts # 플로우 그래프 -> 선형 시나리오 순서
│   ├── scenarioHost.ts   # 시나리오 urlPattern / 탭 호스트 비교
│   └── utils.ts
├── hooks/
│   ├── useActiveTabId.ts      # 활성 탭 ID 조회
│   └── useInspectedTabUrl.ts  # 대상 탭 URL 실시간 추적
└── app/                  # UI 레이어 (Side Panel, React)
    ├── routes.ts         # Hash Router 정의
    ├── data.ts           # 타입(Scenario 등) + ACTION_REGISTRY 정의
    ├── pages/
    │   ├── ScenarioList.tsx     # 메인: 시나리오 목록, DRR 입력, 녹화, 검증
    │   ├── ScenarioRunner.tsx   # 시나리오 실행 화면
    │   ├── ScenarioFlowPage.tsx # 플로우 빌더 캔버스
    │   ├── FlowDetailPage.tsx   # 플로우 상세·실행
    │   └── ActionRegistry.tsx   # 액션 도감
    └── components/
        ├── Layout.tsx, ScenarioCard.tsx, DraggableScenarioCard.tsx
        ├── DrrInputBox.tsx, DrrResultView.tsx, DrrThinkingView.tsx
        ├── SettingsModal.tsx    # LLM·키·속도 설정
        ├── flow/                # 플로우 캔버스 노드·레이아웃
        └── ui/                  # shadcn/Radix 기반 UI (button, select, dropdown-menu, tooltip)
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

### 2.3 메시지 프로토콜 (Side Panel <-> Service Worker)

| 메시지 타입 | 방향 | 설명 |
|------------|------|------|
| `RUN_SCENARIO` | Panel -> SW | 시나리오 실행 요청 |
| `RUNNER_STATUS` | SW -> Panel | 실행 상태 브로드캐스트 |
| `START_RECORDING` | Panel -> SW | 녹화 시작 |
| `STOP_RECORDING` | Panel -> SW | 녹화 종료 + 시나리오 반환 |
| `PAUSE` / `RESUME` / `CANCEL` | Panel -> SW | 실행 제어 |
| `GET_ACTIVE_TAB_URL` / `GET_INSPECTED_TAB_URL` / `NAVIGATE_ACTIVE_TAB` | Panel -> SW | 대상 탭 URL 조회·이동 |
| `EVAL_DOM_SCRIPT` | Panel -> SW | 대상 탭에서 스크립트 평가 (DOM 요약 수집 등) |
| `GET_TAB_CAPTURE_STREAM_ID` | Panel -> SW | 화면 녹화용 tabCapture 스트림 ID |

> **주의**: Service Worker에는 `localStorage`가 없습니다. 그래서 `RUN_SCENARIO`는 `apiKey`, `llmProvider`와 함께
> `llmConfig`(로컬 Base URL·모델, Anthropic 게이트웨이, LLM 매처 사용 여부)를 실어 보내고,
> SW는 `applyLlmRuntimeConfig()`로 적용합니다. 실행 중 사용하는 새 설정값이 생기면 이 메시지에 추가해야 합니다.

---

## 3. 액션 레지스트리

시나리오의 각 스텝은 액션 레지스트리에 등록된 함수를 호출합니다.

### 3.1 레지스트리 현황

실제 서비스 레포(Nuxt 2 + Vue 2 + Bootstrap-Vue, ~1,253 라우트)에서 추출한 **167개** 액션 정의를 정리했습니다. (`app/data.ts`의 `ACTION_REGISTRY`)

| 카테고리 | 전체 | 구현됨 | 주요 소스 |
|----------|------|--------|-----------|
| `nav.*` | 18 | 2 | LinkUtil, $router, AppBridge, 미들웨어 |
| `auth.*` | 17 | 0 | LoginUtil, AppLoginUtil, verifyRealName, OAuth2 |
| `button.*` | 19 | 1 | BxButton, BxLink, BxDialog, GNB/LNB |
| `gnb.*` | 1 | 1 | GNB 로그인 버튼 |
| `form.*` | 23 | 7 | BxInput*, BxDatePicker, BxFile, VeeValidate |
| `interaction.*` | 21 | 1 | BxDialog, BxBottomSheet, bx-accordion, bx-tab, Swiper |
| `keyboard.*` | 8 | 5 | @keyup.enter, @keydown, @keypress |
| `scroll.*` | 8 | 2 | scrollTo, bx-pagination, scrollToSection |
| `assert.*` | 21 | 8 | 자동화 테스트용 검증 액션 |
| `service.*` | 31 | 0 | 결제, 가입, 장바구니, 상담, 데이터, 로밍 등 |
| **합계** | **167** | **27** | |

> 위 "구현됨"은 `data.ts`에서 `status: 'implemented'`인 개수이며, LLM 프롬프트의 액션 카탈로그는 이 값을 기준으로 생성됩니다.
> 코드(`actions/index.ts`)에는 별칭을 포함해 32개가 등록되어 있습니다. 차이 5개(`button.link_click`, `button.cta_click`,
> `button.banner_click`, `form.input_password`, `form.input_number`)는 실행은 가능하지만 `data.ts`에서는 아직 `missing`입니다.
> `auth.login` / `auth.signup`은 스텁뿐이라 레지스트리에서 제외했고, 실행하면 `skipped (Not implemented)`로 보고됩니다.

구현된 액션 중 일부는 에일리어스(동일 구현체를 다른 ID로 매핑)입니다.
예: `form.input_text` -> `form.fill` 구현체 재사용, `keyboard.enter` -> `keyboard.press` 구현체 재사용.

### 3.2 에일리어스 매핑

기존 구현체로 처리 가능한 새 ID들은 `actions/index.ts`에서 동일 함수로 매핑됩니다:

| 새 ID | 매핑 대상 | 구현체 |
|-------|----------|--------|
| `button.link_click`, `button.cta_click`, `button.banner_click` | `button.click` | `clickButtonAction` |
| `form.input_text`, `form.input_password`, `form.input_number` | `form.fill` | `fillFormAction` |
| `form.checkbox_check`, `form.radio_select` | `form.check` | `checkAction` |
| `keyboard.enter`, `keyboard.escape`, `keyboard.tab`, `keyboard.keydown` | `keyboard.press` | `keypressAction` |
| `assert.element_visible` | `assert.visible` | `assertVisibleAction` |
| `assert.element_hidden`, `assert.elementHidden` | `assert.hidden` | `assertHiddenAction` |
| `assert.text_content` | `assert.text` | `assertTextAction` |

`form.select`(네이티브 select, `selectOptionAction`)와 `form.select_dropdown`(커스텀 드롭다운, `selectDropdownAction`)은
서로 다른 구현체입니다. 별칭이 아닙니다.

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
6. 스텝마다 DOM 스냅샷 캡처 (마지막 실행 기록용, `domCaptureStore`)
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
2. **현재 활성 탭**의 DOM 요약 첨부 (선택적, 변환 시점 1페이지만)
3. LLM 호출 (SYSTEM_PROMPT + 사용자 입력 + DOM 컨텍스트)
4. JSON DSL 응답 파싱
5. `baseUrl` 후처리 (example.com -> 실제 호스트)
6. 시나리오 저장

---

## 7. DOM 스냅샷

### 7.1 수집 방식

- **DRR → DSL 변환:** 변환 버튼을 누를 때, 대상 탭에서 **그 시점 한 페이지**의 DOM 요약만 수집해 LLM에 전달합니다. (도메인별 다중 페이지 캐시는 사용하지 않음.)
- **시나리오 실행:** 각 스텝 실행 시 CDP로 실시간 DOM을 캡처해 요소 매칭에 사용합니다.

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

### 8.2 시나리오 실행 (ScenarioRunner)

- 스텝별 진행 상태 시각화 (idle/running/success/failed/todo)
- 실행 중 스텝 자동 스크롤 (화면 중앙 포커싱)
- 속도 프리셋 선택 (느리게/보통/빠르게)
- 일시정지 / 이어서 실행 / 취소 / 다시 실행
- 화면 녹화 (대상 탭 캡처, 자동 다운로드)
- 제목 인라인 편집
- 검증 전용 모드

### 8.3 설정 (SettingsModal)

- LLM provider 선택: 로컬 LLM / GPT-4o / Claude (provider별로 API 키를 따로 저장)
- 로컬 LLM: Base URL, 모델 ID (OpenAI 호환 `/v1/chat/completions`)
- Anthropic: 사내 게이트웨이 Base URL (선택)
- LLM 매처(AI fallback) 사용 여부 — 끄면 코드 기반 매칭만 사용
- 스텝 딜레이 프리셋 (느리게/보통/빠르게)

---

## 9. 빌드 및 배포

### 빌드

```bash
pnpm build
```

`vite build` 후 `manifest.json`을 `dist/`에 복사합니다.

### 테스트

```bash
pnpm test         # 1회 실행
pnpm test:watch   # 감시 모드
```

vitest(node 환경)로 브라우저/CDP가 필요 없는 순수 로직만 테스트합니다. 설정은 `vitest.config.ts`, 테스트 파일은 대상 옆의 `*.test.ts`입니다. 현재 대상: `textMatch`, `urlMatch`, `scenarioHost`, `scenarioChain`, `flowLinearPath`, `settingsStore`(Service Worker 설정 전달).
`background.ts`의 `buildScenarioFromRecorded`와 `llm.ts`의 토큰 파서는 export되지 않고(또는 모듈 로드 시 `chrome` API를 호출해) 아직 테스트 대상이 아닙니다. 모듈로 분리하면 테스트할 수 있습니다.

### Chrome 설치

1. `chrome://extensions` 접속
2. "개발자 모드" 활성화
3. "압축해제된 확장 프로그램을 로드합니다" -> `dist/` 폴더 선택
4. 툴바의 aflow 아이콘을 클릭하면 Side Panel이 열립니다. 대상 페이지 탭을 활성화한 상태에서 사용

### manifest.json 권한

| 권한 | 용도 |
|------|------|
| `debugger` | CDP 통신 (시나리오 실행, 녹화) |
| `activeTab` | 현재 탭 접근 |
| `storage` | 확장 프로그램 저장소 |
| `sidePanel` | Side Panel UI 표시 |
| `tabs` | 탭 URL 조회, 새 탭 감지 |
| `tabCapture` | 화면 녹화 |

`host_permissions`에는 LLM 호출 대상(OpenAI, Anthropic, 사내 LLM 게이트웨이/서버)이 들어 있습니다.
다른 LLM 엔드포인트를 쓰려면 `manifest.json`의 `host_permissions`에 추가한 뒤 다시 빌드해야 합니다.

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
