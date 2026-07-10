import type { Scenario } from "./app/data";
import {
  runScenario,
  runScenarioChain,
  pauseRunner,
  resumeRunner,
  cancelRunner,
} from "./engine/runner";
import { startRecording, stopRecording, type RecordedEvent } from "./engine/recorder";
import {
  appendLastRunDomSnapshot,
  clearLastRunDomSnapshots,
} from "./stores/domCaptureStore";
import * as cdp from "./engine/cdp";

type MessageType =
  | { type: "PING" }
  | { type: "GET_INSPECTED_TAB_URL"; tabId: number }
  | { type: "GET_ACTIVE_TAB_URL" }
  | { type: "NAVIGATE_ACTIVE_TAB"; url: string }
  | { type: "EVAL_DOM_SCRIPT"; tabId: number; script: string }
  | {
      type: "RUN_SCENARIO";
      scenario: Scenario;
      /** 있으면 체인 실행(2번째부터 첫 nav.goto 생략). 없으면 scenario 단일 실행 */
      scenarios?: Scenario[];
      tabId: number;
      stepDelayMs?: number;
      validationOnly?: boolean;
      apiKey?: string;
      llmProvider?: string;
      startFromIndex?: number;
    }
  | { type: "START_RECORDING"; tabId: number }
  | { type: "STOP_RECORDING"; tabId: number }
  | { type: "PAUSE" }
  | { type: "RESUME" }
  | { type: "CANCEL" }
  | { type: "GET_TAB_CAPTURE_STREAM_ID"; tabId: number };

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

const RECORDING_TAG = "직접생성";
const RECORDED_TITLE_MAX_HOST_LENGTH = 20;
const RECORDED_TITLE_MAX_ACTION_LENGTH = 26;
const RECORDED_TITLE_FALLBACK = "직접 생성 시나리오";

function toHost(url: string): string {
  try {
    return new URL(url).host || "";
  } catch {
    return "";
  }
}

function toPath(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname || "/"}${parsed.search}${parsed.hash}`;
  } catch {
    return "/";
  }
}

function truncateText(value: string, maxLength: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength)}...`;
}

function buildRecordedScenarioTitle(startUrl: string, logs: RecordedEvent[]): string {
  const titleTime = new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
  const hostLabel = truncateText(toHost(startUrl).replace(/^www\./, ""), RECORDED_TITLE_MAX_HOST_LENGTH);

  const firstClick = logs.find((log) => log.type === "click" && log.text?.trim());
  const firstInput = logs.find((log) => log.type === "input" && log.label?.trim());
  const firstNav = logs.find((log) => log.type === "nav" && log.url?.trim());
  const firstScroll = logs.find((log) => log.type === "scroll");
  const firstHover = logs.find((log) => log.type === "hover" && log.text?.trim());
  const firstSelect = logs.find((log) => log.type === "select" && log.label?.trim());
  const firstCheck = logs.find((log) => log.type === "check" && log.label?.trim());
  const firstKey = logs.find((log) => log.type === "keypress" && log.key?.trim());

  let actionLabel = "";
  if (firstClick && firstClick.type === "click") {
    actionLabel = `${firstClick.text.trim()} 클릭`;
  } else if (firstInput && firstInput.type === "input") {
    actionLabel = `${firstInput.label.trim()} 입력`;
  } else if (firstNav && firstNav.type === "nav") {
    actionLabel = `${toPath(firstNav.url)} 이동`;
  } else if (firstHover && firstHover.type === "hover") {
    actionLabel = `${firstHover.text.trim()} 호버`;
  } else if (firstSelect && firstSelect.type === "select") {
    actionLabel = `${firstSelect.label.trim()} 선택`;
  } else if (firstCheck && firstCheck.type === "check") {
    actionLabel = `${firstCheck.label.trim()} 클릭`;
  } else if (firstKey && firstKey.type === "keypress") {
    actionLabel = `${firstKey.key} 키 입력`;
  } else if (firstScroll && firstScroll.type === "scroll") {
    actionLabel = `스크롤(y:${Math.round(firstScroll.y)})`;
  }

  const safeActionLabel = truncateText(actionLabel, RECORDED_TITLE_MAX_ACTION_LENGTH);
  if (hostLabel && safeActionLabel) return `${hostLabel} · ${safeActionLabel} ${titleTime}`;
  if (hostLabel) return `${hostLabel} · ${RECORDED_TITLE_FALLBACK} ${titleTime}`;
  if (safeActionLabel) return `${safeActionLabel} ${titleTime}`;
  return `${RECORDED_TITLE_FALLBACK} ${titleTime}`;
}

function mergeConsecutiveScrolls(logs: RecordedEvent[]): RecordedEvent[] {
  const result: RecordedEvent[] = [];
  let lastScroll: RecordedEvent | null = null;
  for (const log of logs) {
    if (log.type === "scroll") {
      lastScroll = log;
      continue;
    }
    if (lastScroll) {
      result.push(lastScroll);
      lastScroll = null;
    }
    result.push(log);
  }
  if (lastScroll) result.push(lastScroll);
  return result;
}

function buildScenarioFromRecorded(
  startUrl: string,
  logs: RecordedEvent[],
): Scenario {
  const host = toHost(startUrl);
  const path = toPath(startUrl);

  const steps: Scenario["steps"] = [];
  // 직전 step과 동일한 액션이라도 이 시간 이상 떨어졌으면 "의도된 별개 동작"으로 보고 추가한다.
  // (예: 같은 "확인했어요" 모달이 연속으로 두 번 떠서 두 번 누르는 케이스)
  // 이보다 짧으면 우발적 더블클릭/중복 이벤트로 보고 dedup.
  const DEDUP_WINDOW_MS = 500;
  let lastStepTs: number | null = null;
  const addStep = (
    actionId: string,
    params: Record<string, any> = {},
    description?: string,
    ts?: number,
  ) => {
    const prev = steps[steps.length - 1];
    const isSameAsPrev =
      prev &&
      prev.actionId === actionId &&
      JSON.stringify(prev.params || {}) === JSON.stringify(params || {});
    if (isSameAsPrev) {
      const withinWindow =
        ts == null || lastStepTs == null || ts - lastStepTs < DEDUP_WINDOW_MS;
      if (withinWindow) return;
    }
    const id = `s${steps.length + 1}`;
    steps.push({ id, actionId, params, description });
    if (ts != null) lastStepTs = ts;
  };

  addStep("nav.goto", { url: path }, "현재 페이지로 이동합니다.");

  const NAV_AFTER_CLICK_THRESHOLD_MS = 3000;

  const mergedLogs = mergeConsecutiveScrolls(logs);

  mergedLogs.forEach((log, index) => {
    if (log.type === "nav") {
      const navUrl = (log.url || "").trim();
      if (!navUrl) return;

      const prev = index > 0 ? mergedLogs[index - 1] : null;
      const isNavCausedByClick =
        prev &&
        (prev.type === "click" || prev.type === "hover") &&
        log.ts - prev.ts < NAV_AFTER_CLICK_THRESHOLD_MS;
      if (isNavCausedByClick) return;

      const navPath = toPath(navUrl);
      addStep("nav.goto", { url: navPath }, `${navPath} 페이지로 이동합니다.`, log.ts);
      return;
    }

    if (log.type === "click") {
      const clickText = (log.text || "").trim();
      const clickSelector = (log.selector || "").trim();
      if (!clickText && !clickSelector) return;

      const params: Record<string, any> = {};
      if (clickText) params.text = clickText;
      if (clickSelector) params.selector = clickSelector;
      if (log.context) params.context = log.context;
      const clickDesc = clickText
        ? `${clickText} 버튼을 클릭합니다.`
        : `${clickSelector} 요소를 클릭합니다.`;
      addStep("button.click", params, clickDesc, log.ts);
      return;
    }

    if (log.type === "scroll") {
      const y = Number(log.y);
      if (!Number.isFinite(y)) return;
      const x = Number(log.x);
      const params: Record<string, any> = { y: Math.max(0, Math.round(y)) };
      if (Number.isFinite(x) && x > 0) params.x = Math.round(x);
      addStep("scroll.to", params, `페이지를 아래로 스크롤합니다. (y:${params.y})`, log.ts);
      return;
    }

    if (log.type === "input") {
      const label = (log.label || "").trim();
      const inputSelector = (log.selector || "").trim();
      if (!label && !inputSelector) return;
      const params: Record<string, any> = { value: log.value };
      if (label) params.label = label;
      if (inputSelector) params.selector = inputSelector;
      if (log.context) params.context = log.context;
      const fillDesc = label
        ? `${label} 값을 입력합니다.`
        : `${inputSelector} 필드에 값을 입력합니다.`;
      addStep("form.fill", params, fillDesc, log.ts);
      return;
    }

    if (log.type === "hover") {
      const hoverText = (log.text || "").trim();
      const hoverSelector = (log.selector || "").trim();
      if (!hoverText && !hoverSelector) return;
      const params: Record<string, any> = {};
      if (hoverText) params.text = hoverText;
      if (hoverSelector) params.selector = hoverSelector;
      if (log.context) params.context = log.context;
      const hoverDesc = hoverText
        ? `${hoverText} 요소에 마우스를 올립니다.`
        : `${hoverSelector} 요소에 마우스를 올립니다.`;
      addStep("interaction.hover", params, hoverDesc, log.ts);
      return;
    }

    if (log.type === "select") {
      const selectLabel = (log.label || "").trim();
      const selectSelector = (log.selector || "").trim();
      if (!selectLabel && !selectSelector) return;
      const params: Record<string, any> = { value: log.value };
      if (selectLabel) params.label = selectLabel;
      if (log.optionText) params.optionText = log.optionText;
      if (selectSelector) params.selector = selectSelector;
      if (log.context) params.context = log.context;
      const selectDesc = selectLabel
        ? `${selectLabel}에서 ${log.optionText || log.value}을(를) 선택합니다.`
        : `${selectSelector}에서 값을 선택합니다.`;
      addStep("form.select", params, selectDesc, log.ts);
      return;
    }

    if (log.type === "check") {
      const chkLabel = (log.label || "").trim();
      const chkSelector = (log.selector || "").trim();
      if (!chkLabel && !chkSelector) return;
      const params: Record<string, any> = {};
      if (log.clickOnly === true) {
        params.clickOnly = true;
      } else if (typeof log.checked === "boolean") {
        params.checked = log.checked;
      } else {
        params.clickOnly = true;
      }
      if (chkLabel) params.label = chkLabel;
      if (chkSelector) params.selector = chkSelector;
      if (log.context) params.context = log.context;
      const chkDesc = (() => {
        if (params.clickOnly) {
          return chkLabel
            ? `${chkLabel} 항목을 클릭합니다.`
            : `${chkSelector} 항목을 클릭합니다.`;
        }
        const on = log.checked === true;
        return chkLabel
          ? `${chkLabel} 항목을 ${on ? "체크" : "해제"}합니다.`
          : `${chkSelector} 항목을 ${on ? "체크" : "해제"}합니다.`;
      })();
      addStep("form.check", params, chkDesc, log.ts);
      return;
    }

    if (log.type === "keypress") {
      const key = (log.key || "").trim();
      if (!key) return;
      const keyLabel: Record<string, string> = { Enter: "엔터", Escape: "ESC", Tab: "탭" };
      const params: Record<string, any> = { key };
      if (log.selector) params.selector = log.selector;
      addStep("keyboard.press", params, `${keyLabel[key] || key} 키를 입력합니다.`, log.ts);
    }
  });

  const recordedTitle = buildRecordedScenarioTitle(startUrl, logs);
  return {
    id: `sc_recorded_${Date.now()}`,
    title: recordedTitle,
    description: "사용자 동작 수집으로 생성된 시나리오",
    tags: [RECORDING_TAG],
    urlPattern: host,
    steps,
    createdAt: new Date().toISOString().slice(0, 10),
  };
}

chrome.runtime.onMessage.addListener(
  (message: MessageType, _sender, sendResponse) => {
    switch (message.type) {
      case "PING":
        sendResponse({ ok: true });
        return true;

      case "GET_INSPECTED_TAB_URL": {
        chrome.tabs.get(message.tabId, (tab) => {
          sendResponse({ url: tab?.url ?? "" });
        });
        return true;
      }

      case "GET_ACTIVE_TAB_URL": {
        chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
          const tab = tabs?.find((t) => t.url && !t.url.startsWith("chrome"));
          sendResponse({ url: tab?.url ?? "", tabId: tab?.id ?? null });
        });
        return true;
      }

      case "NAVIGATE_ACTIVE_TAB": {
        const targetUrl = message.url;
        chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
          const tab = tabs?.find((t) => t.url && !t.url.startsWith("chrome"));
          if (tab?.id == null) {
            sendResponse({ ok: false, error: "활성 탭을 찾을 수 없습니다." });
            return;
          }
          chrome.tabs.update(tab.id, { url: targetUrl }, () => {
            sendResponse({ ok: true });
          });
        });
        return true;
      }

      case "EVAL_DOM_SCRIPT": {
        (async () => {
          const wasAlreadyAttached = cdp.isAttached(message.tabId);
          try {
            await cdp.attachToTab(message.tabId);
            const result = await cdp.evaluate(message.tabId, message.script);
            sendResponse({ ok: true, result });
          } catch (err: any) {
            sendResponse({ ok: false, error: err?.message ?? String(err) });
          } finally {
            if (!wasAlreadyAttached) {
              try { await cdp.detachFromTab(message.tabId); } catch {}
            }
          }
        })();
        return true;
      }

      case "RUN_SCENARIO": {
        const { scenario, scenarios, tabId, stepDelayMs, validationOnly, apiKey, llmProvider, startFromIndex } =
          message;
        const chain =
          scenarios && scenarios.length > 0 ? scenarios : [scenario];
        function broadcastStatus(state: unknown) {
          chrome.runtime.sendMessage({ type: "RUNNER_STATUS", state }).catch(() => {});
        }
        clearLastRunDomSnapshots().catch(() => {});
        function handlePageDomCaptured(payload: { label: string; summary: string }) {
          appendLastRunDomSnapshot(payload).catch(() => {});
        }
        const opts = {
          stepDelayMs,
          validationOnly,
          apiKey,
          llmProvider,
          startFromIndex,
          onPageDomCaptured: handlePageDomCaptured,
        };
        const runPromise =
          chain.length > 1
            ? runScenarioChain(tabId, chain, broadcastStatus as (s: import("./engine/runner").RunnerState) => void, opts)
            : runScenario(tabId, chain[0], broadcastStatus as (s: import("./engine/runner").RunnerState) => void, opts);
        runPromise.catch((err: Error) => {
          console.error("[flux] run error:", err);
          const msg =
            err?.message?.includes("document is not defined")
              ? "이 탭에서는 시나리오를 실행할 수 없습니다. 일반 웹페이지 탭에서 실행해주세요."
              : err?.message ?? String(err);
          broadcastStatus({
            scenarioId: scenario.id,
            status: "error",
            currentStepIndex: -1,
            totalSteps: scenario.steps.length,
            stepResults: [],
            error: msg,
          });
        });
        sendResponse({ started: true });
        return true;
      }

      case "START_RECORDING": {
        startRecording(message.tabId)
          .then(() => sendResponse({ ok: true }))
          .catch((err: Error) => sendResponse({ ok: false, error: err?.message ?? "수집 시작 실패" }));
        return true;
      }

      case "STOP_RECORDING": {
        stopRecording(message.tabId)
          .then((result) => {
            console.log("[flux recording] total logs:", result.logs?.length ?? 0);
            (result.logs || []).forEach((log, i) => {
              console.log(`[flux recording] log[${i}] ${log.type}:`, JSON.stringify(log).slice(0, 200));
            });
            const scenario = buildScenarioFromRecorded(result.startUrl || "", result.logs || []);
            console.log("[flux recording] built scenario steps:", scenario.steps.length);
            scenario.steps.forEach((s, i) => {
              console.log(`[flux recording] step[${i}] ${s.actionId}:`, JSON.stringify(s.params).slice(0, 150));
            });
            sendResponse({
              ok: true,
              scenario,
              recordedCount: result.logs?.length ?? 0,
            });
          })
          .catch((err: Error) => sendResponse({ ok: false, error: err?.message ?? "수집 종료 실패" }));
        return true;
      }

      case "PAUSE":
        pauseRunner();
        sendResponse({ ok: true });
        return true;

      case "RESUME":
        resumeRunner();
        sendResponse({ ok: true });
        return true;

      case "CANCEL":
        cancelRunner();
        sendResponse({ ok: true });
        return true;

      case "GET_TAB_CAPTURE_STREAM_ID": {
        const targetTabId = message.tabId as number;
        (async () => {
          try {
            await chrome.tabs.update(targetTabId, { active: true });
          } catch { /* ignore */ }

          chrome.tabCapture.getMediaStreamId(
            {},
            (streamId) => {
              if (chrome.runtime.lastError || !streamId) {
                sendResponse({ ok: false, error: chrome.runtime.lastError?.message || "탭 캡처 ID를 가져오지 못했습니다." });
              } else {
                sendResponse({ ok: true, streamId });
              }
            },
          );
        })();
        return true;
      }

      default:
        return false;
    }
  },
);

console.log("[flux] background service worker loaded");
