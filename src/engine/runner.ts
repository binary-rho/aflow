import * as cdp from "./cdp";
import { WAIT_PROFILES, type WaitProfile } from "./cdp";
import { executeAction, type StepResult } from "./actionRegistry";
import type { Scenario } from "@/app/data";
import { getScenarioEffectiveUrl, isSamePage } from "@/services/urlMatch";

const DEFAULT_STEP_DELAY_MS = 300;

/** stepDelay 값으로 대기 프로파일을 고른다(프리셋: fast=200, normal=1000, slow=3000). */
function waitProfileForDelay(stepDelayMs: number): WaitProfile {
  if (stepDelayMs <= 300) return WAIT_PROFILES.fast;
  if (stepDelayMs >= 2000) return WAIT_PROFILES.slow;
  return WAIT_PROFILES.normal;
}

export type RunnerStatus = "idle" | "running" | "paused" | "done" | "error";

export interface RunnerState {
  scenarioId: string;
  status: RunnerStatus;
  currentStepIndex: number;
  totalSteps: number;
  stepResults: StepResult[];
  error?: string;
  /** 체인 실행 시 1부터 (전체 체인 길이는 chainTotal) */
  chainPart?: number;
  chainTotal?: number;
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
  llmProvider?: string;
  /** 이 인덱스부터 실행을 시작합니다. 이전 스텝은 skipped 처리됩니다. */
  startFromIndex?: number;
  /** true면 첫 스텝이 nav.goto일 때 생략 (이전 시나리오 종료 후 같은 URL에서 이어 실행) */
  skipLeadingNavGoto?: boolean;
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

/** 단일 시나리오 실행. 성공 완료 시 true, 실패/중단 시 false */
export async function runScenario(
  tabId: number,
  scenario: Scenario,
  onStatus: StatusCallback,
  options?: RunScenarioOptions,
): Promise<boolean> {
  abortController = new AbortController();
  isPaused = false;
  const results: StepResult[] = [];
  const stepDelayMs = options?.stepDelayMs ?? DEFAULT_STEP_DELAY_MS;
  const waitProfile = waitProfileForDelay(stepDelayMs);
  let startFromIndex = options?.startFromIndex ?? 0;
  const firstStep = scenario.steps[0];
  if (firstStep?.actionId === "nav.goto" && startFromIndex === 0) {
    if (options?.skipLeadingNavGoto) {
      // 체인 2번째부터 등 명시적 강제 skip
      startFromIndex = 1;
    } else {
      // 자동 판단: 현재 탭이 이미 시나리오 시작 페이지면 nav.goto 생략하여
      // 본인인증 등 수동으로 만들어둔 상태를 보존
      try {
        const tab = await chrome.tabs.get(tabId);
        const currentUrl = tab?.url ?? "";
        const targetUrl = getScenarioEffectiveUrl(scenario);
        const same = !!currentUrl && !!targetUrl && isSamePage(currentUrl, targetUrl);
        console.log(`[flux] auto skip check: current="${currentUrl}" target="${targetUrl}" same=${same}`);
        if (same) {
          startFromIndex = 1;
        }
      } catch (err: any) {
        console.warn(`[flux] auto skip check failed: ${err?.message}`);
      }
    }
  }
  const onPageDomCaptured = options?.onPageDomCaptured;

  let currentTabId = tabId;
  const originalTabId = tabId;
  let pendingNewTabId: number | null = null;
  const extraAttachedTabs = new Set<number>();
  const knownTabIds = new Set<number>([tabId]);

  const onTabCreated = (tab: chrome.tabs.Tab) => {
    if (tab.id == null) return;
    knownTabIds.add(tab.id);
    // opener가 현재 탭일 때만 "시나리오 관련 새 탭"으로 간주.
    // isUnknown(=시나리오 시작 후 생긴 모든 탭)으로 잡으면 광고 popup, 외부 SDK,
    // 사용자가 백그라운드에서 직접 연 탭까지 휩쓸려 currentTabId가 엉뚱하게 옮겨간다.
    // (실제 사례: 인증 모달은 메인 탭에 있는데 클릭만 무관한 탭에서 일어나 "성공"으로 마크됨)
    if (tab.openerTabId === currentTabId) {
      pendingNewTabId = tab.id;
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

    for (let i = 0; i < startFromIndex && i < scenario.steps.length; i++) {
      results.push({ action: scenario.steps[i].actionId, status: "skipped" });
    }

    for (let i = startFromIndex; i < scenario.steps.length; i++) {
      if (abortController.signal.aborted) break;

      while (isPaused && !abortController.signal.aborted) {
        onStatus(buildState(scenario, "paused", i, results));
        await sleep(200);
      }
      if (abortController.signal.aborted) break;

      const step = scenario.steps[i];
      onStatus(buildState(scenario, "running", i, results));

      // 액션 전엔 보통 이미 안정 상태 → 가볍게만 확인(직전 waitForSettled가 안정시켜둠).
      await cdp.waitForPageReady(currentTabId, { quietMs: waitProfile.domQuietMs });

      const result = await executeAction(currentTabId, step.actionId, step.params, {
        validationOnly: options?.validationOnly,
        apiKey: options?.apiKey,
        llmProvider: options?.llmProvider,
      });
      results.push(result);

      if (result.status === "failed") {
        onStatus(buildState(scenario, "error", i, results, result.error));
        return false;
      }

      // 액션 직후: 화면이 안정될 때까지 한 번에 대기(변화시작 → networkidle → DOM quiet).
      // 강도는 속도 프리셋에 연동 — fast면 가볍게, slow면 꼼꼼히.
      await cdp.waitForSettled(currentTabId, waitProfile);
      await sleep(stepDelayMs);

      await switchToNewTabIfNeeded();

      if (onPageDomCaptured) {
        await captureCurrentPageDom(currentTabId, onPageDomCaptured);
      }
    }

    if (!abortController?.signal.aborted) {
      onStatus(buildState(scenario, "done", scenario.steps.length - 1, results));
      return true;
    }
    return false;
  } catch (err: any) {
    const message =
      err?.message?.includes("document is not defined")
        ? "이 탭에서는 시나리오를 실행할 수 없습니다. 일반 웹페이지(예: https://...) 탭을 검사한 상태에서 실행해주세요."
        : err?.message ?? String(err);
    onStatus(buildState(scenario, "error", results.length, results, message));
    return false;
  } finally {
    chrome.tabs.onCreated.removeListener(onTabCreated);
    await cdp.detachFromTab(originalTabId).catch(() => {});
    for (const tid of extraAttachedTabs) {
      await cdp.detachFromTab(tid).catch(() => {});
    }
    abortController = null;
  }
}

/** 여러 시나리오를 순서대로 실행. 2번째부터는 첫 nav.goto 생략(같은 탭 이어가기). */
export async function runScenarioChain(
  tabId: number,
  scenarios: Scenario[],
  onStatus: (state: RunnerState) => void,
  options?: RunScenarioOptions,
): Promise<void> {
  if (scenarios.length === 0) return;
  const chainTotal = scenarios.length;
  const userStart = options?.startFromIndex ?? 0;
  for (let part = 0; part < scenarios.length; part++) {
    const sc = scenarios[part];
    const skipNav = part > 0;
    const startFromIndex = part === 0 ? userStart : 0;
    const ok = await runScenario(tabId, sc, (state) => {
      onStatus({
        ...state,
        chainPart: part + 1,
        chainTotal,
      });
    }, {
      ...options,
      startFromIndex,
      skipLeadingNavGoto: skipNav,
    });
    if (!ok) return;
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
