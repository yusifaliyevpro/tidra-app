import { cn } from "cn";
import type { ReactNode } from "react";
import type { Severity } from "@/engine/advisories";
import type { Bump } from "@/engine/versions";
import { BUMP_TONE, SEVERITY_TONE, type Tone } from "./tone";

const TONES: Record<Tone, string> = {
  neutral: "bg-selected text-muted",
  ok: "bg-ok/13 text-ok",
  warn: "bg-warn/13 text-warn",
  bad: "bg-bad/13 text-bad",
  info: "bg-info/13 text-info",
  accent: "bg-accent-bg text-accent-text",
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
        "inline-flex h-[18px] shrink-0 items-center gap-1 rounded-sm px-1.5 text-xs font-medium whitespace-nowrap",
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
    neutral: "bg-ghost",
    ok: "bg-ok",
    warn: "bg-warn",
    bad: "bg-bad",
    info: "bg-info",
    accent: "bg-accent",
  }[tone];
  return <span title={title} aria-label={title} className={cn("inline-block size-2 shrink-0 rounded-full", color)} />;
}
