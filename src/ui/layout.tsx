import { cn } from "cn";
import type { ReactNode } from "react";

/**
 * Screen frame: a 44px header (title, actions) that doubles as the window's drag region, then a scrolling body.
 * The right padding leaves room for the window buttons the shell draws over the canvas corner.
 */
export function Page({
  title,
  actions,
  toolbar,
  children,
  className,
}: {
  title: ReactNode;
  actions?: ReactNode;
  /** A 40px row under the header for the filter field and filter chips. */
  toolbar?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className="flex h-full min-w-0 flex-col">
      <header
        data-tauri-drag-region
        className="flex h-11 shrink-0 items-center gap-2 border-b border-line pr-[124px] pl-5 drag"
      >
        <h1 data-tauri-drag-region className="flex min-w-0 items-center gap-1.5 truncate text-lg font-medium">
          {title}
        </h1>
        <div className="ml-auto flex items-center gap-1.5 no-drag">{actions}</div>
      </header>
      {toolbar ? (
        <div className="flex h-10 shrink-0 items-center gap-1 border-b border-line px-5">{toolbar}</div>
      ) : null}
      <div className={cn("min-h-0 flex-1 overflow-y-auto", className)}>{children}</div>
    </div>
  );
}

/** "Projects / web": the parent links back, the current page is plain text. */
export function Breadcrumb({ parent, children }: { parent: ReactNode; children: ReactNode }) {
  return (
    <>
      <span className="font-normal text-muted no-drag">{parent}</span>
      <span className="font-normal text-ghost">/</span>
      <span className="truncate">{children}</span>
    </>
  );
}

/** List on the left, details on the right; the list keeps its width when the details change. */
export function Split({ list, detail, listWidth = 360 }: { list: ReactNode; detail: ReactNode; listWidth?: number }) {
  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-h-0 shrink-0 flex-col border-r border-line" style={{ width: listWidth }}>
        {list}
      </div>
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">{detail}</div>
    </div>
  );
}

export function Section({
  title,
  actions,
  children,
  className,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex flex-col gap-2", className)}>
      {title || actions ? (
        <div className="flex h-6 items-center gap-2">
          {title ? <h2 className="text-sm font-medium text-muted">{title}</h2> : null}
          <div className="ml-auto flex items-center gap-1.5">{actions}</div>
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("rounded-lg border border-line bg-surface", className)}>{children}</div>;
}

/** A title and, when there is exactly one next step, its button. */
export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2.5 px-6 py-16 text-center">
      <p className="font-medium">{title}</p>
      {children ? <div className="max-w-sm text-sm text-faint">{children}</div> : null}
      {action}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-md bg-bad/13 px-3 py-2 text-sm text-bad" data-selectable>
      {children}
    </div>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return <div className="rounded-md bg-selected px-3 py-2 text-sm text-muted">{children}</div>;
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-sm border border-line-strong bg-canvas px-1 font-sans text-xs font-medium text-muted">
      {children}
    </kbd>
  );
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: "bad" | "warn" | "ok" }) {
  const color = tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : tone === "ok" ? "text-ok" : "text-fg";
  return (
    <div className="flex flex-col gap-0.5">
      <span className={cn("text-xl font-medium tabular", color)}>{value}</span>
      <span className="text-sm text-muted">{label}</span>
    </div>
  );
}

/** A filter chip with its count; chips that would show nothing are left out by the caller. */
export function Chip({
  active,
  count,
  onClick,
  children,
}: {
  active: boolean;
  count?: number;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex h-7 items-center gap-1.5 rounded-md px-2.5 text-sm transition-colors duration-[80ms]",
        active ? "bg-selected text-fg" : "text-muted hover:bg-hover hover:text-fg",
      )}
    >
      {children}
      {count !== undefined ? <span className="text-faint tabular">{count}</span> : null}
    </button>
  );
}
