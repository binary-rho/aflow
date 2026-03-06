import { Info } from "lucide-react";
import { cn } from "../../lib/utils";

interface InfoMessageProps {
  message: string;
  className?: string;
}

export function InfoMessage({ message, className }: InfoMessageProps) {
  return (
    <p
      className={cn(
        "text-[10px] text-[var(--flux-text-muted)] flex items-center gap-1.5 font-medium select-none",
        className
      )}
    >
      <Info className="w-3 h-3 text-[var(--flux-text-muted)] shrink-0" />
      {message}
    </p>
  );
}
