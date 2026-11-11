import * as z from "@zod/mini";
import { eq } from "drizzle-orm";
import { dismissals } from "@/core/db/schema";
import { DEFAULT_CI_THRESHOLD, wouldFailCi, type CiThreshold, type Severity } from "@/engine/advisories";
import { runFailed } from "@/integrations/github";
import { readAllActions } from "./actions";
import type { TimelineItem } from "./changelogs";
import { defaultBranchRun } from "./ci-status";
import type { Services } from "./context";
import { readDeploys } from "./deploys";
import { readBotPulls, readCi, readInbox } from "./github-feed";
import { readAllReports } from "./projects";
import { groupRepos } from "./repos";
import { readAllSecurity } from "./security";
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

export type CiState = "success" | "failure" | "pending" | "none";
export type SeverityCounts = Record<Severity, number>;

/** One project's health at a glance; `score` orders the attention list. */
export interface ProjectHealth {
  id: string;
  name: string;
  /** Repo label for packages inside a monorepo. */
  repo?: string;
  updates: { major: number; minor: number; patch: number };
  security: SeverityCounts & { total: number };
  failsAudit: boolean;
  branch?: string;
  changed: number;
  ahead: number;
  behind: number;
  ci: CiState;
  error?: string;
  score: number;
}

export interface HomeSummary {
  projects: number;
  updates: { major: number; minor: number; patch: number; projects: number };
  security: { bySeverity: SeverityCounts; total: number; failingAudit: number };
  ci: {
    failing: { name: string; repo: string; url: string; title: string }[];
    repos: { repo: string; name: string; state: CiState; url?: string }[];
  };
  reviewRequests: number;
  myPulls: number;
  myPullsFailing: number;
  botPulls: number;
  deploys: { failing: { project: string; url?: string; provider: string }[] };
  actions: { outdated: number; repos: number };
  git: { dirty: number; unpushed: number; behind: number };
  health: ProjectHealth[];
  releases: TimelineItem[];
}

const emptySeverity = (): SeverityCounts => ({ critical: 0, high: 0, moderate: 0, low: 0 });

function healthScore(h: Omit<ProjectHealth, "score">) {
  return (
    h.security.critical * 40 +
    h.security.high * 12 +
    (h.failsAudit ? 30 : 0) +
    (h.ci === "failure" ? 50 : 0) +
    h.updates.major * 4 +
    h.updates.minor * 2 +
    h.updates.patch +
    (h.changed > 0 ? 6 : 0) +
    (h.ahead > 0 ? 8 : 0) +
    (h.error ? 20 : 0)
  );
}

function ciStates(entries: NonNullable<Awaited<ReturnType<typeof readCi>>>["entries"]) {
  const byRepo = new Map<string, CiState>();
  const repos: HomeSummary["ci"]["repos"] = [];
  const failing: HomeSummary["ci"]["failing"] = [];
  for (const entry of entries) {
    // Only the default branch: a failing pull request must not turn this repo red.
    const latest = defaultBranchRun(entry);
    const state: CiState = !latest
      ? "none"
      : latest.status !== "completed"
        ? "pending"
        : runFailed(latest)
          ? "failure"
          : "success";
    byRepo.set(entry.repo.toLowerCase(), state);
    repos.push({ repo: entry.repo, name: entry.name, state, url: latest?.html_url });
    if (state === "failure" && latest) {
      failing.push({
        name: entry.name,
        repo: entry.repo,
        url: latest.html_url,
        title: latest.display_title ?? latest.name ?? "Workflow run",
      });
    }
  }
  return { byRepo, repos, failing };
}

export async function homeSummary(svc: Services): Promise<HomeSummary> {
  const reports = await readAllReports(svc);
  const repos = groupRepos(reports);
  const [inbox, ci, bots, deploys, threshold, dismissed, actions, timeline, securityReports] = await Promise.all([
    readInbox(svc),
    readCi(svc),
    readBotPulls(svc),
    readDeploys(svc),
    readCiThreshold(svc),
    dismissedAdvisories(svc),
    readAllActions(svc, repos),
    readSnapshot<{ items: TimelineItem[] }>(svc, "watched-releases"),
    readAllSecurity(
      svc,
      reports.map(({ project }) => project.id),
    ),
  ]);
  const ciInfo = ciStates(ci?.entries ?? []);

  const repoOf = new Map(repos.flatMap((repo) => repo.projects.map((p) => [p.id, repo] as const)));
  const updates = { major: 0, minor: 0, patch: 0, projects: 0 };
  const bySeverity = emptySeverity();
  let failingAudit = 0;
  const health = reports.map(({ project, report }, index): ProjectHealth => {
    const counts = { major: 0, minor: 0, patch: 0 };
    for (const entry of report?.outdated ?? []) {
      if (entry.bump === "major") counts.major++;
      else if (entry.bump === "minor") counts.minor++;
      else counts.patch++;
    }
    if (counts.major + counts.minor + counts.patch > 0) updates.projects++;
    updates.major += counts.major;
    updates.minor += counts.minor;
    updates.patch += counts.patch;
    const findings = (securityReports[index]?.findings ?? []).filter((f) => !dismissed.has(f.id));
    const security = { ...emptySeverity(), total: findings.length };
    for (const f of findings) {
      security[f.severity]++;
      bySeverity[f.severity]++;
    }
    const failsAudit = wouldFailCi(findings, threshold);
    if (failsAudit) failingAudit++;
    const repo = repoOf.get(project.id);
    const git = report?.git;
    const base = {
      id: project.id,
      name: project.name,
      repo: repo && repo.projects.length > 1 ? repo.label : undefined,
      updates: counts,
      security,
      failsAudit,
      branch: git?.branch,
      changed: (git?.changed ?? 0) + (git?.untracked ?? 0),
      ahead: git?.ahead ?? 0,
      behind: git?.behind ?? 0,
      ci: (repo?.github ? ciInfo.byRepo.get(repo.github.toLowerCase()) : undefined) ?? "none",
      error: report?.error,
    };
    return { ...base, score: healthScore(base) };
  });

  const latestDeployPerProject = new Map<string, NonNullable<typeof deploys>["deployments"][number]>();
  for (const d of deploys?.deployments ?? [])
    if (!latestDeployPerProject.has(`${d.provider}:${d.project}`))
      latestDeployPerProject.set(`${d.provider}:${d.project}`, d);

  const repoGit = repos.map((r) => r.report?.git);

  return {
    projects: reports.length,
    updates,
    security: { bySeverity, total: Object.values(bySeverity).reduce((a, b) => a + b, 0), failingAudit },
    ci: { failing: ciInfo.failing, repos: ciInfo.repos },
    reviewRequests: inbox?.reviewRequests.length ?? 0,
    myPulls: inbox?.myPulls.length ?? 0,
    myPullsFailing: inbox?.myPulls.filter((p) => p.checks === "failure").length ?? 0,
    botPulls: bots?.pulls.length ?? 0,
    deploys: {
      failing: [...latestDeployPerProject.values()]
        .filter((d) => d.state === "error")
        .map((d) => ({ project: d.project, url: d.url, provider: d.provider })),
    },
    actions: {
      outdated: actions.reduce((sum, a) => sum + (a.report?.items.filter((i) => i.next).length ?? 0), 0),
      repos: actions.filter((a) => a.report?.items.some((i) => i.next)).length,
    },
    git: {
      dirty: repoGit.filter((g) => (g?.changed ?? 0) + (g?.untracked ?? 0) > 0).length,
      unpushed: repoGit.filter((g) => (g?.ahead ?? 0) > 0).length,
      behind: repoGit.filter((g) => (g?.behind ?? 0) > 0).length,
    },
    health: health.toSorted((a, b) => b.score - a.score || a.name.localeCompare(b.name)),
    releases: (timeline?.data.items ?? []).slice(0, 8),
  };
}
