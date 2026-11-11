import * as z from "@zod/mini";
import { like } from "drizzle-orm";
import { notifications } from "@/core/db/schema";
import type { Job } from "@/core/scheduler";
import { runFailed } from "@/integrations/github";
import { scanAllActions } from "./actions";
import { buildTimeline } from "./changelogs";
import type { Services } from "./context";
import { refreshDeploys } from "./deploys";
import { refreshBotPulls, refreshCi, refreshInbox } from "./github-feed";
import { dismissedAdvisories } from "./home";
import { notify, updateTray } from "./notify";
import { refreshPackages } from "./packages";
import { readAllReports, refreshAllProjects } from "./projects";
import { readAllSecurity, scanAllProjects } from "./security";
import { writeSnapshot } from "./snapshot";
import { runSync } from "./sync";
import { refreshToolchain } from "./toolchain";

export const JOB_INTERVALS_SETTING = "jobIntervals";

export interface JobDefinition {
  id: string;
  title: string;
  defaultMinutes: number;
  visibleOnly?: boolean;
  run(svc: Services, signal: AbortSignal): Promise<void>;
}

const RECENT_MS = 2 * 86_400_000;

const SEEN_ADVISORIES = "seenAdvisories";

/**
 * Only advisories that appeared since the last scan notify, grouped per project, and only high or critical ones.
 * The first scan just records what is already there, so opening the app never floods the list.
 */
export async function notifySecurity(svc: Services) {
  const [dismissed, projects, seenList] = await Promise.all([
    dismissedAdvisories(svc),
    svc.store.listProjects(),
    svc.store.getLocal(SEEN_ADVISORIES, z.nullable(z.array(z.string())), null),
  ]);
  const reports = await readAllSecurity(
    svc,
    projects.map((p) => p.id),
  );
  const current = projects.flatMap((project, i) =>
    (reports[i]?.findings ?? []).map((finding) => ({ project, finding, key: `${project.id}:${finding.id}` })),
  );
  await svc.store.setLocal(SEEN_ADVISORIES, [...new Set(current.map((c) => c.key))]);
  if (seenList === null) {
    await clearAdvisoryBacklog(svc);
    return;
  }
  const seen = new Set(seenList);
  const fresh = current.filter(
    ({ finding, key }) =>
      !seen.has(key) && !dismissed.has(finding.id) && (finding.severity === "high" || finding.severity === "critical"),
  );
  await Promise.all(
    [...Map.groupBy(fresh, (item) => item.project.id)].map(([projectId, items]) => {
      const name = items[0]?.project.name ?? "A project";
      const packages = [...new Set(items.map((i) => i.finding.name))];
      return notify(svc, "advisory", {
        key: `${projectId}:${items
          .map((i) => i.finding.id)
          .toSorted()
          .join(",")}`,
        title: `${name}: ${items.length} new ${items.length === 1 ? "advisory" : "advisories"}`,
        body: packages.length <= 3 ? `In ${packages.join(", ")}` : `In ${packages.slice(0, 3).join(", ")} and more`,
        route: "/security",
        delivery: "urgent",
      });
    }),
  );
}

/** Older versions recorded one notification per advisory; those are noise, not news. */
async function clearAdvisoryBacklog(svc: Services) {
  await svc.store.db.delete(notifications).where(like(notifications.key, "advisory:%"));
  svc.invalidate(["notifications"]);
}

async function refreshTimeline(svc: Services) {
  const usage = new Map<string, string[]>();
  for (const { project, report } of await readAllReports(svc)) {
    for (const dep of report?.dependencies ?? []) usage.set(dep.name, [...(usage.get(dep.name) ?? []), project.name]);
  }
  const timeline = await buildTimeline(svc, usage);
  await writeSnapshot(svc, "watched-releases", timeline);
  await svc.queryClient.invalidateQueries({ queryKey: ["timeline"] });
  await Promise.all(
    timeline.items
      .filter((item) => item.major && Date.now() - Date.parse(item.publishedAt) < RECENT_MS)
      .map((item) =>
        notify(svc, "major", {
          key: `${item.repo}@${item.tag}`,
          title: `${item.packageName ?? item.repo} ${item.tag} is out`,
          body: item.usedBy.length > 0 ? `Major release. Used by ${item.usedBy.join(", ")}.` : "Major release.",
          route: "/changelogs",
        }),
      ),
  );
}

/** Only fresh failures on the default branch; older ones were already there before Tidra looked. */
async function refreshCiAndNotify(svc: Services) {
  const snapshot = await refreshCi(svc);
  const failed = snapshot.entries.flatMap((entry) => {
    // currentRuns keeps each workflow's latest run, so every failing workflow is checked, not just the newest run.
    const runs = entry.runs.filter((r) => r.status === "completed" && r.head_branch === entry.defaultBranch);
    return runs
      .filter((run) => runFailed(run) && Date.now() - Date.parse(run.created_at) < RECENT_MS)
      .map((run) => ({
        entry,
        run,
      }));
  });
  await Promise.all(
    failed.map(({ entry, run }) =>
      notify(svc, "ci", {
        key: `${entry.repo}:${run.id}`,
        title: `${entry.name}: CI failed`,
        body: `${run.display_title ?? run.name ?? "Workflow"} on ${run.head_branch ?? "unknown branch"}`,
        route: "/repos",
      }),
    ),
  );
}

async function refreshDeploysAndNotify(svc: Services) {
  const snapshot = await refreshDeploys(svc);
  await Promise.all(
    snapshot.deployments
      .filter((deploy) => deploy.state === "error" && Date.now() - Date.parse(deploy.createdAt) < RECENT_MS)
      .map((deploy) =>
        notify(svc, "deploy", {
          key: `${deploy.provider}:${deploy.id}`,
          title: `${deploy.project}: deploy failed`,
          body: deploy.message ?? `${deploy.provider} deployment ${deploy.id}`,
          route: "/deploys",
        }),
      ),
  );
}

export const JOBS: JobDefinition[] = [
  {
    id: "projects",
    title: "Outdated packages and git status",
    defaultMinutes: 30,
    run: (svc, signal) => refreshAllProjects(svc, signal),
  },
  {
    id: "security",
    title: "Security advisories",
    defaultMinutes: 360,
    run: async (svc, signal) => {
      await scanAllProjects(svc, signal);
      await notifySecurity(svc);
    },
  },
  {
    id: "actions",
    title: "GitHub Actions versions",
    defaultMinutes: 720,
    run: (svc, signal) => scanAllActions(svc, signal),
  },
  { id: "timeline", title: "Releases and changelogs", defaultMinutes: 360, run: (svc) => refreshTimeline(svc) },
  { id: "inbox", title: "GitHub inbox", defaultMinutes: 10, run: async (svc) => void (await refreshInbox(svc)) },
  { id: "ci", title: "CI status", defaultMinutes: 5, visibleOnly: true, run: (svc) => refreshCiAndNotify(svc) },
  {
    id: "bot-pulls",
    title: "Dependabot and Renovate PRs",
    defaultMinutes: 30,
    run: async (svc) => void (await refreshBotPulls(svc)),
  },
  { id: "deploys", title: "Deploys", defaultMinutes: 5, visibleOnly: true, run: (svc) => refreshDeploysAndNotify(svc) },
  { id: "packages", title: "My packages", defaultMinutes: 720, run: async (svc) => void (await refreshPackages(svc)) },
  { id: "toolchain", title: "Toolchain", defaultMinutes: 1440, run: async (svc) => void (await refreshToolchain(svc)) },
  { id: "sync", title: "Sync", defaultMinutes: 5, run: async (svc) => void (await runSync(svc)) },
];

const IntervalsSchema = z.record(z.string(), z.number());
export const readJobIntervals = (svc: Services) => svc.store.getSetting(JOB_INTERVALS_SETTING, IntervalsSchema, {});

const LAST_RUNS = "jobLastRuns";
const LastRunsSchema = z.record(z.string(), z.number());

/** Order is priority at launch: what the first screens show runs first, slow tool probes run last. */
const PRIORITY = [
  "projects",
  "inbox",
  "ci",
  "security",
  "actions",
  "bot-pulls",
  "deploys",
  "timeline",
  "sync",
  "packages",
  "toolchain",
];

export async function registerJobs(svc: Services): Promise<void> {
  const [intervals, lastRuns] = await Promise.all([
    readJobIntervals(svc),
    svc.store.getLocal(LAST_RUNS, LastRunsSchema, {}),
  ]);
  // One map for every job, so two jobs finishing together never overwrite each other's time.
  const runs = new Map(Object.entries(lastRuns));
  const ordered = JOBS.toSorted((a, b) => PRIORITY.indexOf(a.id) - PRIORITY.indexOf(b.id));
  for (const definition of ordered) {
    const job: Job = {
      id: definition.id,
      title: definition.title,
      intervalMinutes: intervals[definition.id] ?? definition.defaultMinutes,
      visibleOnly: definition.visibleOnly,
      run: async (signal) => {
        await definition.run(svc, signal);
        // Only successful runs count, so a failed check is retried on the next launch.
        runs.set(definition.id, Date.now());
        await svc.store.setLocal(LAST_RUNS, Object.fromEntries(runs));
        await updateTray(svc);
        await svc.queryClient.invalidateQueries({ queryKey: ["home"] });
        svc.invalidate(["github-rate-limit"]);
      },
    };
    svc.scheduler.register(job, lastRuns[definition.id]);
  }
}
