import * as z from "@zod/mini";
import { setTrayAttention } from "@/core/native";
import type { Job } from "@/core/scheduler";
import { wouldFailCi } from "@/engine/advisories";
import { scanAllActions } from "./actions";
import { buildTimeline } from "./changelogs";
import type { Services } from "./context";
import { refreshDeploys } from "./deploys";
import { refreshBotPulls, refreshCi, refreshInbox } from "./github-feed";
import { dismissedAdvisories, homeSummary, needsAttention, readCiThreshold } from "./home";
import { notify } from "./notify";
import { refreshPackages } from "./packages";
import { readAllReports, refreshAllProjects } from "./projects";
import { readSecurity, scanAllProjects } from "./security";
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

async function notifySecurity(svc: Services) {
  const [threshold, dismissed, projects] = await Promise.all([
    readCiThreshold(svc),
    dismissedAdvisories(svc),
    svc.store.listProjects(),
  ]);
  const reports = await Promise.all(projects.map((project) => readSecurity(svc, project.id)));
  const alerts = projects.flatMap((project, i) =>
    (reports[i]?.findings ?? [])
      .filter((f) => !dismissed.has(f.id) && wouldFailCi([f], threshold))
      .map((finding) => ({
        key: `${project.id}:${finding.id}`,
        title: `${project.name}: ${finding.severity} advisory in ${finding.name}`,
        body: finding.fixedIn ? `${finding.summary}. Fixed in ${finding.fixedIn}.` : finding.summary,
        route: "/security",
      })),
  );
  await Promise.all(alerts.map((alert) => notify(svc, "advisory", alert)));
}

async function refreshTimeline(svc: Services) {
  const byName = new Map<string, Set<string>>();
  for (const { project, report } of await readAllReports(svc)) {
    for (const dep of report?.dependencies ?? []) {
      if (dep.field === "dependencies") byName.set(dep.name, (byName.get(dep.name) ?? new Set()).add(project.name));
    }
  }
  const timeline = await buildTimeline(
    svc,
    [...byName].map(([name, projects]) => ({ name, projects: [...projects] })),
  );
  await writeSnapshot(svc, "timeline", timeline);
  await svc.queryClient.invalidateQueries({ queryKey: ["timeline"] });
  await Promise.all(
    timeline.items
      .filter((item) => item.major && item.usedBy.length > 0)
      .map((item) =>
        notify(svc, "major", {
          key: `${item.repo}@${item.tag}`,
          title: `${item.packageName ?? item.repo} ${item.tag} is out`,
          body: `Major release. Used by ${item.usedBy.join(", ")}.`,
          route: "/changelogs",
        }),
      ),
  );
}

async function refreshCiAndNotify(svc: Services) {
  const snapshot = await refreshCi(svc);
  const failed = snapshot.entries.flatMap((entry) => {
    const run = entry.runs.find((r) => r.status === "completed");
    return run?.conclusion === "failure" ? [{ entry, run }] : [];
  });
  await Promise.all(
    failed.map(({ entry, run }) =>
      notify(svc, "ci", {
        key: `${entry.repo}:${run.id}`,
        title: `${entry.name}: CI failed`,
        body: `${run.display_title ?? run.name ?? "Workflow"} on ${run.head_branch ?? "unknown branch"}`,
        route: "/ci",
      }),
    ),
  );
}

async function refreshDeploysAndNotify(svc: Services) {
  const snapshot = await refreshDeploys(svc);
  await Promise.all(
    snapshot.deployments
      .filter((deploy) => deploy.state === "error")
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

async function updateTray(svc: Services) {
  if (svc.preview) return;
  const summary = await homeSummary(svc);
  await setTrayAttention(needsAttention(summary), svc.scheduler.isPaused()).catch(() => undefined);
  await svc.queryClient.invalidateQueries({ queryKey: ["home"] });
}

export async function registerJobs(svc: Services): Promise<void> {
  const intervals = await readJobIntervals(svc);
  for (const definition of JOBS) {
    const job: Job = {
      id: definition.id,
      title: definition.title,
      intervalMinutes: intervals[definition.id] ?? definition.defaultMinutes,
      visibleOnly: definition.visibleOnly,
      run: async (signal) => {
        await definition.run(svc, signal);
        await updateTray(svc);
      },
    };
    svc.scheduler.register(job);
  }
}
