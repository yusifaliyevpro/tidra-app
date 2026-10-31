import * as z from "@zod/mini";
import { eq } from "drizzle-orm";
import { dismissals } from "@/core/db/schema";
import { DEFAULT_CI_THRESHOLD, wouldFailCi, type CiThreshold, type Finding } from "@/engine/advisories";
import type { TimelineItem } from "./changelogs";
import type { Services } from "./context";
import { readDeploys } from "./deploys";
import { readBotPulls, readCi, readInbox } from "./github-feed";
import { readAllReports } from "./projects";
import { readSecurity } from "./security";
import { readSnapshot } from "./snapshot";

export const CI_THRESHOLD_SETTING = "ciThreshold";
const ThresholdSchema = z.object({ level: z.enum(["low", "moderate", "high", "critical"]), prodOnly: z.boolean() });

export const readCiThreshold = (svc: Services): Promise<CiThreshold> =>
  svc.store.getSetting(CI_THRESHOLD_SETTING, ThresholdSchema, DEFAULT_CI_THRESHOLD);

export async function dismissedAdvisories(svc: Services): Promise<Set<string>> {
  const rows = await svc.store.db
    .select({ target: dismissals.target })
    .from(dismissals)
    .where(eq(dismissals.deleted, false));
  return new Set(rows.map((r) => r.target));
}

export interface HomeSummary {
  projects: number;
  updates: { major: number; minor: number; patch: number; projects: number };
  security: { failingCi: { projectId: string; name: string; findings: Finding[] }[]; total: number };
  ci: { failing: { name: string; repo: string; url: string; title: string }[] };
  reviewRequests: number;
  myPullsFailing: number;
  unreadNotifications: number;
  botPulls: number;
  deploys: { failing: { project: string; url?: string; provider: string }[] };
  majorReleases: TimelineItem[];
  dirty: number;
}

export async function homeSummary(svc: Services): Promise<HomeSummary> {
  const [reports, inbox, ci, bots, deploys, threshold, dismissed, timeline] = await Promise.all([
    readAllReports(svc),
    readInbox(svc),
    readCi(svc),
    readBotPulls(svc),
    readDeploys(svc),
    readCiThreshold(svc),
    dismissedAdvisories(svc),
    readSnapshot<{ items: TimelineItem[] }>(svc, "timeline"),
  ]);

  const updates = { major: 0, minor: 0, patch: 0, projects: 0 };
  let dirty = 0;
  const failingCi: HomeSummary["security"]["failingCi"] = [];
  let totalFindings = 0;
  const securityReports = await Promise.all(reports.map(({ project }) => readSecurity(svc, project.id)));
  for (const [index, { project, report }] of reports.entries()) {
    const outdated = report?.outdated ?? [];
    if (outdated.length > 0) updates.projects++;
    for (const entry of outdated) {
      if (entry.bump === "major") updates.major++;
      else if (entry.bump === "minor") updates.minor++;
      else updates.patch++;
    }
    if (report?.git && (report.git.changed > 0 || report.git.untracked > 0)) dirty++;
    const security = securityReports[index];
    const findings = (security?.findings ?? []).filter((f) => !dismissed.has(f.id));
    totalFindings += findings.length;
    if (wouldFailCi(findings, threshold)) failingCi.push({ projectId: project.id, name: project.name, findings });
  }

  const failingRuns = (ci?.entries ?? []).flatMap((entry) => {
    const latest = entry.runs[0];
    return latest?.conclusion === "failure"
      ? [
          {
            name: entry.name,
            repo: entry.repo,
            url: latest.html_url,
            title: latest.display_title ?? latest.name ?? "Workflow run",
          },
        ]
      : [];
  });

  const latestDeployPerProject = new Map<string, NonNullable<typeof deploys>["deployments"][number]>();
  for (const d of deploys?.deployments ?? [])
    if (!latestDeployPerProject.has(`${d.provider}:${d.project}`))
      latestDeployPerProject.set(`${d.provider}:${d.project}`, d);

  return {
    projects: reports.length,
    updates,
    security: { failingCi, total: totalFindings },
    ci: { failing: failingRuns },
    reviewRequests: inbox?.reviewRequests.length ?? 0,
    myPullsFailing: inbox?.myPulls.filter((p) => p.checks === "failure").length ?? 0,
    unreadNotifications: inbox?.notifications.filter((n) => n.unread).length ?? 0,
    botPulls: bots?.pulls.length ?? 0,
    deploys: {
      failing: [...latestDeployPerProject.values()]
        .filter((d) => d.state === "error")
        .map((d) => ({ project: d.project, url: d.url, provider: d.provider })),
    },
    majorReleases: (timeline?.data.items ?? []).filter((item) => item.major && item.usedBy.length > 0).slice(0, 8),
    dirty,
  };
}

/** Something on Home is red: drives the tray badge. */
export const needsAttention = (summary: HomeSummary) =>
  summary.security.failingCi.length > 0 ||
  summary.ci.failing.length > 0 ||
  summary.deploys.failing.length > 0 ||
  summary.reviewRequests > 0;
