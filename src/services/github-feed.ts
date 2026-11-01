import {
  checkState,
  failingSection,
  type CheckState,
  type GitHubNotification,
  type PullRequest,
  type WorkflowRun,
} from "@/integrations/github";
import type { Services } from "./context";
import { listRepos } from "./repos";
import { readSnapshot, writeSnapshot } from "./snapshot";

export interface PullSummary {
  repo: string;
  number: number;
  title: string;
  url: string;
  author?: string;
  draft: boolean;
  checks: CheckState;
  mergeable?: string;
  updatedAt: string;
}

const toSummary = (pull: PullRequest): PullSummary => ({
  repo: pull.repository.nameWithOwner,
  number: pull.number,
  title: pull.title,
  url: pull.url,
  author: pull.author?.login,
  draft: pull.isDraft,
  checks: checkState(pull),
  mergeable: pull.mergeable,
  updatedAt: pull.updatedAt,
});

export interface InboxSnapshot {
  notifications: GitHubNotification[];
  reviewRequests: PullSummary[];
  myPulls: PullSummary[];
  error?: string;
  updatedAt: string;
}

export async function refreshInbox(svc: Services): Promise<InboxSnapshot> {
  const github = await svc.github();
  const updatedAt = new Date().toISOString();
  let snapshot: InboxSnapshot;
  if (!github.hasToken) {
    snapshot = {
      notifications: [],
      reviewRequests: [],
      myPulls: [],
      error: "Add a GitHub token in Settings to see your inbox.",
      updatedAt,
    };
  } else {
    try {
      const [notifications, reviewRequests, myPulls] = await Promise.all([
        github.notifications(),
        github.reviewRequests(),
        github.myPulls(),
      ]);
      snapshot = {
        notifications,
        reviewRequests: reviewRequests.map(toSummary),
        myPulls: myPulls.map(toSummary),
        updatedAt,
      };
    } catch (error) {
      snapshot = {
        notifications: [],
        reviewRequests: [],
        myPulls: [],
        error: error instanceof Error ? error.message : String(error),
        updatedAt,
      };
    }
  }
  await writeSnapshot(svc, "inbox", snapshot);
  await svc.queryClient.invalidateQueries({ queryKey: ["inbox"] });
  return snapshot;
}

/** Marks threads read (or done) on GitHub and drops them from the local inbox without refetching it. */
export async function clearNotifications(svc: Services, ids: string[] | "all", done = false) {
  const github = await svc.github();
  if (ids === "all") await github.markAllNotificationsRead();
  else await Promise.all(ids.map((id) => (done ? github.markNotificationDone(id) : github.markNotificationRead(id))));
  const inbox = await readInbox(svc);
  if (inbox) {
    const gone = ids === "all" ? undefined : new Set(ids);
    await writeSnapshot(svc, "inbox", {
      ...inbox,
      notifications: inbox.notifications.filter((n) => gone && !gone.has(n.id)),
    });
  }
  await svc.queryClient.invalidateQueries({ queryKey: ["inbox"] });
  await svc.queryClient.invalidateQueries({ queryKey: ["home"] });
}

export const readInbox = async (svc: Services) => (await readSnapshot<InboxSnapshot>(svc, "inbox"))?.data;

/** GitHub repos (`owner/repo`) of every project, once per repo however many packages it holds. */
export async function projectRepos(svc: Services): Promise<{ name: string; repo: string }[]> {
  return (await listRepos(svc)).flatMap((group) => (group.github ? [{ name: group.label, repo: group.github }] : []));
}

export interface CiEntry {
  name: string;
  repo: string;
  defaultBranch?: string;
  runs: WorkflowRun[];
  error?: string;
}

export interface CiSnapshot {
  entries: CiEntry[];
  updatedAt: string;
}

/**
 * Latest run per workflow and branch, for the default branch and branches with an open pull request. Runs of merged
 * or closed pull requests are history, not status.
 */
export function currentRuns(runs: WorkflowRun[], defaultBranch: string | undefined, openBranches: Set<string>) {
  const seen = new Set<string>();
  return runs.filter((run) => {
    const branch = run.head_branch ?? "";
    if (branch !== defaultBranch && !openBranches.has(branch)) return false;
    const key = `${run.name ?? ""}\u0000${branch}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function refreshCi(svc: Services): Promise<CiSnapshot> {
  const github = await svc.github();
  const entries = await Promise.all(
    (await projectRepos(svc)).map(async (target): Promise<CiEntry> => {
      try {
        const [owner = "", name = ""] = target.repo.split("/");
        const [repo, pulls, runs] = await Promise.all([
          github.repo(owner, name),
          github.openPullBranches(target.repo),
          github.workflowRuns(target.repo),
        ]);
        return {
          ...target,
          defaultBranch: repo.default_branch,
          runs: currentRuns(runs, repo.default_branch, new Set(pulls)),
        };
      } catch (error) {
        return { ...target, runs: [], error: error instanceof Error ? error.message : String(error) };
      }
    }),
  );
  const snapshot = { entries, updatedAt: new Date().toISOString() };
  await writeSnapshot(svc, "ci", snapshot);
  await svc.queryClient.invalidateQueries({ queryKey: ["ci"] });
  return snapshot;
}

export const readCi = async (svc: Services) => (await readSnapshot<CiSnapshot>(svc, "ci"))?.data;

/** The failing part of the first failed job's log in a run. */
export async function failedLog(
  svc: Services,
  repo: string,
  runId: number,
): Promise<{ job: string; log: string } | undefined> {
  const github = await svc.github();
  const jobs = await github.runJobs(repo, runId);
  const failed = jobs.find((job) => job.conclusion === "failure") ?? jobs[0];
  if (!failed) return undefined;
  return { job: failed.name, log: failingSection(await github.jobLog(repo, failed.id)) };
}

export interface BotPullsSnapshot {
  pulls: PullSummary[];
  error?: string;
  updatedAt: string;
}

export async function refreshBotPulls(svc: Services): Promise<BotPullsSnapshot> {
  const github = await svc.github();
  const updatedAt = new Date().toISOString();
  let snapshot: BotPullsSnapshot;
  try {
    const repos = (await projectRepos(svc)).map((r) => r.repo);
    snapshot = github.hasToken
      ? { pulls: (await github.botPulls(repos)).map(toSummary), updatedAt }
      : { pulls: [], error: "Add a GitHub token in Settings to see bot pull requests.", updatedAt };
  } catch (error) {
    snapshot = { pulls: [], error: error instanceof Error ? error.message : String(error), updatedAt };
  }
  await writeSnapshot(svc, "bot-pulls", snapshot);
  await svc.queryClient.invalidateQueries({ queryKey: ["bot-pulls"] });
  return snapshot;
}

export const readBotPulls = async (svc: Services) => (await readSnapshot<BotPullsSnapshot>(svc, "bot-pulls"))?.data;
