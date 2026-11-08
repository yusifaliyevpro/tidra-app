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
    <svg viewBox={`0 0 ${width} ${height}`} className={cn("h-5 w-20 text-accent-text", className)} aria-hidden="true">
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
  leading,
}: {
  items: TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  /** Sits left of the tabs, e.g. the page's name; the tabs then align right. */
  leading?: ReactNode;
}) {
  return (
    <div className={cn("flex shrink-0 items-center gap-4 border-b border-line px-5", leading ? "h-14" : "h-11")}>
      {leading}
      <div role="tablist" className={cn("inline-flex gap-0.5 rounded-md bg-selected p-0.5", leading && "ml-auto")}>
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={value === item.id}
            onClick={() => onChange(item.id)}
            className={cn(
              "flex h-6 items-center gap-1.5 rounded-[5px] px-2.5 text-sm transition-colors duration-[80ms]",
              value === item.id ? "bg-canvas text-fg shadow-canvas" : "text-muted hover:text-fg",
            )}
          >
            {item.label}
            {item.count ? <span className="text-xs text-faint tabular">{item.count}</span> : null}
          </button>
        ))}
      </div>
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
        "flex w-full items-center gap-2.5 border-b border-line px-4 py-2 text-left transition-colors duration-[80ms] hover:bg-hover",
        selected && "bg-selected",
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

/** Two to four exclusive choices shown side by side, like Theme: System, Dark, Light. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  label: string;
}) {
  return (
    <fieldset aria-label={label} className="inline-flex gap-0.5 rounded-md bg-selected p-0.5">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={value === option.id}
          onClick={() => onChange(option.id)}
          className={cn(
            "flex h-6 items-center rounded-[5px] px-2.5 text-sm transition-colors duration-[80ms]",
            value === option.id ? "bg-canvas text-fg shadow-canvas" : "text-muted hover:text-fg",
          )}
        >
          {option.label}
        </button>
      ))}
    </fieldset>
  );
}
