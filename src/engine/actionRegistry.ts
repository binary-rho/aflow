import { getAction, isActionImplemented, type ActionFn, type ActionCandidate } from "@/actions";

export type StepResult = {
  action: string;
  status: "success" | "failed" | "skipped";
  error?: string;
  /** 매칭 전략 (selector-validated / matcher-fast-path / matcher-llm / matcher-cache / text-with-context / text-only) */
  strategy?: string;
  /** 최종적으로 사용된 selector */
  selector?: string;
  /** 액션 소요시간 (ms) */
  durationMs?: number;
  /** AI/코드가 확신 못 해 첫 후보로 진행 → 사후확인 대상 */
  ambiguous?: boolean;
  /** 사후확인에 보여줄 후보 목록 */
  candidates?: ActionCandidate[];
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

  const startedAt = Date.now();
  try {
    const meta = await fn(tabId, params, options);
    const durationMs = Date.now() - startedAt;
    return {
      action,
      status: "success",
      strategy: meta?.strategy,
      selector: meta?.selector,
      durationMs,
      ambiguous: meta?.ambiguous,
      candidates: meta?.candidates,
    };
  } catch (err: any) {
    return {
      action,
      status: "failed",
      error: err.message,
      durationMs: Date.now() - startedAt,
    };
  }
}

export { isActionImplemented };
