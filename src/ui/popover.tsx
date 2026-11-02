import { cn } from "cn";
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * A trigger and a floating panel under it. The panel is portaled with fixed coordinates so scrolling tables and
 * rounded containers never clip it; outside clicks, Esc, scrolling and resizing close it.
 */
export function Popover({
  renderTrigger,
  children,
  align = "start",
  className,
}: {
  renderTrigger: (props: { open: boolean; toggle: (event: MouseEvent<HTMLElement>) => void }) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: "start" | "end";
  className?: string;
}) {
  const anchor = useRef<HTMLSpanElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number; right: number }>();
  const open = position !== undefined;
  const close = () => setPosition(undefined);
  const toggle = (event: MouseEvent<HTMLElement>) => {
    if (open) return close();
    const rect = event.currentTarget.getBoundingClientRect();
    setPosition({ top: rect.bottom + 4, left: rect.left, right: window.innerWidth - rect.right });
  };

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panel.current?.contains(target) || anchor.current?.contains(target)) return;
      setPosition(undefined);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setPosition(undefined);
      }
    };
    const onScroll = (event: Event) => {
      if (!(event.target instanceof Node && panel.current?.contains(event.target))) setPosition(undefined);
    };
    const onResize = () => setPosition(undefined);
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  return (
    <>
      <span ref={anchor} className="inline-flex min-w-0">
        {renderTrigger({ open, toggle })}
      </span>
      {position
        ? createPortal(
            <div
              ref={panel}
              style={
                align === "end"
                  ? { top: position.top, right: position.right }
                  : { top: position.top, left: position.left }
              }
              className={cn(
                "fixed z-50 flex max-h-[min(420px,70vh)] flex-col overflow-hidden overscroll-contain rounded-lg border border-line-strong bg-raised shadow-xl shadow-black/40",
                className,
              )}
            >
              {children(close)}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

/** A row in a popover menu. */
export function MenuItem({
  onSelect,
  children,
  active,
  disabled,
  className,
}: {
  onSelect: () => void;
  children: ReactNode;
  active?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex h-8 w-full shrink-0 items-center gap-2 rounded-md px-2 text-left text-base text-muted hover:bg-hover hover:text-fg focus-visible:bg-hover focus-visible:text-fg focus-visible:outline-none disabled:opacity-50",
        active && "text-fg",
        className,
      )}
    >
      {children}
    </button>
  );
}
