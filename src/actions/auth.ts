import * as cdp from "@/engine/cdp";
import type { ActionFn } from "./index";

export const loginAction: ActionFn = async (tabId, params, options) => {
  if (options?.validationOnly) return;
  const role = params?.role ?? "standard_user";
  console.log(`[flux] auth.login as ${role} — needs site-specific implementation`);
  await cdp.evaluate(tabId, `console.log("flux: login as ${role}")`);
};

export const signupAction: ActionFn = async (tabId, params, options) => {
  if (options?.validationOnly) return;
  const type = params?.type ?? "new_user";
  console.log(`[flux] auth.signup type=${type} — needs site-specific implementation`);
  await cdp.evaluate(tabId, `console.log("flux: signup ${type}")`);
};
