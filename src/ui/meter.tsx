import { cn } from "cn";

export interface Segment {
  value: number;
  /** Background class for the segment, e.g. `bg-bad`. */
  color: string;
  label: string;
}

/** Thin stacked bar: proportions at a glance, exact numbers in the title and the legend beside it. */
export function SegmentBar({ segments, className }: { segments: Segment[]; className?: string }) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  return (
    <div
      aria-hidden="true"
      className={cn("flex h-1.5 w-full gap-px overflow-hidden rounded-full bg-white/[0.06]", className)}
    >
      {total > 0
        ? segments
            .filter((s) => s.value > 0)
            .map((s) => (
              <span
                key={s.label}
                title={`${s.value} ${s.label}`}
                className={cn("h-full first:rounded-l-full last:rounded-r-full", s.color)}
                style={{ width: `${(s.value / total) * 100}%` }}
              />
            ))
        : null}
    </div>
  );
}

export function Legend({ segments }: { segments: Segment[] }) {
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted tabular">
      {segments.map((s) => (
        <span key={s.label} className="flex items-center gap-1.5">
          <span className={cn("size-1.5 rounded-full", s.color)} />
          {s.value} {s.label}
        </span>
      ))}
    </span>
  );
}
