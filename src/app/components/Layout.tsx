import { useState } from "react";
import { Link, useLocation } from "react-router";
import { Zap, Settings } from "lucide-react";
import { SettingsModal } from "./SettingsModal";
import { useRunButton } from "../contexts/RunButtonContext";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "./ui/tooltip";

const ICON_URL = `${import.meta.env.BASE_URL}icons/Icon.png`;
const LOGO_URL = `${import.meta.env.BASE_URL}icons/logo.png`;
// logo.png 원본 231x63 비율 유지. 크기를 바꾸려면 높이만 조절하고 너비는 높이 × (231/63)로 맞출 것.
const LOGO_HEIGHT = 16;
const ICON_SIZE = 28;
const LOGO_WIDTH = Math.round((LOGO_HEIGHT * 231) / 63);

export function Layout({ children }: { children: React.ReactNode }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const location = useLocation();
  const { runAction } = useRunButton();
  const isRunnerPage = location.pathname.startsWith("/run/");

  return (
    <div className="flex flex-col min-h-0 h-full w-full max-w-full bg-white text-[var(--flux-text-default)] font-sans overflow-hidden">
      <header className="flex items-center justify-between pl-[14px] pr-3 py-2 bg-white z-20 shrink-0 border-b border-[var(--flux-border-light)] min-w-0">
        <Link
          to="/"
          className="flex items-center gap-2 group select-none h-7 pl-0.5"
          aria-label="aflow 홈"
        >
          <img
            src={ICON_URL}
            alt=""
            className="shrink-0 object-contain"
            width={ICON_SIZE}
            height={ICON_SIZE}
          />
          <img
            src={LOGO_URL}
            alt="aflow"
            className="shrink-0 object-contain object-left"
            width={LOGO_WIDTH}
            height={LOGO_HEIGHT}
            style={{ width: LOGO_WIDTH, height: LOGO_HEIGHT }}
          />
        </Link>
        <div className="flex items-center gap-1">
          <Link
            to="/registry"
            className="p-2 text-[var(--flux-text-muted)] hover:text-[var(--flux-primary)] transition-colors rounded-full hover:bg-[var(--flux-primary-muted)]"
            title="액션 도감"
          >
            <Zap className="w-5 h-5 stroke-[2px]" />
          </Link>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="p-2 text-[var(--flux-text-muted)] hover:text-gray-600 transition-colors rounded-full hover:bg-[var(--flux-bg-subtle)]"
            title="설정"
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </header>

      <main className="flex-1 min-h-0 overflow-hidden relative bg-white flex flex-col">
        {children}
      </main>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}
