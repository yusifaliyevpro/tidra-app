import type { Severity } from "@/engine/advisories";
import type { Bump } from "@/engine/versions";

export type Tone = "neutral" | "ok" | "warn" | "bad" | "info" | "accent";

export const BUMP_TONE: Record<Bump, Tone> = {
  major: "bad",
  minor: "warn",
  patch: "ok",
  prerelease: "info",
  none: "neutral",
};

export const SEVERITY_TONE: Record<Severity, Tone> = { critical: "bad", high: "bad", moderate: "warn", low: "neutral" };
