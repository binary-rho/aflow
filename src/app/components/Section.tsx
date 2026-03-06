import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "../../lib/utils";

interface SectionProps {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  icon?: React.ComponentType<{ className?: string }>;
  count?: number;
  headerAction?: React.ReactNode;
  className?: string;
}

export function Section({
  title,
  children,
  defaultOpen = true,
  icon: Icon,
  count,
  headerAction,
  className,
}: SectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div
      className={cn(
        "border-b border-[var(--flux-border-light)] last:border-0 bg-white mb-1 mx-3 pb-1 last:pb-0 last:mb-0 min-w-0",
        className
      )}
    >
      <div
        className="w-full flex items-center justify-between py-3 bg-white z-10 relative select-none rounded-lg px-2 -mx-2 cursor-pointer"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-center gap-2">
          {Icon && (
            <Icon
              className={cn(
                "w-4 h-4",
                isOpen
                  ? "text-[var(--flux-primary)] fill-[var(--flux-primary-muted)]"
                  : "text-[var(--flux-text-muted)]"
              )}
            />
          )}
          <span className="font-bold text-sm text-[var(--flux-text-default)] tracking-tight">
            {title}
          </span>
          {count !== undefined && (
            <span className="bg-[var(--flux-bg-subtle)] text-[var(--flux-text-muted)] text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[1.25rem] text-center ml-0.5">
              {count}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {headerAction && (
            <div onClick={(e) => e.stopPropagation()}>{headerAction}</div>
          )}
          <div
            className={cn(
              "text-gray-300 transition-transform duration-300 p-1 rounded-full",
              isOpen && "rotate-180 text-[var(--flux-primary)]"
            )}
          >
            <ChevronDown className="w-4 h-4" />
          </div>
        </div>
      </div>

      <div
        className={cn(
          "overflow-hidden transition-all duration-300 ease-in-out bg-white relative z-0",
          isOpen ? "max-h-[800px] opacity-100" : "max-h-0 opacity-0"
        )}
      >
        <div className="pb-4 pt-1 px-1">{children}</div>
      </div>
    </div>
  );
}
