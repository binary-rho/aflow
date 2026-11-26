# aflow

DRR(Design Review Request) 문서를 실행 가능한 시나리오로 변환하고, Chrome DevTools
Protocol(CDP)로 브라우저에서 자동 실행하는 **Chrome 확장 프로그램**(Manifest V3, Side Panel).

## 실행

```bash
pnpm install      # 의존성 설치
pnpm run dev      # Vite dev 서버
pnpm run build    # vite build + manifest.json → dist/
pnpm test         # vitest 단위 테스트
```

빌드 후 `chrome://extensions` → 개발자 모드 → `dist/` 폴더 로드. 툴바의 aflow 아이콘을 클릭하면 Side Panel이 열립니다.

---

## 동작 전략

aflow의 핵심 난제는 **"녹화/변환 시점의 화면"과 "재생 시점의 화면"이 다르다**는 것이다.
요금제 목록이 선택에 따라 개수가 바뀌고, 모달/바텀시트가 동적으로 뜨고, API 응답이 늦게
오고, Vue가 매번 `_uid_` id를 다시 매긴다. 아래 전략들은 모두 이 간극을 메우기 위한 것이다.

### 1. 요소 매칭 — selector를 쓰되, 믿을 만한 것만

"selector는 깨지기 쉬우니 텍스트로 찾아라"와 "안정적 selector가 텍스트보다 강하다"는
두 입장의 장점만 취한다. 재생 시 다음 우선순위로 요소를 찾는다:

1. **안정 selector** (`data-testid`, `data-gtm-*`, 고정 id) — 있으면 1순위로 검증 후 사용
2. **텍스트 + 컨텍스트** — selector가 없거나 불안정하면 표시 텍스트/라벨 + 부모 맥락으로 매칭
3. **AI 판단** — 비슷한 후보가 2개 이상 남으면, 그 **후보 N개만** AI에 압축 전달해 의도에
   맞는 하나를 고르게 함 (페이지 전체를 던지지 않아 "건초더미"·잘림으로 흐려지지 않음)
4. **사후 확인** — AI도 확신 못 하면(`NOT_SURE`) 첫 후보로 진행하되 "애매했음"으로 표시

> 불안정한 selector(`_uid_…`, `:nth-…` 2개 이상)는 **아예 신뢰하지 않는다**
> (`targetResolver.isDynamicSelector` / `isBrittleSelector`). 재생 시점엔 다른 요소를
> 가리킬 수 있기 때문. 이 경우 곧장 텍스트 매칭으로 폴백한다.

### 2. 모달 / 바텀시트 스코프 — 구조·동작 휴리스틱

활성 모달/오버레이가 있으면 검색 범위를 그 내부로 좁힌다(없으면 document 폴백). 고정 클래스
목록을 나열하는 대신, **구조·동작 신호로 판별**한다 (`services/scopeResolver.ts`):

- 표준 신호: `role="dialog"`, `aria-modal`, `[popover]`
- 키워드: 클래스/id의 `modal`·`sheet`·`popup`·`drawer`·`layer`·`overlay` 등
- 동작 신호: `position: fixed/absolute`, 높은 `z-index`, 화면을 덮는 면적
- 여러 후보면 위 점수가 높은 것 + 나중에 열린 것 우선

탐지(`domSnapshot`)와 실행(`targetResolver`, `cdp`)이 **같은 스코프 함수**를 공유하므로,
한 곳을 고치면 읽기와 클릭/입력이 함께 좁혀진다.

### 3. 입력 — 실제 사용자처럼

`el.value = ...` 대입은 모바일 Vue 등 제어 컴포넌트에서 무시되는 경우가 많다. 그래서:

- **텍스트 입력**: CDP 실제 키입력(`Input.insertText`)으로 진짜 타이핑. 실패 시 value 대입 폴백
- **radio / checkbox**: 값 대입이 아니라 라벨/텍스트로 찾아 **click** (선택 UI의 텍스트는
  input이 아니라 옆 `<label>`에 있기 때문)

### 4. 대기 — "API로 늦게 뜨는 화면"을 빨리 지나가지 않기

DOM이 잠깐 조용한 것을 "완료"로 오판하면, 아직 안 뜬 화면에서 엉뚱한 걸 누른다. 액션 후
다음을 순서대로 기다린다 (`runner.ts` → `cdp.ts`):

1. **변화 시작 대기** — 액션 직후 DOM이 *움직이기 시작할* 때까지 (로딩 전 오판 방지)
2. **networkidle** — 진행 중 네트워크 요청 수가 0이 되고 잠시 유지될 때까지
   (CDP `Network` 도메인으로 in-flight 카운트. API를 호출하는 스텝인지 **미리 판별하지
   않는다** — 요청이 있으면 기다리고, 없으면 바로 통과한다. 상한 15초)
3. **DOM 안정** — 더 이상 바뀌지 않을 때까지

### 5. 학습 캐시 — 확정된 정답만 재사용

같은 화면(host+path)에서 어렵게 얻은 정답을 다음 실행에 재사용한다. 단 **AI가 판단했거나
사용자가 사후확인으로 확정한**, 그리고 **안정적인** selector만 캐싱한다(`stores/selectorCacheStore.ts`,
`chrome.storage.local`). 사용 직전 현재 DOM에 실제로 존재하는지 검증하므로 화면이 바뀌면
자동 무효화된다. fast-path가 우연히 좁힌 결과는 캐싱하지 않는다(잘못된 선택의 고착 방지).

---

## 아키텍처

레이어 구조·데이터 흐름·액션 레지스트리 등 상세는 [`CLAUDE.md`](./CLAUDE.md) 참고.

단위 테스트는 vitest로 실행한다 (`pnpm test`, 감시 모드는 `pnpm test:watch`). 브라우저/CDP가 필요 없는 순수 로직(`*.test.ts`)만 대상이며, 실제 페이지 조작(CDP, 모달 인식 등)은 확장을 로드해 직접 확인해야 한다.
