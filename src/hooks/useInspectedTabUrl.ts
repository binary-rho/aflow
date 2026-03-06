import { useState, useEffect, useRef, useCallback } from "react";

const fallbackHost = "localhost";
const fallbackPath = "/";
const URL_POLL_INTERVAL_MS = 1500;

/**
 * 현재 활성 탭의 URL을 추적합니다.
 * Side Panel / DevTools 모두 동작합니다.
 */
export function useInspectedTabUrl(): {
  currentDomain: string;
  currentPath: string;
  currentFullUrl: string;
} {
  const [url, setUrl] = useState<string | null>(null);
  const prevUrlRef = useRef<string | null>(null);

  const fetchUrl = useCallback(() => {
    try {
      chrome.runtime.sendMessage(
        { type: "GET_ACTIVE_TAB_URL" },
        (response: { url?: string } | undefined) => {
          const newUrl = response?.url ?? null;
          if (newUrl !== prevUrlRef.current) {
            prevUrlRef.current = newUrl;
            setUrl(newUrl);
          }
        },
      );
    } catch {
      // extension context invalidated
    }
  }, []);

  useEffect(() => {
    fetchUrl();
    const id = setInterval(fetchUrl, URL_POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchUrl]);

  if (url != null && url !== "") {
    try {
      const u = new URL(url);
      return {
        currentDomain: u.host || fallbackHost,
        currentPath: u.pathname || fallbackPath,
        currentFullUrl: (u.host || fallbackHost) + (u.pathname || fallbackPath),
      };
    } catch {
      // invalid url
    }
  }

  return {
    currentDomain: fallbackHost,
    currentPath: fallbackPath,
    currentFullUrl: fallbackHost + fallbackPath,
  };
}
