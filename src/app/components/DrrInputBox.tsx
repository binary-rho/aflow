import { useCallback, useRef } from "react";
import { Wand2 } from "lucide-react";
import { cn } from "../../lib/utils";
import { InfoMessage } from "./InfoMessage";
import { Button } from "./ui/button";

const DRR_PLACEHOLDER = `[작성 가이드]
• 내용 먼저 쓰고, 칩을 눌러 텍스트 뒤에 태그를 붙이세요 (예: 신청하기[button])
• 단계는 "단계 >" 칩 또는 줄바꿈으로 구분하세요
• 클릭 문구는 DOM에 보이는 실제 텍스트 그대로 쓰세요
• 페이지 이동/도메인/GNB/팝업은 전용 칩(nav/domain/gnb/popup)을 쓰면 정확도가 올라갑니다

[예시]
stg.lguplus.com[domain]
/mobile[nav] > 휴대폰[gnb-main] > 아이폰 17 Pro[context] > 신청하기[button]
이메일[form] test@email.com > 비밀번호[form] test1234
로그인[gnb]`;

const TOKEN_CHIPS = [
  { label: "단계 >", kind: "separator", suffix: " > " },
  { label: "버튼", kind: "tag", suffix: "[button]" },
  { label: "입력", kind: "tag", suffix: "[form]" },
  { label: "맥락", kind: "tag", suffix: "[context]" },
  { label: "이동", kind: "tag", suffix: "[nav]" },
  { label: "GNB 대", kind: "tag", suffix: "[gnb-main]" },
  { label: "GNB 소", kind: "tag", suffix: "[gnb-sub]" },
  { label: "GNB 로그인", kind: "tag", suffix: "[gnb]" },
  { label: "팝업", kind: "tag", suffix: "[popup]" },
  { label: "도메인", kind: "tag", suffix: "[domain]" },
] as const;

interface DrrInputBoxProps {
  value: string;
  onChange: (value: string) => void;
  onConvert: () => void;
  isAnalyzing: boolean;
}

export function DrrInputBox({
  value,
  onChange,
  onConvert,
  isAnalyzing,
}: DrrInputBoxProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const insertToken = useCallback(
    (chip: (typeof TOKEN_CHIPS)[number]) => {
      const textarea = textareaRef.current;
      const cursorPos = textarea?.selectionStart ?? value.length;
      const savedScrollTop = textarea?.scrollTop ?? 0;
      const before = value.slice(0, cursorPos);
      const after = value.slice(cursorPos);
      const nextValue = `${before}${chip.suffix}${after}`;
      const nextCursor = cursorPos + chip.suffix.length;
      onChange(nextValue);
      if (!textarea) return;
      requestAnimationFrame(() => {
        textarea.focus();
        textarea.setSelectionRange(nextCursor, nextCursor);
        textarea.scrollTop = savedScrollTop;
      });
    },
    [onChange, value],
  );

  return (
    <div className="relative group bg-[var(--flux-bg-subtle)] border border-[var(--flux-border)] rounded-xl focus-within:bg-white focus-within:ring-1 focus-within:ring-[var(--flux-ring)] transition-all shadow-inner overflow-hidden z-10 flex flex-col h-48">
      <div className="flex flex-wrap items-center gap-1 px-3 pt-2 pb-1 border-b border-[var(--flux-border-light)]">
        {TOKEN_CHIPS.map((token) => (
          <button
            key={token.label}
            type="button"
            className="px-1.5 py-0.5 text-[10px] font-semibold rounded-md border border-[var(--flux-border)] text-[var(--flux-text-muted)] hover:text-[var(--flux-primary)] hover:border-[var(--flux-primary)] bg-white/70 transition-colors whitespace-nowrap"
            onClick={() => insertToken(token)}
          >
            {token.label}
          </button>
        ))}
      </div>
      <textarea
        ref={textareaRef}
        className="w-full flex-1 p-3 bg-transparent border-none text-xs text-[var(--flux-text-default)] outline-none transition-all resize-none leading-relaxed placeholder:text-[var(--flux-text-muted)] font-normal font-mono mb-0"
        placeholder={DRR_PLACEHOLDER}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />

      {/* Bottom bar: info at container bottom (baseline), button on right */}
      <div className="flex items-end justify-between px-3 py-2 bg-transparent shrink-0 mt-auto gap-3">
        <InfoMessage
          message="칩으로 [관련 정보]를 넣으면 변환 정확도가 올라갑니다."
          className="self-end"
        />
        <Button
          variant="brand"
          size="sm"
          onClick={onConvert}
          disabled={isAnalyzing || !value.trim()}
          className={cn(
            "flex items-center gap-1 rounded-lg font-bold text-[11px] shadow-sm active:scale-95 shrink-0",
            isAnalyzing && "cursor-wait opacity-80",
          )}
        >
          {isAnalyzing ? (
            <Wand2 className="!size-3 animate-spin" />
          ) : (
            <Wand2 className="!size-3" />
          )}
          {isAnalyzing ? "분석 중..." : "변환하기"}
        </Button>
      </div>
    </div>
  );
}
