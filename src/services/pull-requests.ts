import { eq } from "drizzle-orm";
import { runs } from "@/core/db/schema";
import { createGit, githubSlug, isClean, type GitStatus } from "@/engine/git";
import { nextPullTitle, pullBody, pullTitle } from "@/engine/pull-request";
import type { Services } from "./context";
import { refreshProject, type GitInfoCache } from "./projects";
import { listRepos } from "./repos";

export const UPDATE_BRANCH_PREFIX = "tidra/deps-";

export const isUpdateBranch = (branch: string | undefined) => Boolean(branch?.startsWith(UPDATE_BRANCH_PREFIX));
export const ACTIONS_BRANCH_PREFIX = "tidra/actions-";

/** Any branch Tidra created (dependency or Actions updates): these get Push and Open PR buttons. */
export const isTidraBranch = (branch: string | undefined) => Boolean(branch?.startsWith("tidra/"));

/** Commits the remote doesn't have: ahead of upstream, or an update branch that was never pushed. */
export const hasUnpushed = (git: GitStatus | undefined) =>
  Boolean(git?.branch) && ((git?.ahead ?? 0) > 0 || (!git?.upstream && isTidraBranch(git?.branch)));

/**
 * Commits everything uncommitted in the project's checkout. Updates never commit on their own, so the message
 * comes from the latest update not committed yet; that run is then marked, so its message is used once.
 */
export async function commitProject(svc: Services, projectId: string): Promise<string> {
  const project = await svc.store.getProject(projectId);
  if (!project?.path) throw new Error("This project has no folder on this device.");
  const root = project.subdir ? project.path.slice(0, -(project.subdir.length + 1)) : project.path;
  const git = createGit(svc.io, root);
  const status = await git.status();
  if (isClean(status)) throw new Error("There is nothing to commit.");
  const pending = await pendingRun(svc, projectId);
  const message = pending?.message ?? "chore(deps): update dependencies";
  await git.run(["add", "--all"]);
  await git.commit(message);
  if (pending) {
    const commitSha = await git.headSha();
    await svc.store.db
      .update(runs)
      .set({ result: { ...pending.result, commitSha } })
      .where(eq(runs.id, pending.id));
  }
  const members = (await listRepos(svc)).find((r) => r.projects.some((p) => p.id === projectId))?.projects ?? [];
  const gitCache: GitInfoCache = new Map();
  await Promise.all(members.map((p) => refreshProject(svc, p.id, { gitCache })));
  return message.split("\n")[0] ?? message;
}

/** An update left its changes uncommitted, so the project page offers Commit on any branch. */
export const hasUncommittedUpdate = async (svc: Services, projectId: string) =>
  (await pendingRun(svc, projectId)) !== undefined;

async function pendingRun(svc: Services, projectId: string) {
  const [latest] = await svc.store.db.query.runs.findMany({
    where: eq(runs.projectId, projectId),
    orderBy: (table, { desc }) => desc(table.startedAt),
    limit: 1,
  });
  const result = latest?.result;
  if (!latest || !result || typeof result !== "object") return undefined;
  const { message, commitSha } = result as { message?: unknown; commitSha?: unknown };
  return typeof message === "string" && commitSha === undefined ? { id: latest.id, message, result } : undefined;
}

/** Commit, then push: the one-click way out of an update that stopped at its checks. */
export async function commitAndPushProject(svc: Services, projectId: string): Promise<string> {
  const message = await commitProject(svc, projectId);
  const branch = await pushProject(svc, projectId);
  return `Committed "${message}" and pushed ${branch}.`;
}

/** Pushes the current branch to origin, setting it as upstream, whatever the project's push setting says. */
export async function pushProject(svc: Services, projectId: string): Promise<string> {
  const project = await svc.store.getProject(projectId);
  if (!project?.path) throw new Error("This project has no folder on this device.");
  const git = createGit(svc.io, project.path);
  const { branch } = await git.status();
  if (!branch) throw new Error("HEAD is detached. Switch to a branch first.");
  await git.push(branch);
  await syncPullRequest(svc, project.path, project.remote).catch(() => undefined);
  const members = (await listRepos(svc)).find((r) => r.projects.some((p) => p.id === projectId))?.projects ?? [];
  const gitCache: GitInfoCache = new Map();
  await Promise.all(members.map((p) => refreshProject(svc, p.id, { gitCache })));
  return branch;
}

type PullState =
  | { state: "open"; url: string; number: number; title: string; body?: string | null }
  | { state: "merged" | "closed"; url: string }
  | { state: "none" };

interface PullTarget {
  /** `owner/repo` the pull request is opened against: the upstream of a fork, else origin itself. */
  repo: string;
  /** Git remote that holds the target's default branch. */
  remote: "origin" | "upstream";
  /** Owner of the pushed branch, for the `owner:branch` head. */
  headOwner: string;
}

/** A fork's pull requests go to the repo it was forked from; the branch itself is pushed to the fork. */
export async function pullTarget(svc: Services, path: string, origin: string | null): Promise<PullTarget | undefined> {
  const own = origin ? githubSlug(`https://${origin}`) : undefined;
  if (!own) return undefined;
  const fork = await createGit(svc.io, path)
    .fork()
    .catch(() => undefined);
  const upstream = fork ? githubSlug(`https://${fork.remote}`) : undefined;
  return upstream
    ? { repo: `${upstream.owner}/${upstream.repo}`, remote: "upstream", headOwner: own.owner }
    : { repo: `${own.owner}/${own.repo}`, remote: "origin", headOwner: own.owner };
}

async function pullFor(svc: Services, target: PullTarget | undefined, branch: string): Promise<PullState> {
  const github = await svc.github();
  if (!target || !github.hasToken) return { state: "none" };
  const [pull] = await github.pullsForBranch(target.repo, `${target.headOwner}:${branch}`);
  if (!pull) return { state: "none" };
  if (pull.state === "open")
    return { state: "open", url: pull.html_url, number: pull.number, title: pull.title, body: pull.body };
  return { state: pull.merged_at ? "merged" : "closed", url: pull.html_url };
}

/** The pull request of `branch`, if any; one cached GitHub request. */
export async function branchPull(
  svc: Services,
  projectId: string,
  branch: string,
): Promise<{ state: PullState["state"]; url?: string; number?: number; title?: string }> {
  const project = await svc.store.getProject(projectId);
  if (!project?.path) return { state: "none" };
  const pull = await pullFor(svc, await pullTarget(svc, project.path, project.remote), branch);
  if (pull.state === "open") return { state: "open", url: pull.url, number: pull.number, title: pull.title };
  return pull.state === "none" ? pull : { state: pull.state, url: pull.url };
}

/**
 * Where the next update goes. An update branch whose pull request is still open (or not opened yet) keeps
 * collecting updates; once that PR is merged or closed, the update starts fresh from the default branch.
 */
export async function updateBranchPlan(
  svc: Services,
  project: { path: string; remote: string | null; updateOnBranch: boolean },
  newBranch: string,
): Promise<{ branch?: string }> {
  if (!project.updateOnBranch) return {};
  const git = createGit(svc.io, project.path);
  const status = await git.status();
  if (!isUpdateBranch(status.branch) || !status.branch) return { branch: newBranch };

  const target = await pullTarget(svc, project.path, project.remote);
  const pull = await pullFor(svc, target, status.branch).catch((): PullState => ({ state: "none" }));
  if (pull.state === "open" || pull.state === "none") return {};

  // Leaving with local changes would carry them along; the update's own preflight reports them instead.
  if (!isClean(status)) return {};
  const base = (await git.defaultBranch()) ?? "main";
  await git.switchTo(base);
  await git.pull().catch(() => undefined);
  return { branch: newBranch };
}

/** Commits on HEAD that the target's default branch doesn't have, oldest first. */
async function commitsForPull(git: ReturnType<typeof createGit>, target: PullTarget, base: string) {
  if (target.remote === "upstream") await git.run(["fetch", "upstream", base]).catch(() => undefined);
  return git.subjectsSince(`${target.remote}/${base}`).catch(() => [] as string[]);
}

async function refreshDescription(
  svc: Services,
  target: PullTarget,
  pull: Extract<PullState, { state: "open" }>,
  subjects: string[],
) {
  if (subjects.length === 0) return;
  const body = pullBody(subjects, pull.body);
  const title = nextPullTitle(pull.title, subjects);
  if (body === pull.body && !title) return;
  await (await svc.github()).updatePull(target.repo, pull.number, { title, body });
}

/** After a push: the branch's open pull request lists every commit on it, the new ones included. */
export async function syncPullRequest(svc: Services, path: string, remote: string | null): Promise<void> {
  const target = await pullTarget(svc, path, remote);
  const git = createGit(svc.io, path);
  const { branch } = await git.status();
  if (!target || !branch) return;
  const pull = await pullFor(svc, target, branch);
  if (pull.state !== "open") return;
  const [owner = "", name = ""] = target.repo.split("/");
  const repo = await (await svc.github()).repo(owner, name);
  await refreshDescription(svc, target, pull, await commitsForPull(git, target, repo.default_branch));
}

/**
 * Pushes the project's current branch to origin and returns its pull request, opening one when there is none yet.
 * For a fork that is a pull request against the upstream repo.
 */
export async function openPullRequest(svc: Services, projectId: string): Promise<{ url: string; created: boolean }> {
  const project = await svc.store.getProject(projectId);
  if (!project?.path) throw new Error("This project has no folder on this device.");
  const target = await pullTarget(svc, project.path, project.remote);
  if (!target) throw new Error("Pull requests need a GitHub remote.");
  const github = await svc.github();
  if (!github.hasToken) throw new Error("Add a GitHub token in Settings to open pull requests.");

  const git = createGit(svc.io, project.path);
  const { branch } = await git.status();
  const [owner = "", name = ""] = target.repo.split("/");
  const repo = await github.repo(owner, name);
  if (!branch || (target.remote === "origin" && branch === repo.default_branch)) {
    throw new Error(`You're on ${branch ?? "a detached HEAD"}. Switch to the branch with your changes first.`);
  }
  await git.push(branch);

  const [existing, subjects] = await Promise.all([
    pullFor(svc, target, branch),
    commitsForPull(git, target, repo.default_branch),
  ]);
  if (existing.state === "open") {
    await refreshDescription(svc, target, existing, subjects);
    return { url: existing.url, created: false };
  }

  const pull = await github.createPull(repo.full_name, {
    title: pullTitle(subjects),
    head: `${target.headOwner}:${branch}`,
    base: repo.default_branch,
    body: pullBody(subjects),
  });
  const members = (await listRepos(svc)).find((r) => r.projects.some((p) => p.id === projectId))?.projects ?? [];
  const gitCache: GitInfoCache = new Map();
  await Promise.all(members.map((p) => refreshProject(svc, p.id, { gitCache })));
  return { url: pull.html_url, created: true };
}
