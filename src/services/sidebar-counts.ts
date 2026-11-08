import type { HomeSummary } from "./home";

export type Count = { value: number; tone: "bad" | "warn" | "accent" | "plain"; title: string };

/** Counts only for things worth acting on; a number that is always there turns into wallpaper. */
export function countFor(id: string, home: HomeSummary | undefined): Count | undefined {
  if (!home) return undefined;
  const urgent = home.security.bySeverity.critical + home.security.bySeverity.high;
  const failingCi = home.ci.failing.length;
  // Home has no count: its urgent work already shows on Security and Repos.
  const counts: Record<string, Count> = {
    projects: { value: home.updates.projects, tone: "plain", title: "Projects with updates" },
    repos: failingCi
      ? { value: failingCi, tone: "bad", title: "Repos with failing CI" }
      : { value: home.git.unpushed + home.git.dirty, tone: "plain", title: "Repos with unpushed or local changes" },
    security: urgent
      ? { value: urgent, tone: "bad", title: "High and critical advisories" }
      : { value: home.security.total, tone: "plain", title: "Advisories" },
    inbox: { value: home.reviewRequests, tone: "accent", title: "Review requests" },
    deploys: { value: home.deploys.failing.length, tone: "bad", title: "Failed deploys" },
  };
  const count = counts[id];
  return count && count.value > 0 ? count : undefined;
}
