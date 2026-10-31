import { cn } from "cn";
import { X } from "lucide-react";
import { useSyncExternalStore } from "react";
import { currentToasts, dismiss, subscribeToasts } from "./toast";

export function Toaster() {
  const items = useSyncExternalStore(subscribeToasts, currentToasts);
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-80 flex-col gap-2" aria-live="polite">
      {items.map((item) => (
        <div
          key={item.id}
          className={cn(
            "pointer-events-auto flex items-start gap-2 rounded-md border bg-raised px-3 py-2 text-sm shadow-lg",
            item.tone === "error" ? "border-bad/30 text-bad" : "border-line-strong text-fg",
          )}
          data-selectable
        >
          <span className="min-w-0 flex-1">{item.message}</span>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => dismiss(item.id)}
            className="text-muted hover:text-fg"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
