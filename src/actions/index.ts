import { gotoAction, waitAction, scrollToAction, scrollByAction } from "./navigation";
import { loginAction, signupAction } from "./auth";
import { clickButtonAction, fillFormAction, gnbClickLoginAction, hoverAction, selectOptionAction, checkAction, keypressAction } from "./interaction";
import {
  assertVisibleAction,
  assertHiddenAction,
  assertTextAction,
} from "./assertion";

export type ActionFn = (
  tabId: number,
  params?: Record<string, any>,
  options?: { validationOnly?: boolean; apiKey?: string; llmProvider?: string },
) => Promise<void>;

const registry: Record<string, ActionFn> = {
  "nav.goto": gotoAction,
  "nav.wait": waitAction,
  "scroll.to": scrollToAction,
  "scroll.by": scrollByAction,
  "auth.login": loginAction,
  "auth.signup": signupAction,
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
  "form.select_dropdown": selectOptionAction,
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
