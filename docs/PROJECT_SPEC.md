# Demoflow 프로젝트 스펙 및 크롬 익스텐션 전환 가이드

## 0. 자주 묻는 것

- **React만 써도 되나? Next 쓸 필요 있나?**  
  네. Chrome extension은 popup/options 같은 작은 UI라서 **React만으로 충분**합니다. Next(SSR, 파일 라우팅)는 익스텐션에서 거의 안 씁니다.

- **pnpm 써도 되나?**  
  네. `pnpm i` / `pnpm run dev` / `pnpm run build` 그대로 사용하면 됩니다.

- **기능 먼저 만들고 나중에 익스텐션으로 바꿔도 되나?**  
  네. 지금처럼 SPA로 개발하다가, 나중에 manifest + popup 빌드만 붙이면 됩니다.  
  미리 **저장을 localStorage로** 해두면 전환 시 코드 변경이 거의 없습니다.

---

## 1. 현재 프로젝트가 무엇인지

- **출처**: Figma 디자인(Chrome extension design)을 **Figma Make**로 코드 생성한 웹 앱입니다.
- **현재 형태**: 일반 **SPA(Single Page Application)** — 브라우저에서 `npm run dev`로 띄우는 React 앱입니다.
- **크롬 익스텐션 여부**: 아직 **아님**. `manifest.json` 없음, `chrome.*` API 미사용, `localStorage` 미사용. **디자인/프로토타입** 단계입니다.

---

## 2. 사용 기술 스택

| 구분 | 기술 | 버전/비고 |
|------|------|-----------|
| **런타임/빌드** | Vite | 6.3.5 |
| **프레임워크** | React | 18.3.1 (peer) |
| **라우팅** | react-router | 7.13.0 |
| **스타일** | Tailwind CSS | 4.1.12, `@tailwindcss/vite` |
| **UI 프리미티브** | Radix UI | 다수 패키지 (accordion, dialog, tabs, select 등) |
| **아이콘** | lucide-react | 0.487.0 |
| **기타** | MUI(@emotion, @mui/material, @mui/icons-material), recharts, react-hook-form, date-fns, motion, sonner 등 | 디자인 시스템/차트/폼/애니메이션/토스트 |

**실제로 페이지에서 쓰이는 것**: React, react-router, Tailwind, Radix 기반 UI 컴포넌트들, `lucide-react`, `cn()`(clsx/tailwind-merge).

---

## 3. 앱 구조 요약

### 3.1 라우팅

| 경로 | 컴포넌트 | 역할 |
|------|----------|------|
| `/` | `ScenarioList` | 시나리오 목록, DRR→DSL 변환 UI, 현재 URL 기준/전체 시나리오 |
| `/run/:id` | `ScenarioRunner` | 시나리오 단계별 실행(재생/일시정지/리셋) |
| `/registry` | `ActionRegistry` | 액션 도감(전체/구현 필요 필터, 검색) |
| `*` | `ScenarioList` | 폴백 |

### 3.2 데이터 모델 (`src/app/data.ts`)

- **ActionDefinition**: `id`, `name`, `description`, `status`('implemented'|'missing'|'deprecated'), `params?`
- **ScenarioStep**: `id`, `actionId`, `params?`, `description?`
- **Scenario**: `id`, `title`, `description`, `tags`, `urlPattern`, `steps`, `createdAt`

데이터는 **전부 하드코딩(MOCK)** — `MOCK_SCENARIOS`, `ACTION_REGISTRY`. 서버/저장소 없음.

### 3.3 디렉터리 구조 (핵심만)

```
src/
├── main.tsx              # React 진입점
├── app/
│   ├── App.tsx           # RouterProvider
│   ├── routes.ts         # createBrowserRouter 라우트 정의
│   ├── data.ts           # 타입 + MOCK_SCENARIOS, ACTION_REGISTRY
│   ├── index.css
│   ├── pages/
│   │   ├── ScenarioList.tsx   # 메인: 시나리오 목록/DRR/저장
│   │   ├── ScenarioRunner.tsx # 실행기
│   │   └── ActionRegistry.tsx # 액션 도감
│   └── components/
│       ├── Layout.tsx
│       ├── ScenarioCard.tsx
│       ├── figma/, ui/   # 공용 UI
├── lib/utils.ts
└── styles/               # index.css, tailwind, theme, fonts
```

---

## 4. 크롬 익스텐션으로 만들 때 필요한 것

### 4.1 “그냥 프론트만 만들듯이 하면 되나?”

- **UI 만든다는 점**에서는 맞습니다. React + Tailwind 그대로 써도 됩니다.
- **다만** 다음이 추가로 필요합니다.
  1. **manifest.json** (Manifest V3 권장): 익스텐션 메타데이터, 권한, 어떤 HTML/JS를 쓸지 정의.
  2. **진입점 구분**: 웹은 `index.html` 하나에 `main.tsx` 붙이면 되지만, 익스텐션은 **popup / options / side panel** 등 **페이지(HTML) 단위**로 나뉨. 각각에 대해 “어떤 HTML에서 어떤 JS를 실행할지”를 빌드가 만들어줘야 함.
  3. **빌드 결과물**: 개발 시에는 `npm run dev`로 로컬 서버지만, 실제 설치용은 **압축된 디렉터리** (HTML, JS, CSS, manifest.json, 아이콘 등). Vite 설정을 “extension용 출력”으로 바꾸거나, 빌드 후 스크립트로 popup/options용 HTML·JS를 정리해주는 방식이 필요합니다.
  4. **라우팅**: popup은 보통 작은 창이라 `createBrowserRouter` + `RouterProvider` 그대로 써도 되고, `/run/:id` 같은 건 popup 내에서 상대 경로로 처리하면 됩니다. (옵션 페이지를 별도 탭으로 열면 그쪽은 별도 HTML 진입점.)
  5. **저장소**: “저장은 localStorage”라고 하셨으니, **익스텐션 쪽 UI(popup/options)** 에서 `localStorage` 쓰면 됩니다. 같은 익스텐션 ID의 popup/options 페이지끼리는 같은 origin이라 localStorage 공유됩니다. (나중에 동기화가 필요하면 `chrome.storage.sync`로 바꿀 수 있음.)

정리하면: **프론트 코드(React 컴포넌트, 스타일, 상태)는 그대로 두고**,  
**manifest + 진입점(HTML/빌드) + (선택) 백그라운드/콘텐츠 스크립트**를 익스텐션 규격에 맞게 붙이면 됩니다.

### 4.2 localStorage 저장 스펙 제안

- **키 예시**: `demoflow_scenarios`, `demoflow_action_registry` (또는 네임스페이스 하나로 `demoflow`에 JSON 한 번에).
- **형식**: `data.ts`의 `Scenario[]`, `ACTION_REGISTRY`와 동일한 타입으로 `JSON.stringify`/`parse`.
- **초기값**: 현재 `MOCK_SCENARIOS`, `ACTION_REGISTRY`를 기본값으로 두고, localStorage에 없으면 이걸 쓰고, 있으면 localStorage 값 우선.
- **저장 시점**: 시나리오 추가/수정/삭제 시 localStorage 갱신; 액션 도감 수정 시에도 동일.

이렇게 하면 “지금 쓰는 구조·형식”을 그대로 localStorage 스펙으로 쓸 수 있습니다.

---

## 5. 다음 단계 제안

1. **manifest.json 추가** (Manifest V3, popup만 먼저).
2. **Vite 빌드 설정**:  
   - 출력을 익스텐션 폴더 구조에 맞추고,  
   - popup용 `popup.html` → `popup.js` (현재 `main.tsx` 진입점과 동일한 React 앱) 생성.
3. **라우팅**: 기존 `createBrowserRouter`를 `base: '/'` 또는 popup 경로에 맞춰 유지. (popup 내에서는 `/`, `/run/:id`, `/registry` 상대 경로 그대로 사용 가능.)
4. **데이터 계층 도입**:  
   - `data.ts`에서 “저장소”를 한 겹 추상화 (예: `getScenarios()`, `setScenarios()`, `getActionRegistry()`, `setActionRegistry()`).  
   - 내부 구현을 먼저 `localStorage`로 하고, 나중에 `chrome.storage`로 바꿀 수 있게.
5. **ScenarioList / ActionRegistry**: 위 저장소 함수 사용하도록 연결하고, “저장” 버튼 시 localStorage에 반영.

원하시면 다음 단계로 **manifest.json 초안**과 **Vite extension 빌드 설정 예시**, **localStorage 래퍼 코드 위치/이름**까지 구체적으로 작성해 드리겠습니다.
