const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["week", 604_800],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
];

const format = new Intl.RelativeTimeFormat("en", { numeric: "auto", style: "short" });

function relativeTime(iso: string | number, now = Date.now()): string {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  }
  return "just now";
}

export function TimeAgo({ value }: { value: string | number | undefined }) {
  if (value === undefined) return null;
  return (
    <time
      dateTime={new Date(value).toISOString()}
      title={new Date(value).toLocaleString()}
      className="text-muted tabular"
    >
      {relativeTime(value)}
    </time>
  );
}

const SHORT: [string, number][] = [
  ["y", 31_536_000],
  ["mo", 2_592_000],
  ["d", 86_400],
  ["h", 3_600],
];

/** Compact span for dense rows: `1m`, `21h`, `3d`, `2mo`, `1y`. */
export function shortSpan(ms: number): string {
  const seconds = Math.max(0, ms / 1000);
  for (const [unit, size] of SHORT) {
    if (seconds >= size) return `${Math.floor(seconds / size)}${unit}`;
  }
  return `${Math.max(1, Math.floor(seconds / 60))}m`;
}

export const shortAge = (iso: string, now = Date.now()) => shortSpan(now - Date.parse(iso));

/** How long ago a version was published, in a fixed-width slot so rows line up. */
export function ReleaseAge({ value }: { value: string | undefined }) {
  return (
    <span className="w-8 shrink-0 text-right text-sm text-faint tabular">
      {value ? (
        <time dateTime={value} title={`Published ${new Date(value).toLocaleString()}`}>
          {shortAge(value)}
        </time>
      ) : null}
    </span>
  );
}
