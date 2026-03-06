import { Component, type ReactNode } from "react";
import { RouterProvider } from "react-router";
import { router } from "./routes";
import { RunButtonProvider } from "./contexts/RunButtonContext";
import "./index.css";

const CONTEXT_INVALIDATED_MSG = "Extension context invalidated";

class ErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; error: unknown }
> {
  state = { hasError: false, error: null as unknown };

  static getDerivedStateFromError(error: unknown) {
    return { hasError: true, error };
  }

  componentDidCatch(err: unknown) {
    console.error("[flux] render error:", err);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    const err = this.state.error;
    const isContextInvalidated =
      err instanceof Error && err.message.includes(CONTEXT_INVALIDATED_MSG);

    if (isContextInvalidated) {
      return (
        <div
          style={{
            padding: 24,
            fontFamily: "sans-serif",
            fontSize: 13,
            maxWidth: 320,
            lineHeight: 1.5,
          }}
        >
          <p style={{ color: "#b91c1c", fontWeight: 600, marginBottom: 8 }}>
            확장 프로그램이 새로고침되었습니다
          </p>
          <p style={{ color: "#555", margin: 0 }}>
            개발자 도구를 <strong>닫았다가 다시 열고</strong>, flux 탭을 다시 클릭해주세요.
          </p>
        </div>
      );
    }

    return (
      <div style={{ padding: 16, fontFamily: "sans-serif", fontSize: 13 }}>
        <p style={{ color: "#b91c1c", fontWeight: 600 }}>오류가 발생했습니다.</p>
        <p style={{ color: "#666", marginTop: 8 }}>
          개발자 도구 콘솔을 확인해주세요. (패널 우클릭 → 검사)
        </p>
      </div>
    );
  }
}

function App() {
  return (
    <ErrorBoundary>
      <RunButtonProvider>
        <RouterProvider router={router} />
      </RunButtonProvider>
    </ErrorBoundary>
  );
}

export default App;
