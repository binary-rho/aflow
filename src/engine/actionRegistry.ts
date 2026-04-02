import { getAction, isActionImplemented, type ActionFn } from "@/actions";

export type StepResult = {
  action: string;
  status: "success" | "failed" | "skipped";
  error?: string;
};

export type ExecuteActionOptions = { validationOnly?: boolean; apiKey?: string; llmProvider?: string };

export async function executeAction(
  tabId: number,
  action: string,
  params?: Record<string, any>,
  options?: ExecuteActionOptions,
): Promise<StepResult> {
  const fn = getAction(action);

  if (!fn) {
    console.warn(
      `[flux] Action "${action}" is not implemented. Skipping.`,
    );
    return { action, status: "skipped", error: `Not implemented: ${action}` };
  }

  try {
    await fn(tabId, params, options);
    return { action, status: "success" };
  } catch (err: any) {
    return { action, status: "failed", error: err.message };
  }
}

export { isActionImplemented };
