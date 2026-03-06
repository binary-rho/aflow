import * as cdp from "@/engine/cdp";
import type { ActionFn } from "./index";

export const assertVisibleAction: ActionFn = async (tabId, params, _options) => {
  const target = params?.target || params?.selector || params?.text;
  if (!target) throw new Error("assert.visible requires 'target', 'selector', or 'text' param");

  const visible = await cdp.evaluate(
    tabId,
    `(() => {
      const el = document.querySelector(${JSON.stringify(target)});
      return el !== null && el.offsetParent !== null;
    })()`,
  );

  if (!visible) throw new Error(`Assertion failed: "${target}" is not visible`);
};

export const assertHiddenAction: ActionFn = async (tabId, params, _options) => {
  const target = params?.target || params?.selector || params?.text;
  if (!target) throw new Error("assert.hidden requires 'target', 'selector', or 'text' param");

  const found = await cdp.evaluate(
    tabId,
    `(() => {
      const el = document.querySelector(${JSON.stringify(target)});
      return el !== null && el.offsetParent !== null;
    })()`,
  );

  if (found) throw new Error(`Assertion failed: "${target}" should be hidden but is visible`);
};

export const assertTextAction: ActionFn = async (tabId, params, _options) => {
  const { selector, text } = params ?? {};
  if (!selector || !text) throw new Error("assert.text requires 'selector' and 'text' params");

  const actual = await cdp.evaluate(
    tabId,
    `document.querySelector(${JSON.stringify(selector)})?.textContent?.trim() ?? ""`,
  );

  if (!actual.includes(text)) {
    throw new Error(`Assertion failed: expected text "${text}" in "${selector}", got "${actual}"`);
  }
};
