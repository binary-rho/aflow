import { ACTION_REGISTRY, type ActionDefinition } from "@/app/data";

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const MODEL = "gpt-4o-mini";

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

---

Output ONLY valid JSON:
{
  "name": "string — scenario title",
  "baseUrl": "string — host only (no scheme/path). Use the 'current page host' when provided; never use 'example.com' unless the DRR explicitly mentions it. If no domain is specified, use empty string.",
  "steps": [{ "action": "string", "params": { ... }, "desc": "string (Korean)" }],
  "assertions": [{ "action": "string", "params": { ... }, "desc": "string (Korean)" }]
}

## 사용 가능한 액션 (이 목록에 있는 것만 사용)

${buildActionCatalog()}

### 액션 선택 가이드
- 가장 구체적인 액션 ID를 사용할 것: form.fill보다 form.input_text, form.check보다 form.checkbox_check.
- keyboard.enter/escape/tab이 있으면 keyboard.press 대신 사용.
- assert.element_visible/element_hidden이 있으면 assert.visible/hidden 대신 사용.
- button.click의 text는 **ctas에 나온 버튼 텍스트 그대로** 사용. 상품명+버튼명을 합치지 말 것(예: "아이폰 17Pro 신청하기" -> text="신청하기", context로 구분).
- form.input_text/form.fill의 label은 필수.

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

export async function generateDSL(
  drrText: string,
  apiKey: string,
  options?: { pageSummary?: string | null; currentHost?: string | null },
): Promise<DSL> {
  let userContent = options?.pageSummary?.trim()
    ? `페이지 요약 (시나리오 흐름 순서대로 캡처된 페이지들):\n\n${options.pageSummary}\n\n---\n\nDRR to convert:\n${drrText}`
    : drrText;
  if (options?.currentHost?.trim()) {
    userContent += `\n\n[현재 페이지 호스트 (baseUrl에 사용할 값, DRR에 도메인이 없으면 반드시 이 값을 쓸 것)]: ${options.currentHost.trim()}`;
  }
  const tokenHint = buildStructuredTokenHint(drrText);
  if (tokenHint) {
    userContent += `\n\n${tokenHint}`;
  }

  const response = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
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
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("OpenAI API returned empty content");
  }

  const parsed: DSL = JSON.parse(content);

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
