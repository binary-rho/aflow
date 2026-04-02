# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

flux는 DRR(Design Review Request) 문서를 실행 가능한 시나리오로 변환하고, Chrome DevTools Protocol(CDP)을 통해 브라우저에서 자동 실행하는 **Chrome 확장 프로그램**(Manifest V3, Side Panel)입니다.

## Build & Dev Commands

```bash
pnpm install          # 의존성 설치
pnpm run dev          # Vite dev server
pnpm run build        # vite build + manifest.json → dist/ 복사
```

빌드 후 `chrome://extensions` → 개발자 모드 → `dist/` 폴더 로드. DevTools(F12) → "flux" 탭에서 사용.

테스트 프레임워크는 아직 설정되어 있지 않습니다.

## Architecture

### 레이어 구조

```
background.ts (Service Worker) ─── 메시지 허브: RUN_SCENARIO, START/STOP_RECORDING, PAUSE/RESUME/CANCEL
    ├── engine/runner.ts          ─── 시나리오 스텝 순차 실행, 새 탭 자동 전환
    ├── engine/recorder.ts        ─── 사용자 조작 녹화 (CDP 이벤트 수집 + 스크립트 주입)
    ├── engine/cdp.ts             ─── Chrome DevTools Protocol 래퍼 (참조 카운팅)
    ├── engine/actionRegistry.ts  ─── 액션 이름 → 실행 함수 디스패치
    ├── actions/                  ─── 개별 액션 구현체 (navigation, interaction, auth, assertion)
    ├── services/llm.ts           ─── DRR → DSL 변환 (OpenAI gpt-4o / Anthropic Claude)
    ├── services/domSnapshot.ts   ─── 페이지 DOM 요약 수집 (CTA, 폼, 셀렉터, PII 마스킹)
    └── services/domMatcher.ts    ─── 텍스트 기반 DOM 요소 매칭 (한영 동의어)

app/ (React SPA, Side Panel UI)
    ├── pages/ScenarioList.tsx    ─── 메인: 시나리오 목록, DRR 입력, 녹화
    ├── pages/ScenarioRunner.tsx  ─── 실행 화면 (진행 상태, 제어, 화면 녹화)
    ├── pages/ScenarioFlowPage.tsx ── 플로우 빌더 캔버스
    └── pages/FlowDetailPage.tsx  ─── 플로우 상세

stores/ (localStorage 기반)
    ├── scenarioStore.ts          ─── 시나리오 CRUD (키: flux_scenarios)
    ├── settingsStore.ts          ─── API 키, LLM 프로바이더, 속도 프리셋
    ├── flowCompositionStore.ts   ─── 플로우 그래프 (노드 + 엣지)
    └── groupsStore.ts            ─── 시나리오 그룹
```

### 핵심 데이터 흐름

1. **DRR → DSL 변환**: 사용자 텍스트 + 토큰 칩 → `llm.ts` (시스템 프롬프트 + DOM 요약 첨부) → JSON DSL → 시나리오 저장
2. **시나리오 실행**: `RUN_SCENARIO` 메시지 → `runner.ts` 스텝 루프 → `actionRegistry.ts` → `cdp.ts` → 브라우저 탭
3. **녹화**: CDP attach → 이벤트 스크립트 주입 → `RecordedEvent[]` 수집 → `background.ts`에서 시나리오로 변환

### IPC 패턴

Panel ↔ Service Worker 간 `chrome.runtime.sendMessage()` 기반 메시지 통신. Runner는 각 스텝 실행 후 `RUNNER_STATUS`를 브로드캐스트하고, UI가 `onMessage` 리스너로 수신.

### CDP 참조 카운팅

`cdp.ts`의 `attachToTab`/`detachFromTab`은 참조 카운트 방식으로 "Already attached" 에러를 방지합니다. `refCount`가 0이 될 때만 실제 detach.

## Key Conventions

- **라우팅**: `react-router` Hash Router 사용 (`src/app/routes.ts`)
- **경로 별칭**: `@/*` → `./src/*` (tsconfig paths)
- **스타일링**: Tailwind CSS 4 + Radix UI primitives (`src/app/components/ui/`)
- **상태 저장**: 모든 영구 상태는 `localStorage` (키 접두사: `flux_`)

## Action Registry

164개 액션 중 30개 구현. 새 액션 추가 시:

1. `src/app/data.ts`의 `ACTION_REGISTRY`에서 `status: 'missing'`인 액션 확인
2. `src/actions/` 하위에 실행 함수 구현
3. `src/actions/index.ts`의 `registry`에 매핑 등록
4. 필요 시 `src/engine/cdp.ts`에 CDP 래퍼 추가
5. `data.ts`에서 해당 액션의 `status`를 `'implemented'`로 변경

## LLM Integration

- `services/llm.ts`에 OpenAI / Anthropic 두 프로바이더 지원
- 시스템 프롬프트(1,200+ 줄)에 액션 카탈로그, DOM 요약 활용 규칙, 텍스트/컨텍스트 결정 규칙 포함
- DRR 토큰 문법: `[button: ...]`, `[form: ...]`, `[context: ...]`, `[nav: ...]`, `[domain: ...]`, `[gnb: ...]`
