import { eq } from "drizzle-orm";
import { runs } from "@/core/db/schema";
import { createGit, githubSlug, isClean, normalizeRemote, type GitStatus } from "@/engine/git";
import { nextPullTitle, pullBody, pullTitle } from "@/engine/pull-request";
import type { Services } from "./context";
import { checkoutOf, refreshProject, type GitInfoCache } from "./projects";

export const UPDATE_BRANCH_PREFIX = "tidra/deps-";

export const isUpdateBranch = (branch: string | undefined) => Boolean(branch?.startsWith(UPDATE_BRANCH_PREFIX));

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
  const subject = await commitChanges(svc, projectId);
  await refreshRepo(svc, projectId);
  return subject;
}

async function commitChanges(svc: Services, projectId: string): Promise<string> {
  const project = await svc.store.getProject(projectId);
  if (!project?.path) throw new Error("This project has no folder on this device.");
  const root = project.subdir ? project.path.slice(0, -(project.subdir.length + 1)) : project.path;
  const git = createGit(svc.io, root);
  const status = await git.status();
  if (isClean(status)) throw new Error("There is nothing to commit.");
  const pending = await pendingRun(svc, projectId);
  const message = pending?.message ?? "chore(deps): update dependencies";
  await git.run(["add", "--all"]);
  // Work that was already uncommitted before the update stays out of the update's commit.
  const other = pending?.otherWork.map((path) => (project.subdir ? `${project.subdir}/${path}` : path)) ?? [];
  if (other.length > 0) await git.run(["reset", "-q", "--", ...other]);
  await git.commit(message);
  if (pending) {
    const commitSha = await git.headSha();
    await svc.store.db
      .update(runs)
      .set({ result: { ...pending.result, commitSha } })
      .where(eq(runs.id, pending.id));
  }
  return message.split("\n")[0] ?? message;
}

/** Rereads git state for every package of the project's repo. */
async function refreshRepo(svc: Services, projectId: string) {
  const { projectIds } = await checkoutOf(svc, projectId);
  const gitCache: GitInfoCache = new Map();
  await Promise.all(projectIds.map((id) => refreshProject(svc, id, { gitCache })));
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
  const { message, commitSha, otherWork } = result as { message?: unknown; commitSha?: unknown; otherWork?: unknown };
  if (typeof message !== "string" || commitSha !== undefined) return undefined;
  const paths = Array.isArray(otherWork) ? otherWork.filter((p): p is string => typeof p === "string") : [];
  return { id: latest.id, message, result, otherWork: paths };
}

/** Commit, then push, refreshing once at the end: in between, the screen would briefly offer a lone Push. */
export async function commitAndPushProject(svc: Services, projectId: string): Promise<string> {
  const message = await commitChanges(svc, projectId);
  // The push sends the commit made above, so it has to wait for it.
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  const branch = await pushBranch(svc, projectId);
  await refreshRepo(svc, projectId);
  return `Committed "${message}" and pushed ${branch}.`;
}

/**
 * Moves the uncommitted work onto a new branch cut from HEAD, commits it there and publishes the branch, so the
 * default branch stays untouched and Open PR can follow.
 */
export async function commitToNewBranch(svc: Services, projectId: string, branch: string): Promise<string> {
  const name = branch.trim();
  if (!name) throw new Error("Name the branch first.");
  const { root } = await checkoutOf(svc, projectId);
  await createGit(svc.io, root).switchCreate(name);
  const message = await commitChanges(svc, projectId);
  await pushBranch(svc, projectId);
  await refreshRepo(svc, projectId);
  return `Committed "${message}" on ${name} and pushed it.`;
}

/** Pushes the current branch to origin, setting it as upstream. */
export async function pushProject(svc: Services, projectId: string): Promise<string> {
  const branch = await pushBranch(svc, projectId);
  await refreshRepo(svc, projectId);
  return branch;
}

async function pushBranch(svc: Services, projectId: string): Promise<string> {
  const project = await svc.store.getProject(projectId);
  if (!project?.path) throw new Error("This project has no folder on this device.");
  const git = createGit(svc.io, project.path);
  const { branch } = await git.status();
  if (!branch) throw new Error("HEAD is detached. Switch to a branch first.");
  await git.push(branch);
  await syncPullRequest(svc, project.path, project.remote).catch(() => undefined);
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
  /** Name of the repo the branch is pushed to: origin, which is a fork when `repo` is its parent. */
  headRepo: string;
}

/** A fork's pull requests go to the repo it was forked from; the branch itself is pushed to the fork. */
export async function pullTarget(svc: Services, path: string, origin: string | null): Promise<PullTarget | undefined> {
  const git = createGit(svc.io, path);
  // The stored remote is from when the project was added; origin may since point at a fork.
  const live = await git.remoteUrl().catch(() => undefined);
  const current = (live && normalizeRemote(live)) || origin;
  const own = current ? githubSlug(`https://${current}`) : undefined;
  if (!own) return undefined;
  const fork = await git.fork().catch(() => undefined);
  const upstream = fork ? githubSlug(`https://${fork.remote}`) : undefined;
  if (upstream)
    return {
      repo: `${upstream.owner}/${upstream.repo}`,
      remote: "upstream",
      headOwner: own.owner,
      headRepo: own.repo,
    };
  // A fork cloned without an `upstream` remote: GitHub still knows its parent (one ETag-cached request).
  const parent = await forkParent(svc, own.owner, own.repo);
  return { repo: parent ?? `${own.owner}/${own.repo}`, remote: "origin", headOwner: own.owner, headRepo: own.repo };
}

async function forkParent(svc: Services, owner: string, repo: string): Promise<string | undefined> {
  const github = await svc.github();
  if (!github.hasToken) return undefined;
  const info = await github.repo(owner, repo).catch(() => undefined);
  return info?.parent?.full_name;
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
): Promise<{ state: PullState["state"]; url?: string; number?: number; title?: string; commits?: number }> {
  const project = await svc.store.getProject(projectId);
  if (!project?.path) return { state: "none" };
  const target = await pullTarget(svc, project.path, project.remote);
  const pull = await pullFor(svc, target, branch);
  if (pull.state === "open") return { state: "open", url: pull.url, number: pull.number, title: pull.title };
  if (pull.state !== "none") return { state: pull.state, url: pull.url };
  return { state: "none", commits: target ? await commitsAhead(createGit(svc.io, project.path), target) : 0 };
}

/** Commits on HEAD that the pull request's base branch doesn't have, as of the last fetch. */
export async function commitsAhead(git: ReturnType<typeof createGit>, target: Pick<PullTarget, "remote">) {
  const base =
    target.remote === "upstream"
      ? (await git.fork().catch(() => undefined))?.ref
      : await git.defaultBranch().then((name) => (name ? `origin/${name}` : undefined));
  if (!base) return 0;
  const count = await git.raw(["rev-list", "--count", `${base}..HEAD`]);
  return count.code === 0 ? Number(count.stdout.trim()) : 0;
}

/** Commit messages on HEAD that the target's default branch doesn't have, oldest first. */
async function commitsForPull(git: ReturnType<typeof createGit>, target: PullTarget, base: string) {
  if (target.remote === "upstream") await git.run(["fetch", "upstream", base]).catch(() => undefined);
  return git.messagesSince(`${target.remote}/${base}`).catch(() => [] as string[]);
}

async function refreshDescription(
  svc: Services,
  target: PullTarget,
  pull: Extract<PullState, { state: "open" }>,
  messages: string[],
) {
  if (messages.length === 0) return;
  const body = pullBody(messages, pull.body);
  const title = nextPullTitle(pull.title, messages);
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
  const fromFork = target.repo !== `${target.headOwner}/${target.headRepo}`;
  if (!branch || (!fromFork && branch === repo.default_branch)) {
    throw new Error(`You're on ${branch ?? "a detached HEAD"}. Switch to the branch with your changes first.`);
  }
  await git.push(branch);

  const [existing, messages] = await Promise.all([
    pullFor(svc, target, branch),
    commitsForPull(git, target, repo.default_branch),
  ]);
  if (existing.state === "open") {
    await refreshDescription(svc, target, existing, messages);
    return { url: existing.url, created: false };
  }

  const pull = await github.createPull(repo.full_name, {
    title: pullTitle(messages),
    head: `${target.headOwner}:${branch}`,
    base: repo.default_branch,
    body: pullBody(messages),
    // `owner:branch` alone can't tell a fork from its parent when one owner has both.
    ...(fromFork && owner === target.headOwner ? { head_repo: target.headRepo } : {}),
  });
  await refreshRepo(svc, projectId);
  return { url: pull.html_url, created: true };
}
