import { cn } from "cn";

export function Spinner({ className }: { className?: string }) {
  return (
    <span className="inline-flex appear-late">
      <svg viewBox="0 0 16 16" className={cn("size-4 animate-spin text-muted", className)} aria-hidden="true">
        <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
        <path d="M14 8a6 6 0 0 0-6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </span>
  );
}
