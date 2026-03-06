import { useState, useEffect } from "react";
import { X, Eye, EyeOff, CheckCircle } from "lucide-react";
import { getApiKey, setApiKey, clearApiKey } from "@/stores/settingsStore";
import { Button } from "./ui/button";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const [key, setKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (open) {
      const existing = getApiKey();
      setKey(existing ?? "");
      setSaved(false);
    }
  }, [open]);

  if (!open) return null;

  const handleSave = () => {
    const trimmed = key.trim();
    if (trimmed) {
      setApiKey(trimmed);
    } else {
      clearApiKey();
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const maskedKey = key
    ? `${key.slice(0, 7)}${"•".repeat(Math.max(0, key.length - 11))}${key.slice(-4)}`
    : "";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="relative bg-white rounded-2xl shadow-2xl w-[340px] max-w-[90vw] animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--flux-border-light)]">
          <h3 className="font-bold text-sm text-[var(--flux-text-default)]">
            설정
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-full hover:bg-[var(--flux-bg-subtle)] text-[var(--flux-text-muted)] hover:text-[var(--flux-text-default)] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="block text-xs font-bold text-[var(--flux-text-muted)] mb-1.5">
              OpenAI API Key
            </label>
            <div className="relative">
              <input
                type={showKey ? "text" : "password"}
                value={showKey ? key : maskedKey || key}
                onChange={(e) => {
                  setKey(e.target.value);
                  setSaved(false);
                }}
                onFocus={() => setShowKey(true)}
                placeholder="sk-..."
                className="w-full px-3 py-2.5 pr-10 text-xs font-mono bg-[var(--flux-bg-subtle)] border border-[var(--flux-border)] rounded-lg outline-none focus:border-[var(--flux-primary)] focus:ring-2 focus:ring-[var(--flux-ring)] transition-all"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--flux-text-muted)] hover:text-[var(--flux-text-default)] transition-colors"
              >
                {showKey ? (
                  <EyeOff className="w-3.5 h-3.5" />
                ) : (
                  <Eye className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
            <p className="text-[10px] text-[var(--flux-text-muted)] mt-1.5 leading-relaxed">
              DRR → DSL 변환에 사용됩니다. 키는 브라우저 localStorage에만
              저장됩니다.
            </p>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-[var(--flux-border-light)] flex items-center gap-2">
          <Button
            variant="brand"
            size="sm"
            onClick={handleSave}
            className="flex-1 text-xs font-bold py-2.5 rounded-lg flex items-center justify-center gap-1.5"
          >
            {saved ? (
              <>
                <CheckCircle className="w-3.5 h-3.5" /> 저장됨
              </>
            ) : (
              "저장"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
