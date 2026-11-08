import { cn } from "cn";
import { STATUS_LABEL, type Status } from "@/services/status";

const RING = "fill-none stroke-[1.5]";

/** 14px ring whose shape changes with risk, so state reads without relying on color. */
export function StatusGlyph({ status, title, className }: { status: Status; title?: string; className?: string }) {
  const label = title ?? STATUS_LABEL[status];
  return (
    <svg
      viewBox="0 0 14 14"
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- inline so its fills follow the theme tokens
      role="img"
      aria-label={label}
      className={cn("size-3.5 shrink-0 overflow-visible", className)}
    >
      <title>{label}</title>
      {status === "ok" ? (
        <>
          <circle cx="7" cy="7" r="6" className="fill-ok stroke-ok stroke-[1.5]" />
          <path d="M4.5 7.2 6.3 9 9.6 5.3" className="fill-none stroke-canvas stroke-[1.6]" strokeLinecap="round" />
        </>
      ) : null}
      {status === "minor" ? (
        <>
          <circle cx="7" cy="7" r="6" className={cn(RING, "stroke-warn")} />
          <path d="M7 7V3a4 4 0 0 1 0 8z" className="fill-warn" />
        </>
      ) : null}
      {status === "major" ? (
        <>
          <circle cx="7" cy="7" r="6" className={cn(RING, "stroke-bad")} />
          <path d="M7 7V3a4 4 0 1 1-4 4z" className="fill-bad" />
        </>
      ) : null}
      {status === "alert" ? (
        <>
          <circle cx="7" cy="7" r="6" className="fill-bad stroke-bad stroke-[1.5]" />
          <path d="M7 4.2v3.4M7 9.8v.1" className="fill-none stroke-canvas stroke-[1.6]" strokeLinecap="round" />
        </>
      ) : null}
      {status === "checking" ? (
        <circle
          cx="7"
          cy="7"
          r="6"
          strokeDasharray="2.4 2.2"
          className={cn(RING, "origin-center animate-glyph-spin stroke-info")}
        />
      ) : null}
      {status === "off" ? (
        <>
          <circle cx="7" cy="7" r="6" className={cn(RING, "stroke-ghost")} />
          <path d="M4.2 9.8l5.6-5.6" className="fill-none stroke-ghost stroke-[1.5]" strokeLinecap="round" />
        </>
      ) : null}
    </svg>
  );
}
