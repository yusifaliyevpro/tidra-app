import { cn } from "cn";
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
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
  const [position, setPosition] = useState<{ top: number; left: number; right: number; anchorTop: number }>();
  const open = position !== undefined;
  const close = () => setPosition(undefined);
  const toggle = (event: MouseEvent<HTMLElement>) => {
    if (open) return close();
    const rect = event.currentTarget.getBoundingClientRect();
    setPosition({ top: rect.bottom + 4, left: rect.left, right: window.innerWidth - rect.right, anchorTop: rect.top });
  };

  useLayoutEffect(() => {
    if (panel.current && position) keepInWindow(panel.current, position.anchorTop);
  }, [position]);

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
                "fixed z-50 flex max-h-[min(420px,70vh)] animate-pop-in flex-col overflow-hidden overscroll-contain rounded-lg border border-line-strong bg-raised shadow-pop",
                align === "end" ? "origin-top-right" : "origin-top-left",
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

const EDGE = 8;

/** Shifts a fixed panel back inside the window, and flips it above its trigger when there is no room below. */
function keepInWindow(el: HTMLElement, anchorTop: number) {
  // Layout boxes, not getBoundingClientRect: the opening animation scales the panel down.
  const { offsetLeft: left, offsetTop: top, offsetWidth: width, offsetHeight: height } = el;
  const maxLeft = window.innerWidth - EDGE - width;
  if (left > maxLeft || left < EDGE) {
    el.style.left = `${Math.max(EDGE, Math.min(left, maxLeft))}px`;
    el.style.right = "auto";
  }
  if (top + height > window.innerHeight - EDGE && anchorTop - 4 - height >= EDGE)
    el.style.top = `${anchorTop - 4 - height}px`;
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
        "flex h-[30px] w-full shrink-0 items-center gap-2 rounded-md px-2 text-left text-base whitespace-nowrap text-fg hover:bg-hover focus-visible:bg-hover focus-visible:outline-none disabled:opacity-45 [&>svg]:text-muted",
        active && "bg-selected",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** A menu at the pointer for a right click; closes like a popover. Items call `onClose` themselves after acting. */
export function ContextMenu({
  at,
  onClose,
  children,
}: {
  at: { x: number; y: number } | undefined;
  onClose: () => void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useEffectEvent(onClose);
  const open = Boolean(at);
  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event: PointerEvent) => {
      if (!(event.target instanceof Node && panel.current?.contains(event.target))) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
      }
    };
    const onAway = () => close();
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("scroll", onAway, true);
    window.addEventListener("resize", onAway);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("scroll", onAway, true);
      window.removeEventListener("resize", onAway);
    };
  }, [open]);
  if (!at) return null;
  // Keeps the menu inside the window near the right and bottom edges.
  const left = Math.min(at.x, window.innerWidth - 232);
  const top = Math.min(at.y, window.innerHeight - 280);
  return createPortal(
    <div
      ref={panel}
      role="menu"
      style={{ left, top }}
      className="fixed z-50 flex w-[220px] origin-top-left animate-pop-in flex-col rounded-lg border border-line-strong bg-raised p-1 shadow-pop"
    >
      {children}
    </div>,
    document.body,
  );
}

export function MenuSeparator() {
  return <div className="-mx-1 my-1 h-px bg-line" />;
}
