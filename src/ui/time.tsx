import { shortAge } from "@/engine/age";

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
