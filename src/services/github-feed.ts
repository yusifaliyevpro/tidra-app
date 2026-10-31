import { githubSlug } from "@/engine/git";
import {
  checkState,
  failingSection,
  type CheckState,
  type GitHubNotification,
  type PullRequest,
  type WorkflowRun,
} from "@/integrations/github";
import type { Services } from "./context";
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

export const readInbox = async (svc: Services) => (await readSnapshot<InboxSnapshot>(svc, "inbox"))?.data;

/** GitHub repos (`owner/repo`) of every project with a GitHub remote. */
export async function projectRepos(svc: Services): Promise<{ projectId: string; name: string; repo: string }[]> {
  const projects = await svc.store.listProjects();
  return projects.flatMap((p) => {
    const slug = p.remote ? githubSlug(`https://${p.remote}`) : undefined;
    return slug ? [{ projectId: p.id, name: p.name, repo: `${slug.owner}/${slug.repo}` }] : [];
  });
}

export interface CiEntry {
  projectId: string;
  name: string;
  repo: string;
  runs: WorkflowRun[];
  error?: string;
}

export interface CiSnapshot {
  entries: CiEntry[];
  updatedAt: string;
}

export async function refreshCi(svc: Services): Promise<CiSnapshot> {
  const github = await svc.github();
  const entries = await Promise.all(
    (await projectRepos(svc)).map(async (target): Promise<CiEntry> => {
      try {
        return { ...target, runs: await github.workflowRuns(target.repo) };
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
