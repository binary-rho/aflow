import { ACTION_REGISTRY, type ActionDefinition } from "@/app/data";
import {
  getLlmProvider,
  LLM_PROVIDER_OPTIONS,
  getAnthropicBaseUrl,
} from "@/stores/settingsStore";

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const ANTHROPIC_MESSAGES_PATH = "/v1/messages";
const ANTHROPIC_API_VERSION = "2023-06-01";

// 회사 방화벽이 api.anthropic.com 직접 호출을 막는 경우, 설정에 사내 Anthropic 호환
// 게이트웨이 base URL을 넣어 우회한다. domMatcher와 동일한 정책으로 처리.
function buildAnthropicMessagesUrl(): string {
  return `${getAnthropicBaseUrl()}${ANTHROPIC_MESSAGES_PATH}`;
}

function buildActionCatalog(): string {
  const implemented = Object.values(ACTION_REGISTRY).filter(
    (a): a is ActionDefinition => a.status === "implemented",
  );

  const grouped = new Map<string, ActionDefinition[]>();
  for (const action of implemented) {
    const category = action.id.split(".")[0];
    const list = grouped.get(category) ?? [];
    list.push(action);
    grouped.set(category, list);
  }

  const lines: string[] = [];
  for (const [category, actions] of grouped) {
    lines.push(`[${category}]`);
    for (const a of actions) {
      const paramStr = a.params?.length ? `{ ${a.params.join(", ")} }` : "no params";
      lines.push(`- ${a.id}: ${a.name}. ${paramStr}`);
    }
  }
  return lines.join("\n");
}

const SYSTEM_PROMPT = `You are a DRR (Demo Release Review) document to DSL converter.

## DRR 문서 구조 이해 (반드시 준수)

DRR 문서는 보통 다음 구조를 가집니다.

1. **도메인** — 예: 사전예약, 로그인, 홈. name/baseUrl 맥락.
2. **항목** — 대괄호 안 문장이 시나리오 제목/설명. name에 반영.
3. **사전조건** — 불릿 목록. 필요 시 nav.goto 등으로 경로 앞에 배치.
4. **경로** — 실제 시연 흐름. ">" 또는 "완료 후"/"이후"로 구분된 단계들 → steps.
5. **기대결과** — 시연 후 확인할 것 → assertions.

### 「[○○] 화면」·Confluence DRR 표현 (매우 중요)

- DRR에 **「[즐겨찾기 메뉴 설정] 화면」**처럼 대괄호 화면명이 나오면, 그것이 **앱 상단 타이틀 문구와 같다고 가정하지 말 것.** 보통 **이전 경로에서 특정 버튼을 눌렀을 때 열리는 화면**을 가리킨다.
- **button.click**에는 반드시 **DOM/ctas에 있는 실제 버튼 텍스트**만 넣는다. 화면명을 버튼 text로 쓰지 말 것.
- 예: 「즐겨찾기 메뉴 설정 화면」= 메인의 즐겨찾기 영역에서 **「설정하러 가기」** 또는 **「메뉴 설정」** 클릭 후 진입하는 화면 → 진입 step은 해당 button.click 한 개로 처리.
- **Confluence에서 붙여넣은 원문**이면, 위 대응 관계를 **drrClarification**에 한 줄로 요약해 넣는다 (사용자가 시나리오 설명으로 확인할 수 있게).

### 스크롤 동작 확인 (DRR에 반드시 steps로 반영)

- DRR에 **「좌우 스크롤」「1depth 탭 가로 스크롤」「가로 스크롤 동작」** 등이 있으면, 해당 화면(탭/설정 화면) 진입 **직후** steps에 **scroll.by**를 넣는다.
  - 예: \`{ "action": "scroll.by", "params": { "deltaX": 180, "deltaY": 0 }, "desc": "1depth 탭 영역 좌우 스크롤" }\` 를 **2~3회** 연속 (양방향이면 deltaX 양수 후 음수 -180).
  - 각 scroll.by 뒤에 **nav.wait** ms=400~600 권장.
- DRR에 **「상하 스크롤」「전체 화면 세로 스크롤」** 등이 있으면 **scroll.by**로 아래로 이동:
  - 예: \`scroll.by\` deltaY=350, deltaX=0 → nav.wait 500 → scroll.by deltaY=350 → nav.wait → **scroll.to** y=0 또는 scroll.by deltaY=-700 으로 위로 복귀(고정 UI 확인 맥락).
- **「상·하단 버튼 영역 고정」**은 DOM assertion으로 완전 검증 어려움 → assertions 생략 가능. **스크롤 재현 steps는 반드시 포함** (시연 자동화 목적).
- **scroll.to**: 절대 위치(y) 이동. **scroll.by**: 상대 이동(deltaX, deltaY). 가로만 스크롤할 때 selector 생략 가능(엔진이 가로 스크롤 가능한 영역 탐색).

---

Output ONLY valid JSON:
{
  "name": "string — scenario title",
  "baseUrl": "string — host only (no scheme/path). Use the 'current page host' when provided; never use 'example.com' unless the DRR explicitly mentions it. If no domain is specified, use empty string.",
  "drrClarification": "string (optional) — 한 줄. DRR/Confluence 문서에 나온 「화면명」과 실제 앱 버튼의 대응을 명시. 예: 문서의 「즐겨찾기 메뉴 설정」화면 = 메인 즐겨찾기에서 「설정하러 가기」 또는 「메뉴 설정」클릭 후 진입. 문서가 애매할 때만 채운다.",
  "steps": [{ "action": "string", "params": { ... }, "desc": "string (Korean)" }],
  "assertions": [{ "action": "string", "params": { ... }, "desc": "string (Korean)" }]
}

## 사용 가능한 액션 (이 목록에 있는 것만 사용)

${buildActionCatalog()}

### 액션 선택 가이드
- **스크롤 검증 DRR** → scroll.by + nav.wait 조합을 빠뜨리지 말 것.
- 가장 구체적인 액션 ID를 사용할 것: form.fill보다 form.input_text.
- **체크/라디오:** form.check에 clickOnly: true와 label(+context) — 실제 클릭 한 번(토글). DRR에 선택/해제를 정확히 구분해야 할 때만 checked를 쓰고, 그 외에는 clickOnly만.
- keyboard.enter/escape/tab이 있으면 keyboard.press 대신 사용.
- assert.element_visible/element_hidden이 있으면 assert.visible/hidden 대신 사용.
- button.click의 text는 **ctas에 나온 버튼 텍스트 그대로** 사용. 상품명+버튼명을 합치지 말 것(예: "아이폰 17Pro 신청하기" -> text="신청하기", context로 구분).
- form.input_text/form.fill의 label은 필수.
- **본인인증·주민번호·휴대폰 등 연속 입력:** formFields에 나온 label/placeholder/aria-label을 **필드마다 다르게** 써서 한 필드에만 매칭되게 할 것. 같은 문구가 반복되면 params.context에 해당 입력 블록(예: 본인인증 모달, 이름/생년월일 행)을 넣고, DOM 요약의 구분 텍스트를 label에 반영.
- **네이티브 select (드롭다운):** formFields에 inputType이 "select-one"이고 options가 있으면 **반드시 form.select**를 사용. button.click으로 대체하지 말 것. params에 label(formFields의 label)과 optionText(선택할 옵션 텍스트)를 넣는다. 옵션 선택 후 "선택" 버튼이 있으면 form.select → button.click 순서로 생성.
- **커스텀 드롭다운:** formFields에 inputType이 "custom-select"이면 **form.select_dropdown**을 사용. div/button 기반 드롭다운(role="combobox", aria-haspopup 등)에 해당. params에 label(트리거의 레이블)과 optionText(선택할 옵션 텍스트)를 넣는다. context는 같은 label의 드롭다운이 여러 개일 때만 사용.
- **inputType 구분:** "select-one" → form.select (네이티브). "custom-select" → form.select_dropdown (커스텀). 둘을 혼동하지 말 것.

## DOM 요약 활용법 (페이지 요약이 있으면 반드시 준수)

- **viewport**: 뷰포트 정보와 모바일/PC 모드가 포함됩니다. 모바일 여부는 도메인 기준으로 판별합니다 (m.으로 시작하면 mobile).
  - **mobile** (m.도메인): GNB는 햄버거 메뉴 → 사이드바 구조. 대메뉴/소메뉴 구분 없이 사이드바에서 순차 탐색.
  - **pc** (m.이 아닌 도메인): GNB는 수평 메가메뉴. 대메뉴 호버 → 소메뉴 표시 구조.
  - GNB 관련 step 생성 시 반드시 viewport mode를 참고하여 해당 환경에 맞는 인터랙션을 생성할 것.
- **ctas** = 실제 페이지에 있는 클릭 가능한 요소 목록. **각 CTA의 text는 그 버튼/링크에 붙어 있는 문구 그대로**다.
- 휴대폰 카드 목록처럼 **카드마다 "신청하기" 버튼이 있는 구조**면, ctas에는 text="신청하기"인 항목이 여러 개 있고, context로 카드(상품명 등)가 구분된다. **이때 button.click의 text는 반드시 "신청하기"**로 둔다. DRR에 "아이폰 17Pro 신청하기"라고 적혀 있어도, 실제 버튼 문구가 "신청하기"이면 text="신청하기", context로 "아이폰 17Pro" 또는 DOM에 나온 해당 카드 맥락을 넣는다.
- **formFields**: 입력 필드. label은 formFields에 나온 값 그대로.
- **selector(→)는 무시.** 실행 시점에 자동 매칭.

## text와 context 결정 규칙

- **text**: DOM 요약이 제공된 경우 **오직 ctas에 적힌 text 값만** 사용. 상품명+버튼명("아이폰 17Pro 신청하기")을 한 덩어리로 넣지 말 것. 버튼이 "신청하기"면 text="신청하기".
- **context**: 같은 text 버튼이 여러 개일 때 어떤 카드/섹션인지 구분. DOM의 해당 CTA context(in ...)를 우선 사용. 한/영 동일 의미: 아이폰=iPhone, 갤럭시=Galaxy 등.
- **"X > 신청하기"** DRR: ctas에 "신청하기"만 있으면 → text="신청하기", context=X 또는 DOM의 해당 카드 맥락.

## 입력 토큰 문법 (있으면 최우선 반영)

사용자가 아래 형태를 입력하면 자연어보다 이 토큰 의미를 우선합니다.
- 권장: "닫기[button]", "이름[form]", "/mobile[nav]", "아이폰 17 Pro[context]", "스토어[gnb-main]", "휴대폰[gnb-sub]", "닫기[popup]", "stg.lguplus.com[domain]"
- 구문 호환: "[button: 닫기]", "[form: 이름]", "[nav: /mobile]", "[context: 아이폰 17 Pro]", "[gnb-main: 스토어]", "[gnb-sub: 휴대폰]", "[popup: 닫기]", "[domain: stg.lguplus.com]"
- "... [context]"는 바로 앞 action(button/form)에 params.context로 부여
- "... [gnb-main]/[gnb-sub]/[popup]"는 button.click의 context를 각각 "GNB 대메뉴"/"GNB 소메뉴"/"팝업"으로 해석
- "로그인[gnb]" 또는 "[gnb: 로그인]"일 때만 gnb.clickLogin으로 해석
- " > " 는 step 경계

## Rules:
- **경로 파싱:** ">" 또는 "완료 후"/"이후"로 구분된 각 구간을 별도 step으로.
- **중복 금지:** 버튼 클릭이 페이지 이동을 유발하는 경우, button.click만 생성하고 nav.goto를 별도로 추가하지 말 것. 예: "휴대폰 클릭 → /mobile 이동"은 button.click 하나로 처리.
- **nav.goto는 직접 URL 이동만:** 사용자가 주소를 직접 입력하거나 사전조건에서 특정 경로로 이동할 때만 사용.
- **button.click은 ctas 전용.** formFields(input, radio 등)를 클릭하는 step을 만들지 마세요.
- **로그인 폼:** ID/PW가 있으면 form.fill + button.click. auth.login 쓰지 않기.
- **기대결과만 assertions로.** DRR에 기대결과 없으면 assertions: [].
- **gnb.clickLogin:** "GNB > 로그인" 또는 헤더 로그인은 gnb.clickLogin (no params).
- Descriptions (desc) in Korean.
- Output ONLY valid JSON. No markdown, no explanation.`;

export interface DSLStep {
  action: string;
  /** button.click: { text, context? } / form.fill: { label, value, context? } / nav.goto: { url } */
  params?: Record<string, any>;
  desc?: string;
}

export interface DSL {
  name: string;
  baseUrl: string;
  /** DRR 화면명 ↔ 실제 버튼 대응 한 줄 (저장 시 시나리오 설명에 반영) */
  drrClarification?: string;
  steps: DSLStep[];
  assertions: DSLStep[];
}

type InputTokenType =
  | "button"
  | "form"
  | "context"
  | "nav"
  | "domain"
  | "gnb"
  | "gnb-main"
  | "gnb-sub"
  | "popup";

interface ParsedTokenAction {
  type: Exclude<InputTokenType, "context" | "domain">;
  value: string;
  context?: string;
  segment: number;
}

const LEGACY_INPUT_TOKEN_PATTERN =
  /\[(button|form|context|nav|domain|gnb|gnb-main|gnb-sub|popup)\s*:\s*([^\]]+)\]/gi;
const SUFFIX_INPUT_TOKEN_PATTERN =
  /([^\[\]\n>]+?)\s*\[(button|form|context|nav|domain|gnb|gnb-main|gnb-sub|popup)\]/gi;

function normalizeHostOnly(raw: string): string {
  return raw.replace(/^https?:\/\//, "").split("/")[0]?.trim() || "";
}

function isLoginText(raw: string): boolean {
  const normalized = raw.trim().replace(/\s+/g, "").toLowerCase();
  return normalized === "로그인" || normalized === "login" || normalized === "signin";
}

function buildStructuredTokenHint(drrText: string): string | null {
  const segments = drrText.split(">").map((s) => s.trim()).filter(Boolean);
  if (segments.length === 0) return null;

  const parsedActions: ParsedTokenAction[] = [];
  let parsedDomain: string | null = null;
  segments.forEach((segmentText, segmentIndex) => {
    LEGACY_INPUT_TOKEN_PATTERN.lastIndex = 0;
    SUFFIX_INPUT_TOKEN_PATTERN.lastIndex = 0;
    const segmentActions: ParsedTokenAction[] = [];
    let match: RegExpExecArray | null = null;
    while ((match = LEGACY_INPUT_TOKEN_PATTERN.exec(segmentText)) !== null) {
      const tokenType = (match[1] as InputTokenType).toLowerCase() as InputTokenType;
      const tokenValue = match[2].trim();
      if (!tokenValue) continue;
      if (tokenType === "domain") {
        const normalized = normalizeHostOnly(tokenValue);
        if (normalized) parsedDomain = normalized;
        continue;
      }
      if (tokenType === "context") {
        const lastAction = segmentActions[segmentActions.length - 1];
        if (lastAction) lastAction.context = tokenValue;
        continue;
      }
      if (tokenType === "gnb" || tokenType === "gnb-main" || tokenType === "gnb-sub" || tokenType === "popup") {
        if (tokenType === "gnb" && isLoginText(tokenValue)) {
          segmentActions.push({
            type: "gnb",
            value: tokenValue,
            segment: segmentIndex + 1,
          });
          continue;
        }
        const mappedContext =
          tokenType === "popup"
            ? "팝업"
            : tokenType === "gnb-main"
              ? "GNB 대메뉴"
              : tokenType === "gnb-sub"
                ? "GNB 소메뉴"
                : "GNB";
        segmentActions.push({
          type: "button",
          value: tokenValue,
          context: mappedContext,
          segment: segmentIndex + 1,
        });
        continue;
      }
      segmentActions.push({
        type: tokenType,
        value: tokenValue,
        segment: segmentIndex + 1,
      });
    }
    while ((match = SUFFIX_INPUT_TOKEN_PATTERN.exec(segmentText)) !== null) {
      const tokenValue = match[1].trim();
      const tokenType = (match[2] as InputTokenType).toLowerCase() as InputTokenType;
      if (!tokenValue) continue;
      if (tokenType === "domain") {
        const normalized = normalizeHostOnly(tokenValue);
        if (normalized) parsedDomain = normalized;
        continue;
      }
      if (tokenType === "context") {
        const lastAction = segmentActions[segmentActions.length - 1];
        if (lastAction) lastAction.context = tokenValue;
        continue;
      }
      if (tokenType === "gnb" || tokenType === "gnb-main" || tokenType === "gnb-sub" || tokenType === "popup") {
        if (tokenType === "gnb" && isLoginText(tokenValue)) {
          segmentActions.push({
            type: "gnb",
            value: tokenValue,
            segment: segmentIndex + 1,
          });
          continue;
        }
        const mappedContext =
          tokenType === "popup"
            ? "팝업"
            : tokenType === "gnb-main"
              ? "GNB 대메뉴"
              : tokenType === "gnb-sub"
                ? "GNB 소메뉴"
                : "GNB";
        segmentActions.push({
          type: "button",
          value: tokenValue,
          context: mappedContext,
          segment: segmentIndex + 1,
        });
        continue;
      }
      segmentActions.push({
        type: tokenType,
        value: tokenValue,
        segment: segmentIndex + 1,
      });
    }
    parsedActions.push(...segmentActions);
  });

  if (parsedActions.length === 0 && !parsedDomain) return null;

  const lines = parsedActions.map((action, index) => {
    const stepNo = index + 1;
    if (action.type === "button") {
      return `- step ${stepNo} (segment ${action.segment}): button.click, text="${action.value}"${action.context ? `, context="${action.context}"` : ""}`;
    }
    if (action.type === "form") {
      return `- step ${stepNo} (segment ${action.segment}): form.fill, label="${action.value}"${action.context ? `, context="${action.context}"` : ""}`;
    }
    if (action.type === "gnb") {
      return `- step ${stepNo} (segment ${action.segment}): gnb.clickLogin`;
    }
    return `- step ${stepNo} (segment ${action.segment}): nav.goto, url="${action.value}"`;
  });

  const domainLine = parsedDomain ? `- baseUrl: "${parsedDomain}"` : null;
  const detailLines = domainLine ? [domainLine, ...lines] : lines;
  return `입력 토큰 파싱 결과(높은 우선순위):\n${detailLines.join("\n")}`;
}

function extractDomainToken(drrText: string): string | null {
  LEGACY_INPUT_TOKEN_PATTERN.lastIndex = 0;
  SUFFIX_INPUT_TOKEN_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null = null;
  while ((match = LEGACY_INPUT_TOKEN_PATTERN.exec(drrText)) !== null) {
    const tokenType = (match[1] as InputTokenType).toLowerCase() as InputTokenType;
    if (tokenType !== "domain") continue;
    const host = normalizeHostOnly(match[2].trim());
    if (host) return host;
  }
  while ((match = SUFFIX_INPUT_TOKEN_PATTERN.exec(drrText)) !== null) {
    const tokenType = (match[2] as InputTokenType).toLowerCase() as InputTokenType;
    if (tokenType !== "domain") continue;
    const host = normalizeHostOnly(match[1].trim());
    if (host) return host;
  }
  return null;
}

const MAX_PAGE_SUMMARY_CHARS = 200_000;

function truncatePageSummary(summary: string): string {
  if (summary.length <= MAX_PAGE_SUMMARY_CHARS) return summary;
  const truncated = summary.slice(0, MAX_PAGE_SUMMARY_CHARS);
  const lastPageBreak = truncated.lastIndexOf("\n## Page ");
  const cutPoint = lastPageBreak > 0 ? lastPageBreak : MAX_PAGE_SUMMARY_CHARS;
  return truncated.slice(0, cutPoint) + "\n\n(... 이하 페이지 요약 생략 — 토큰 제한)";
}

export async function generateDSL(
  drrText: string,
  apiKey: string,
  options?: { pageSummary?: string | null; currentHost?: string | null },
): Promise<DSL> {
  const rawSummary = options?.pageSummary?.trim() || "";
  const safeSummary = rawSummary ? truncatePageSummary(rawSummary) : "";
  let userContent = safeSummary
    ? `페이지 요약 (시나리오 흐름 순서대로 캡처된 페이지들):\n\n${safeSummary}\n\n---\n\nDRR to convert:\n${drrText}`
    : drrText;
  if (options?.currentHost?.trim()) {
    userContent += `\n\n[현재 페이지 호스트 (baseUrl에 사용할 값, DRR에 도메인이 없으면 반드시 이 값을 쓸 것)]: ${options.currentHost.trim()}`;
  }
  const tokenHint = buildStructuredTokenHint(drrText);
  if (tokenHint) {
    userContent += `\n\n${tokenHint}`;
  }

  const provider = getLlmProvider();
  const providerConfig = LLM_PROVIDER_OPTIONS.find((o) => o.value === provider) ?? LLM_PROVIDER_OPTIONS[0];
  const model = providerConfig.model;

  let content: string;

  if (provider === "anthropic") {
    const anthropicBaseUrl = getAnthropicBaseUrl();
    // 사내 게이트웨이(예: seulgivibe)는 JWT를 Authorization: Bearer로 받기도 하고,
    // transparent proxy로 헤더를 그대로 anthropic에 forward하기도 한다.
    // 두 가지 모두 통과하도록 custom일 때 두 헤더 모두 보낸다. (공식 endpoint는 x-api-key만 보고 무시)
    const isCustomGateway = anthropicBaseUrl !== "https://api.anthropic.com";
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_API_VERSION,
      "anthropic-dangerous-direct-browser-access": "true",
    };
    if (isCustomGateway) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }
    const response = await fetch(buildAnthropicMessagesUrl(), {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: [
          { role: "user", content: userContent },
        ],
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Anthropic API error (${response.status}): ${errorBody}`);
    }

    const data = await response.json();
    content = data.content?.[0]?.text ?? "";
  } else {
    const response = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
        temperature: 0.2,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`OpenAI API error (${response.status}): ${errorBody}`);
    }

    const data = await response.json();
    content = data.choices?.[0]?.message?.content ?? "";
  }

  if (!content) {
    throw new Error("LLM API returned empty content");
  }

  const cleanedContent = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  const parsed: DSL = JSON.parse(cleanedContent);

  if (!parsed.name || !Array.isArray(parsed.steps)) {
    throw new Error("Invalid DSL structure returned from LLM");
  }

  const tokenDomain = extractDomainToken(drrText);
  if (tokenDomain) {
    parsed.baseUrl = tokenDomain;
  }

  const currentHost = options?.currentHost?.trim();
  if (currentHost && (parsed.baseUrl === "example.com" || !parsed.baseUrl?.trim())) {
    parsed.baseUrl = currentHost;
  }

  return parsed;
}
