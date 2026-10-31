import { cn } from "cn";
import type { ReactNode } from "react";
import type { Severity } from "@/engine/advisories";
import type { Bump } from "@/engine/versions";
import { BUMP_TONE, SEVERITY_TONE, type Tone } from "./tone";

const TONES: Record<Tone, string> = {
  neutral: "bg-raised text-muted border-line",
  ok: "bg-ok/10 text-ok border-ok/20",
  warn: "bg-warn/10 text-warn border-warn/20",
  bad: "bg-bad/10 text-bad border-bad/20",
  info: "bg-info/10 text-info border-info/20",
  accent: "bg-accent/10 text-accent border-accent/25",
};

export function Badge({
  tone = "neutral",
  children,
  className,
  title,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-[18px] shrink-0 items-center gap-1 rounded-sm border px-1.5 text-xs font-medium whitespace-nowrap",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function BumpBadge({ bump }: { bump: Bump }) {
  return <Badge tone={BUMP_TONE[bump]}>{bump}</Badge>;
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  return <Badge tone={SEVERITY_TONE[severity]}>{severity}</Badge>;
}

/** Small colored dot for list rows where a full badge is too loud. */
export function Dot({ tone, title }: { tone: Tone; title?: string }) {
  const color = {
    neutral: "bg-faint",
    ok: "bg-ok",
    warn: "bg-warn",
    bad: "bg-bad",
    info: "bg-info",
    accent: "bg-accent",
  }[tone];
  return <span title={title} aria-label={title} className={cn("inline-block size-2 shrink-0 rounded-full", color)} />;
}
