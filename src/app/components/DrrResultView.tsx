import { useState, useCallback } from "react";
import { Braces, Copy, Save, Check } from "lucide-react";
import { Button } from "./ui/button";

const COPIED_FEEDBACK_MS = 2000;

function copyTextToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).then(() => true).catch(() => false);
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return Promise.resolve(ok);
  } catch {
    return Promise.resolve(false);
  }
}

interface DrrResultViewProps {
  result: string;
  onCancel: () => void;
  onSave: () => void;
}

export function DrrResultView({
  result,
  onCancel,
  onSave,
}: DrrResultViewProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    const ok = await copyTextToClipboard(result);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    }
  }, [result]);

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 mt-0">
      <div className="bg-[var(--flux-code-bg)] rounded-xl border border-[var(--flux-code-border)] overflow-hidden shadow-xl mb-3 ring-1 ring-white/10 relative group">
        <div className="flex items-center justify-between px-3 py-2 bg-[var(--flux-code-header)] border-b border-[var(--flux-code-border)]">
          <span className="text-[10px] font-bold text-[var(--flux-text-muted)] flex items-center gap-1.5 uppercase tracking-wider">
            <Braces className="w-3 h-3 text-green-500" />
            DSL Preview
          </span>
          <button
            type="button"
            onClick={handleCopy}
            className="text-[var(--flux-text-muted)] hover:text-white transition-colors bg-white/5 p-1 rounded hover:bg-white/10"
            aria-label={copied ? "복사됨" : "복사"}
          >
            {copied ? (
              <Check className="w-3 h-3 text-green-400" />
            ) : (
              <Copy className="w-3 h-3" />
            )}
          </button>
        </div>
        <div className="p-3 overflow-x-auto max-h-48 scrollbar-hide">
          <pre className="text-[10px] font-mono text-green-400 leading-relaxed whitespace-pre font-medium">
            {result}
          </pre>
        </div>
      </div>
      <div className="flex gap-2">
        <Button
          variant="outline"
          className="flex-1 py-2.5 text-xs font-bold text-gray-600 hover:bg-[var(--flux-bg-subtle)] rounded-lg border-[var(--flux-border)] hover:border-[var(--flux-code-border)]"
          onClick={onCancel}
        >
          취소
        </Button>
        <Button
          variant="brand"
          className="flex-1 py-2.5 text-xs font-bold rounded-lg shadow-sm flex items-center justify-center gap-1.5 active:scale-[0.98]"
          onClick={onSave}
        >
          <Save className="w-3.5 h-3.5" /> 시나리오 저장
        </Button>
      </div>
    </div>
  );
}
