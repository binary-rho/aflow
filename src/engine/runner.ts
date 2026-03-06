import * as cdp from "./cdp";
import { executeAction, type StepResult } from "./actionRegistry";
import type { Scenario } from "@/app/data";

const DEFAULT_STEP_DELAY_MS = 300;

export type RunnerStatus = "idle" | "running" | "paused" | "done" | "error";

export interface RunnerState {
  scenarioId: string;
  status: RunnerStatus;
  currentStepIndex: number;
  totalSteps: number;
  stepResults: StepResult[];
  error?: string;
}

export interface PageDomCapturePayload {
  label: string;
  summary: string;
}

type StatusCallback = (state: RunnerState) => void;

let abortController: AbortController | null = null;
let isPaused = false;

function buildState(
  scenario: Scenario,
  status: RunnerStatus,
  stepIndex: number,
  results: StepResult[],
  error?: string,
): RunnerState {
  return {
    scenarioId: scenario.id,
    status,
    currentStepIndex: stepIndex,
    totalSteps: scenario.steps.length,
    stepResults: results,
    error,
  };
}

export interface RunScenarioOptions {
  stepDelayMs?: number;
  validationOnly?: boolean;
  apiKey?: string;
  /** 시나리오 실행 중 방문하는 각 페이지 DOM을 캡처할 때 호출됩니다. */
  onPageDomCaptured?: (payload: PageDomCapturePayload) => void;
}

async function captureCurrentPageDom(
  tabId: number,
  onPageDomCaptured: (payload: PageDomCapturePayload) => void,
): Promise<void> {
  const summary = await cdp.captureDOMSnapshot(tabId);
  if (!summary) return;
  let label = "페이지";
  try {
    const obj = JSON.parse(summary) as { path?: string; title?: string | null; h1?: string | null; modalPhrases?: string[] };
    const path = (obj.path || "/").trim();
    label = path === "/" ? "홈" : path;
    const titleOrH1 = obj.title || obj.h1;
    if (titleOrH1) label += " | " + String(titleOrH1).slice(0, 60);
    if (Array.isArray(obj.modalPhrases) && obj.modalPhrases.length > 0) label += " (modal)";
  } catch {
    // keep default label
  }
  onPageDomCaptured({ label, summary });
}

const NEW_TAB_WAIT_MS = 5000;
const NEW_TAB_POLL_MS = 200;

export async function runScenario(
  tabId: number,
  scenario: Scenario,
  onStatus: StatusCallback,
  options?: RunScenarioOptions,
): Promise<void> {
  abortController = new AbortController();
  isPaused = false;
  const results: StepResult[] = [];
  const stepDelayMs = options?.stepDelayMs ?? DEFAULT_STEP_DELAY_MS;
  const onPageDomCaptured = options?.onPageDomCaptured;

  let currentTabId = tabId;
  const originalTabId = tabId;
  let pendingNewTabId: number | null = null;
  const extraAttachedTabs = new Set<number>();
  const knownTabIds = new Set<number>([tabId]);

  const onTabCreated = (tab: chrome.tabs.Tab) => {
    if (tab.id == null) return;
    const isFromCurrentTab = tab.openerTabId === currentTabId;
    const isUnknown = !knownTabIds.has(tab.id);
    if (isFromCurrentTab || isUnknown) {
      pendingNewTabId = tab.id;
      knownTabIds.add(tab.id);
    }
  };
  chrome.tabs.onCreated.addListener(onTabCreated);

  async function switchToNewTabIfNeeded(): Promise<void> {
    if (pendingNewTabId == null) return;
    const newTabId = pendingNewTabId;
    pendingNewTabId = null;

    let ready = false;
    const deadline = Date.now() + NEW_TAB_WAIT_MS;
    while (Date.now() < deadline) {
      try {
        const tab = await chrome.tabs.get(newTabId);
        if (tab.status === "complete") { ready = true; break; }
      } catch { break; }
      await sleep(NEW_TAB_POLL_MS);
    }
    if (!ready) {
      await sleep(1000);
    }

    try {
      await cdp.attachToTab(newTabId);
      extraAttachedTabs.add(newTabId);
      currentTabId = newTabId;
      await chrome.tabs.update(newTabId, { active: true });
    } catch {
      // couldn't attach to new tab, keep using current
    }
  }

  onStatus(buildState(scenario, "running", -1, results));

  try {
    const existingTabs = await chrome.tabs.query({});
    for (const t of existingTabs) {
      if (t.id != null) knownTabIds.add(t.id);
    }

    await cdp.attachToTab(currentTabId);

    const docType = await cdp.evaluate(currentTabId, "typeof document");
    if (docType !== "object") {
      throw new Error(
        "이 탭에서는 document를 사용할 수 없습니다. 일반 웹페이지 탭에서 시나리오를 실행해주세요. (chrome://, edge://, 확장 프로그램 페이지에서는 실행 불가)",
      );
    }

    if (onPageDomCaptured) {
      await captureCurrentPageDom(currentTabId, onPageDomCaptured);
    }

    for (let i = 0; i < scenario.steps.length; i++) {
      if (abortController.signal.aborted) break;

      while (isPaused && !abortController.signal.aborted) {
        onStatus(buildState(scenario, "paused", i, results));
        await sleep(200);
      }
      if (abortController.signal.aborted) break;

      const step = scenario.steps[i];
      onStatus(buildState(scenario, "running", i, results));

      const result = await executeAction(currentTabId, step.actionId, step.params, {
        validationOnly: options?.validationOnly,
        apiKey: options?.apiKey,
      });
      results.push(result);

      if (result.status === "failed") {
        onStatus(buildState(scenario, "error", i, results, result.error));
        return;
      }

      await sleep(stepDelayMs);

      await switchToNewTabIfNeeded();

      if (onPageDomCaptured) {
        await captureCurrentPageDom(currentTabId, onPageDomCaptured);
      }
    }

    if (!abortController?.signal.aborted) {
      onStatus(buildState(scenario, "done", scenario.steps.length - 1, results));
    }
  } catch (err: any) {
    const message =
      err?.message?.includes("document is not defined")
        ? "이 탭에서는 시나리오를 실행할 수 없습니다. 일반 웹페이지(예: https://...) 탭을 검사한 상태에서 실행해주세요."
        : err?.message ?? String(err);
    onStatus(buildState(scenario, "error", results.length, results, message));
  } finally {
    chrome.tabs.onCreated.removeListener(onTabCreated);
    await cdp.detachFromTab(originalTabId).catch(() => {});
    for (const tid of extraAttachedTabs) {
      await cdp.detachFromTab(tid).catch(() => {});
    }
    abortController = null;
  }
}

export function pauseRunner(): void {
  isPaused = true;
}

export function resumeRunner(): void {
  isPaused = false;
}

export function cancelRunner(): void {
  abortController?.abort();
  isPaused = false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
