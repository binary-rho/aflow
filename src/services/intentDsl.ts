/**
 * Intent DSL — Step 3
 *
 * DRR에서 사용자가 의미한 행동을 보존하는 중간 표현.
 * 1차 LLM은 IntentScenario를 만들고, runner는 IntentScenario를 ExecutableScenario로 낮춰서 실행한다.
 *
 * 호환성: 기존 DSL은 toIntentScenario()로 자동 변환되어 동일 경로를 탄다.
 * 새 시나리오는 IntentScenario로 직접 만들어진다.
 */

import type { DSL, DSLStep } from "@/services/llm";

/** 클릭/입력 대상의 의미적 식별자. selector는 신뢰하지 않고 힌트로만 둠. */
export interface TargetDescriptor {
  /** 표시 텍스트 또는 accessibleName (button/link) */
  textHint?: string;
  /** 폼 필드 라벨 (input/select) */
  labelHint?: string;
  /** 같은 텍스트/라벨이 여러 개일 때 좁히는 단서 (카드명, 상품명 등) */
  contextHint?: string;
  /** Accessibility role (button, link, textbox, combobox 등) */
  role?: string;
  /** data-testid 직접 지정 (강한 신호) */
  testId?: string;
  /** 가장 가까운 의미 영역 (header/nav/main/footer/dialog/form/section) */
  landmark?: string;
  /** recorder가 제공하는 selector (있으면 1순위 시도, 검증 후 사용) */
  selector?: string | null;
}

export type IntentAction =
  | "click"
  | "hover"
  | "fill"
  | "select"
  | "check"
  | "navigate"
  | "scroll"
  | "wait"
  | "keypress"
  | "assert";

export interface IntentStep {
  id: string;
  /** 사용자 의도 한 줄 설명 (DRR 원문에 가까운 자연어) */
  intent: string;
  action: IntentAction;
  /** 클릭/호버/입력 대상 (action이 click/hover/fill/select/check일 때) */
  target?: TargetDescriptor;
  /** action 종류별 부가 입력 — value(입력값), url(이동), key(키), x/y(스크롤), ms(대기) 등 */
  params?: Record<string, any>;
  /** 사람에게 보여줄 짧은 설명 (한국어) */
  desc?: string;
}

export interface IntentScenario {
  kind: "intentScenario";
  /** schema version. 향후 마이그레이션 키. */
  version: 1;
  name: string;
  baseUrl: string;
  /** DRR 화면명 ↔ 실제 버튼 대응 한 줄 */
  drrClarification?: string;
  steps: IntentStep[];
  assertions: IntentStep[];
}

/**
 * 기존 DSL → IntentScenario 어댑터.
 * 동작은 그대로 유지하면서 새 타입 위에서 돌아가게 함.
 * 모든 DSLStep 매핑은 알려진 액션 ID 기준으로 수행되고, 알 수 없는 액션은 그대로 통과.
 */
export function toIntentScenario(dsl: DSL): IntentScenario {
  return {
    kind: "intentScenario",
    version: 1,
    name: dsl.name,
    baseUrl: dsl.baseUrl,
    drrClarification: dsl.drrClarification,
    steps: dsl.steps.map((s, i) => dslStepToIntent(s, `s${i + 1}`)),
    assertions: (dsl.assertions ?? []).map((s, i) =>
      dslStepToIntent(s, `a${i + 1}`),
    ),
  };
}

function dslStepToIntent(step: DSLStep, id: string): IntentStep {
  const p = step.params ?? {};
  const desc = step.desc;

  switch (step.action) {
    case "button.click":
      return {
        id,
        intent: desc ?? `클릭: ${p.text ?? p.selector ?? "(대상 없음)"}`,
        action: "click",
        target: {
          textHint: p.text,
          contextHint: p.context,
          selector: p.selector ?? null,
        },
        desc,
      };
    case "interaction.hover":
      return {
        id,
        intent: desc ?? `호버: ${p.text ?? p.selector ?? "(대상 없음)"}`,
        action: "hover",
        target: {
          textHint: p.text,
          contextHint: p.context,
          selector: p.selector ?? null,
        },
        desc,
      };
    case "form.fill":
    case "form.input_text":
      return {
        id,
        intent: desc ?? `입력: ${p.label ?? "(라벨 없음)"} = ${p.value ?? ""}`,
        action: "fill",
        target: {
          labelHint: p.label,
          contextHint: p.context,
          selector: p.selector ?? null,
        },
        params: { value: p.value },
        desc,
      };
    case "form.select":
    case "form.select_dropdown":
      return {
        id,
        intent: desc ?? `선택: ${p.label ?? ""} → ${p.optionText ?? p.value ?? ""}`,
        action: "select",
        target: {
          labelHint: p.label,
          contextHint: p.context,
          selector: p.selector ?? null,
        },
        params: {
          value: p.value,
          optionText: p.optionText,
          custom: step.action === "form.select_dropdown",
        },
        desc,
      };
    case "form.check":
      return {
        id,
        intent: desc ?? `체크: ${p.label ?? p.selector ?? ""}`,
        action: "check",
        target: {
          labelHint: p.label,
          contextHint: p.context,
          selector: p.selector ?? null,
        },
        params: { checked: p.checked, clickOnly: p.clickOnly },
        desc,
      };
    case "nav.goto":
      return {
        id,
        intent: desc ?? `이동: ${p.url ?? ""}`,
        action: "navigate",
        params: { url: p.url, query: p.query, hash: p.hash },
        desc,
      };
    case "scroll.to":
    case "scroll.by":
      return {
        id,
        intent: desc ?? "스크롤",
        action: "scroll",
        params: {
          mode: step.action === "scroll.to" ? "absolute" : "relative",
          x: p.x,
          y: p.y,
          deltaX: p.deltaX,
          deltaY: p.deltaY,
        },
        desc,
      };
    case "nav.wait":
      return {
        id,
        intent: desc ?? "대기",
        action: "wait",
        params: { ms: p.ms ?? 500 },
        desc,
      };
    case "keyboard.press":
    case "keyboard.enter":
    case "keyboard.escape":
    case "keyboard.tab":
      return {
        id,
        intent: desc ?? `키: ${p.key ?? step.action.split(".")[1]}`,
        action: "keypress",
        params: { key: p.key ?? step.action.split(".")[1] },
        desc,
      };
    default:
      // assert.* 등 알 수 없는 액션은 raw로 통과
      return {
        id,
        intent: desc ?? step.action,
        action: step.action.startsWith("assert") ? "assert" : "click",
        params: { ...p, __rawAction: step.action },
        desc,
      };
  }
}

/**
 * IntentScenario → 기존 DSL (실행기 호환). Step 3은 데이터 모델 추가만 하고
 * runner는 여전히 DSL을 받게 둠 — 마이그레이션 부담 최소화.
 */
export function fromIntentScenario(scenario: IntentScenario): DSL {
  return {
    name: scenario.name,
    baseUrl: scenario.baseUrl,
    drrClarification: scenario.drrClarification,
    steps: scenario.steps.map(intentStepToDsl),
    assertions: scenario.assertions.map(intentStepToDsl),
  };
}

function intentStepToDsl(step: IntentStep): DSLStep {
  const t = step.target ?? {};
  const p = step.params ?? {};
  const passSelector = t.selector ? { selector: t.selector } : {};

  switch (step.action) {
    case "click":
      return {
        action: "button.click",
        params: {
          text: t.textHint,
          context: t.contextHint,
          ...passSelector,
        },
        desc: step.desc,
      };
    case "hover":
      return {
        action: "interaction.hover",
        params: {
          text: t.textHint,
          context: t.contextHint,
          ...passSelector,
        },
        desc: step.desc,
      };
    case "fill":
      return {
        action: "form.fill",
        params: {
          label: t.labelHint,
          context: t.contextHint,
          value: p.value,
          ...passSelector,
        },
        desc: step.desc,
      };
    case "select":
      return {
        action: p.custom ? "form.select_dropdown" : "form.select",
        params: {
          label: t.labelHint,
          context: t.contextHint,
          value: p.value,
          optionText: p.optionText,
          ...passSelector,
        },
        desc: step.desc,
      };
    case "check":
      return {
        action: "form.check",
        params: {
          label: t.labelHint,
          context: t.contextHint,
          checked: p.checked,
          clickOnly: p.clickOnly,
          ...passSelector,
        },
        desc: step.desc,
      };
    case "navigate":
      return {
        action: "nav.goto",
        params: { url: p.url, query: p.query, hash: p.hash },
        desc: step.desc,
      };
    case "scroll":
      return {
        action: p.mode === "relative" ? "scroll.by" : "scroll.to",
        params: { x: p.x, y: p.y, deltaX: p.deltaX, deltaY: p.deltaY },
        desc: step.desc,
      };
    case "wait":
      return {
        action: "nav.wait",
        params: { ms: p.ms },
        desc: step.desc,
      };
    case "keypress":
      return {
        action: "keyboard.press",
        params: { key: p.key },
        desc: step.desc,
      };
    case "assert":
    default:
      return {
        action: (p.__rawAction as string) ?? step.action,
        params: stripRawAction(p),
        desc: step.desc,
      };
  }
}

function stripRawAction(p: Record<string, any>): Record<string, any> {
  const { __rawAction, ...rest } = p;
  void __rawAction;
  return rest;
}

/**
 * 1차 LLM에 줄 JSON Schema (OpenAI strict 모드용).
 * 이 스키마를 따르는 응답만 받기 위함. 자연어 프롬프트가 어겨도 schema가 막아준다.
 */
export const INTENT_SCENARIO_JSON_SCHEMA = {
  name: "IntentScenario",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["kind", "version", "name", "baseUrl", "steps", "assertions"],
    properties: {
      kind: { type: "string", const: "intentScenario" },
      version: { type: "integer", const: 1 },
      name: { type: "string" },
      baseUrl: { type: "string" },
      drrClarification: { type: ["string", "null"] },
      steps: {
        type: "array",
        items: { $ref: "#/$defs/IntentStep" },
      },
      assertions: {
        type: "array",
        items: { $ref: "#/$defs/IntentStep" },
      },
    },
    $defs: {
      IntentStep: {
        type: "object",
        additionalProperties: false,
        required: ["id", "intent", "action"],
        properties: {
          id: { type: "string" },
          intent: { type: "string" },
          action: {
            type: "string",
            enum: [
              "click",
              "hover",
              "fill",
              "select",
              "check",
              "navigate",
              "scroll",
              "wait",
              "keypress",
              "assert",
            ],
          },
          target: {
            type: ["object", "null"],
            additionalProperties: false,
            properties: {
              textHint: { type: ["string", "null"] },
              labelHint: { type: ["string", "null"] },
              contextHint: { type: ["string", "null"] },
              role: { type: ["string", "null"] },
              testId: { type: ["string", "null"] },
              landmark: { type: ["string", "null"] },
              selector: { type: ["string", "null"] },
            },
          },
          params: {
            type: ["object", "null"],
            additionalProperties: true,
          },
          desc: { type: ["string", "null"] },
        },
      },
    },
  },
} as const;
