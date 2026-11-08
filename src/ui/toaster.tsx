import { CircleX, X } from "lucide-react";
import { useSyncExternalStore } from "react";
import { currentToasts, dismiss, subscribeToasts } from "./toast";

export function Toaster() {
  const items = useSyncExternalStore(subscribeToasts, currentToasts);
  return (
    // Centered above the footer action bars, so a toast never covers Continue or Update.
    <div
      className="pointer-events-none fixed bottom-20 left-1/2 z-50 flex w-[400px] -translate-x-1/2 flex-col gap-2"
      aria-live="polite"
    >
      {items.map((item) => (
        <div
          key={item.id}
          className="pointer-events-auto flex min-h-10 animate-rise-in items-center gap-2.5 rounded-lg border border-line-strong bg-raised py-1.5 pr-1.5 pl-3 text-base shadow-pop"
          data-selectable
        >
          {item.tone === "error" ? <CircleX className="size-4 shrink-0 text-bad" strokeWidth={1.5} /> : null}
          <span className="min-w-0 flex-1">{item.message}</span>
          {item.action ? (
            <button
              type="button"
              onClick={() => {
                dismiss(item.id);
                void item.action?.run();
              }}
              className="h-6 shrink-0 rounded-md px-2 text-sm font-medium text-accent-text hover:bg-hover"
            >
              {item.action.label}
            </button>
          ) : null}
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => dismiss(item.id)}
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
