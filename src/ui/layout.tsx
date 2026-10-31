import { cn } from "cn";
import type { ReactNode } from "react";

/** Page frame: a fixed header row with title and actions, and a scrollable body. */
export function Page({
  title,
  subtitle,
  actions,
  children,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className="flex h-full min-w-0 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-5">
        <div className="flex min-w-0 items-baseline gap-2.5">
          <h1 className="truncate text-lg font-medium">{title}</h1>
          {subtitle ? <span className="truncate text-sm text-muted">{subtitle}</span> : null}
        </div>
        <div className="ml-auto flex items-center gap-1.5">{actions}</div>
      </header>
      <div className={cn("min-h-0 flex-1 overflow-y-auto", className)}>{children}</div>
    </div>
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

export function Empty({
  icon,
  title,
  children,
  action,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      {icon ? <div className="text-faint [&>svg]:size-6">{icon}</div> : null}
      <p className="font-medium">{title}</p>
      {children ? <div className="max-w-sm text-sm text-muted">{children}</div> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-md border border-bad/25 bg-bad/5 px-3 py-2 text-sm text-bad" data-selectable>
      {children}
    </div>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return <div className="rounded-md border border-line bg-raised px-3 py-2 text-sm text-muted">{children}</div>;
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-sm border border-line-strong bg-raised px-1 font-sans text-xs text-muted">
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
