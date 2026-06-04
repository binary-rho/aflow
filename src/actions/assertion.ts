import * as cdp from "@/engine/cdp";
import type { ActionFn } from "./index";

function normalizePathname(value: string): string {
  const trimmed = (value || "").trim();
  if (!trimmed) return "/";
  try {
    const url = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)
      ? new URL(trimmed)
      : new URL(trimmed.startsWith("/") ? trimmed : `/${trimmed}`, "https://flux.local");
    const path = url.pathname || "/";
    return path.replace(/\/$/, "") || "/";
  } catch {
    const withoutQuery = trimmed.replace(/[?#].*$/, "");
    const withLeadingSlash = withoutQuery.startsWith("/") ? withoutQuery : `/${withoutQuery}`;
    return withLeadingSlash.replace(/\/$/, "") || "/";
  }
}

function normalizeQueryString(value: string): string {
  const trimmed = value.trim().replace(/^[?#]/, "");
  return new URLSearchParams(trimmed).toString();
}

function matchesExpectedQuery(
  actualSearch: string,
  expectedQuery: unknown,
): boolean {
  const actual = new URLSearchParams(actualSearch);

  if (typeof expectedQuery === "string") {
    return actual.toString() === normalizeQueryString(expectedQuery);
  }

  if (expectedQuery && typeof expectedQuery === "object" && !Array.isArray(expectedQuery)) {
    return Object.entries(expectedQuery as Record<string, unknown>).every(([key, value]) => {
      if (value == null) return actual.has(key);
      return actual.get(key) === String(value);
    });
  }

  return true;
}

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
  const { selector, text, expected, expectedText } = params ?? {};
  const target = text ?? expected ?? expectedText;
  if (!selector || target == null || target === "")
    throw new Error("assert.text requires 'selector' and 'text' (or 'expected' / 'expectedText') params");

  const actual = await cdp.evaluate(
    tabId,
    `document.querySelector(${JSON.stringify(selector)})?.textContent?.trim() ?? ""`,
  );

  if (!actual.includes(target)) {
    throw new Error(
      `Assertion failed: expected text "${target}" in "${selector}", got "${actual}"`,
    );
  }
};

export const assertUrlAction: ActionFn = async (tabId, params, _options) => {
  const expectedPath = params?.expectedPath ?? params?.path ?? params?.url;
  const expectedQuery = params?.expectedQuery;

  if (!expectedPath) {
    throw new Error("assert.url requires 'expectedPath' (or 'path' / 'url') param");
  }

  const href = await cdp.evaluate(
    tabId,
    "window.location.href",
  );

  if (typeof href !== "string" || !href) {
    throw new Error("Assertion failed: could not read current URL");
  }

  const actualUrl = new URL(href);
  const actualPath = normalizePathname(actualUrl.pathname);
  const normalizedExpectedPath = normalizePathname(String(expectedPath));

  if (actualPath !== normalizedExpectedPath) {
    throw new Error(
      `Assertion failed: expected path "${normalizedExpectedPath}", got "${actualPath}"`,
    );
  }

  if (!matchesExpectedQuery(actualUrl.search, expectedQuery)) {
    throw new Error(
      `Assertion failed: expected query "${JSON.stringify(expectedQuery)}", got "${actualUrl.search || ""}"`,
    );
  }
};
