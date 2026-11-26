import { gotoAction, waitAction, scrollToAction, scrollByAction } from "./navigation";
import { clickButtonAction, fillFormAction, gnbClickLoginAction, hoverAction, selectOptionAction, selectDropdownAction, checkAction, keypressAction } from "./interaction";
import {
  assertVisibleAction,
  assertHiddenAction,
  assertTextAction,
  assertUrlAction,
} from "./assertion";

/** 사후 확인 UI에 보여줄 후보 한 개. */
export interface ActionCandidate {
  selector: string;
  text: string | null;
  context: string | null;
}

/** 액션 실행 후 호출자에게 돌려주는 진단 메타. 모두 선택. */
export interface ActionMeta {
  /** 어떤 매칭 전략으로 풀렸나 (selector-validated / matcher-fast-path / matcher-llm / matcher-cache / text-with-context / text-only) */
  strategy?: string;
  /** 최종적으로 사용된 selector */
  selector?: string;
  /** 액션 자체 소요시간 (ms) */
  durationMs?: number;
  /** AI/코드가 확신 못 해 첫 후보로 진행했는가 → 사후확인 대상 */
  ambiguous?: boolean;
  /** 사후확인에 보여줄 후보 목록(2개+) */
  candidates?: ActionCandidate[];
}

export type ActionFn = (
  tabId: number,
  params?: Record<string, any>,
  options?: { validationOnly?: boolean; apiKey?: string; llmProvider?: string },
) => Promise<void | ActionMeta>;

const registry: Record<string, ActionFn> = {
  "nav.goto": gotoAction,
  "nav.wait": waitAction,
  "scroll.to": scrollToAction,
  "scroll.by": scrollByAction,
  "button.click": clickButtonAction,
  "button.link_click": clickButtonAction,
  "button.cta_click": clickButtonAction,
  "button.banner_click": clickButtonAction,
  "gnb.clickLogin": gnbClickLoginAction,
  "form.fill": fillFormAction,
  "form.input_text": fillFormAction,
  "form.input_password": fillFormAction,
  "form.input_number": fillFormAction,
  "form.check": checkAction,
  "form.checkbox_check": checkAction,
  "form.radio_select": checkAction,
  "form.select": selectOptionAction,
  "form.select_dropdown": selectDropdownAction,
  "interaction.hover": hoverAction,
  "keyboard.press": keypressAction,
  "keyboard.enter": keypressAction,
  "keyboard.escape": keypressAction,
  "keyboard.tab": keypressAction,
  "keyboard.keydown": keypressAction,
  "assert.visible": assertVisibleAction,
  "assert.hidden": assertHiddenAction,
  "assert.elementHidden": assertHiddenAction,
  "assert.element_visible": assertVisibleAction,
  "assert.element_hidden": assertHiddenAction,
  "assert.text": assertTextAction,
  "assert.text_content": assertTextAction,
  "assert.url": assertUrlAction,
};

export function getAction(actionName: string): ActionFn | undefined {
  return registry[actionName];
}

export function isActionImplemented(actionName: string): boolean {
  return actionName in registry;
}

export function getRegisteredActions(): string[] {
  return Object.keys(registry);
}
