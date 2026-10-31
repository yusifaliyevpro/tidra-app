import { cn } from "cn";
import type { ReactNode } from "react";

export function Sparkline({ values, className }: { values: number[]; className?: string }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const width = 80;
  const height = 20;
  const step = width / (values.length - 1);
  const points = values
    .map((v, i) => `${(i * step).toFixed(1)},${(height - (v / max) * (height - 2) - 1).toFixed(1)}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={cn("h-5 w-20 text-accent", className)} aria-hidden="true">
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

export interface TabItem<T extends string> {
  id: T;
  label: string;
  count?: number;
}

export function Tabs<T extends string>({
  items,
  value,
  onChange,
}: {
  items: TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div role="tablist" className="flex h-10 shrink-0 items-end gap-4 border-b border-line px-5">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={value === item.id}
          onClick={() => onChange(item.id)}
          className={cn(
            "-mb-px flex h-9 items-center gap-1.5 border-b text-sm transition-colors",
            value === item.id ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg",
          )}
        >
          {item.label}
          {item.count ? <span className="text-xs text-faint tabular">{item.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

/** Row in a selectable list: highlighted when selected, keyboard focusable, with leading and trailing slots. */
export function ListRow({
  selected,
  onSelect,
  children,
  className,
}: {
  selected?: boolean;
  onSelect?: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      data-selected={selected || undefined}
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-2.5 border-b border-line px-4 py-2 text-left transition-colors hover:bg-hover",
        selected && "bg-raised",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("font-mono text-sm tabular", className)}>{children}</span>;
}
