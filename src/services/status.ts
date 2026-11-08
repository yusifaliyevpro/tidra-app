import type { ProjectHealth } from "./home";

export type Status = "ok" | "minor" | "major" | "alert" | "checking" | "off";

export const STATUS_LABEL: Record<Status, string> = {
  ok: "Up to date",
  minor: "Minor or patch updates",
  major: "Major updates",
  alert: "Security advisories",
  checking: "Checking",
  off: "Not checked",
};

type HealthLike = Pick<ProjectHealth, "updates" | "security" | "failsAudit" | "error">;

/** A project's update state, riskiest wins. Advisories have their own column and screen, so they don't change it. */
export function projectStatus(health: HealthLike | undefined, checking = false): Status {
  if (checking) return "checking";
  if (!health || health.error) return "off";
  if (health.updates.major > 0) return "major";
  if (health.updates.minor + health.updates.patch > 0) return "minor";
  return "ok";
}
