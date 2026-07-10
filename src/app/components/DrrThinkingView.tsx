import { useEffect, useRef } from "react";
import { Wand2, X } from "lucide-react";

interface DrrThinkingViewProps {
  /** 지금까지 스트리밍된 누적 추론(reasoning) 텍스트 */
  text: string;
  /** 취소 버튼 클릭 시 호출 (진행 중인 변환을 중단하고 입력창으로 복귀) */
  onCancel: () => void;
}

const THINKING_PLACEHOLDER = "AI가 응답을 준비하고 있어요…";

/**
 * DRR→DSL 변환 중, 입력창 자리에서 LLM의 추론(reasoning)을 실시간으로 흘려 보여준다.
 * 새 토큰이 들어올 때마다 스크롤을 하단에 고정한다.
 */
export function DrrThinkingView({ text, onCancel }: DrrThinkingViewProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [text]);

  return (
    <div className="relative bg-[var(--flux-bg-subtle)] border border-[var(--flux-border)] rounded-xl overflow-hidden z-10 flex flex-col h-48">
      <div className="flex items-center justify-between gap-2 px-3 pt-2.5 pb-2 border-b border-[var(--flux-border-light)]">
        <div className="flex items-center gap-1.5 text-[11px] font-bold text-[var(--flux-primary)] min-w-0">
          <Wand2 className="!size-3 animate-spin shrink-0" />
          <span className="truncate">AI가 시나리오를 작성 중…</span>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-md border border-[var(--flux-border)] text-[var(--flux-text-muted)] hover:text-red-600 hover:border-red-300 hover:bg-red-50 transition-colors shrink-0"
        >
          <X className="!size-3" />
          취소
        </button>
      </div>
      <div
        ref={scrollRef}
        className="w-full flex-1 p-3 overflow-y-auto text-[11px] leading-relaxed text-[var(--flux-text-muted)] whitespace-pre-wrap break-words font-mono"
      >
        {text || THINKING_PLACEHOLDER}
      </div>
    </div>
  );
}
