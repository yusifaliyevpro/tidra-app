import { repoLabel } from "@/engine/discover";
import { createGit, githubSlug, type Git } from "@/engine/git";
import { createLimit } from "@/engine/limit";
import type { Services } from "./context";
import {
  checkoutOf,
  checkoutRoot,
  fetchProject,
  readAllReports,
  refreshInBackground,
  writeGitState,
  type ProjectReport,
} from "./projects";
import { syncPullRequest } from "./pull-requests";

export interface RepoGroup {
  /** Normalized remote, or the checkout folder for local-only repos. */
  key: string;
  label: string;
  /** `owner/repo` when the remote is on GitHub. */
  github?: string;
  /** The checkout's root folder on this device. */
  root?: string;
  projects: { id: string; name: string; subdir: string }[];
  /** Git state is per checkout, so any member's report describes the whole repo. */
  report?: ProjectReport;
}

/** Projects folded into the repos they live in: a monorepo's packages share one checkout, CI and git state. */
export function groupRepos(rows: Awaited<ReturnType<typeof readAllReports>>): RepoGroup[] {
  const groups = new Map<string, RepoGroup>();
  for (const { project, report } of rows) {
    const root = checkoutRoot(project);
    const key = project.remote ?? root ?? project.id;
    const slug = project.remote ? githubSlug(`https://${project.remote}`) : undefined;
    const group = groups.get(key) ?? {
      key,
      label: project.subdir ? (repoLabel(project.remote, root ?? undefined) ?? project.name) : project.name,
      github: slug ? `${slug.owner}/${slug.repo}` : undefined,
      root: root ?? undefined,
      projects: [],
      report,
    };
    group.projects.push({ id: project.id, name: project.name, subdir: project.subdir });
    // A package synced from another device has no folder here, so a sibling that does describes the checkout.
    if (!group.root && root) {
      group.root = root;
      group.report = report ?? group.report;
    }
    group.report ??= report;
    groups.set(key, group);
  }
  return [...groups.values()].toSorted((a, b) => a.label.localeCompare(b.label));
}

export const listRepos = async (svc: Services) => groupRepos(await readAllReports(svc));

/** Writes the checkout's new git state and has the screen showing it before the action reports success. */
async function showGitState(svc: Services, root: string, projectIds: string[]) {
  await writeGitState(svc, root, projectIds);
  const keys = [...projectIds.map((id) => ["report", id]), ["reports"], ["branches"], ["branch-pull"]];
  await Promise.all(keys.map((queryKey) => svc.queryClient.invalidateQueries({ queryKey })));
  svc.invalidate(["home"], ["palette"]);
}

/** Sync pushes tracked branches, so it keeps an open pull request's package list current too. */
function updatePullRequest(svc: Services, root: string, remote: string | null) {
  void syncPullRequest(svc, root, remote).catch(() => undefined);
}

export type RepoAction = "fetch" | "pull" | "push";

/** Runs a git action on the repo's checkout and shows the result. Returns a line for the toast. */
export async function runRepoAction(svc: Services, repo: RepoGroup, action: RepoAction): Promise<string> {
  if (!repo.root) throw new Error("This repository has no folder on this device.");
  const git = createGit(svc.io, repo.root);
  const projectIds = repo.projects.map((p) => p.id);
  let done: string;
  if (action === "fetch") {
    await git.fetch();
    done = `Fetched ${repo.label}.`;
  } else if (action === "pull") {
    await git.pull();
    done = `Pulled ${repo.label}.`;
    refreshInBackground(svc, projectIds);
  } else {
    await git.pushCurrent();
    done = `Pushed ${repo.label}.`;
    updatePullRequest(svc, repo.root, repo.github ? `github.com/${repo.github}` : null);
  }
  await showGitState(svc, repo.root, projectIds);
  return done;
}

export interface BranchEntry {
  name: string;
  /** Only on origin: `git switch` creates the local copy on demand. */
  remote: boolean;
  onOrigin: boolean;
  isDefault: boolean;
}

/** Local branches, then origin's branches that have no local copy yet. */
export async function listBranches(svc: Services, projectId: string): Promise<BranchEntry[]> {
  const { root } = await checkoutOf(svc, projectId);
  const git = createGit(svc.io, root);
  const refs = (place: string) =>
    git.run(["for-each-ref", "--sort=-committerdate", "--format=%(refname:lstrip=2)", place]);
  const [local, remote, defaultName] = await Promise.all([
    refs("refs/heads"),
    refs("refs/remotes/origin"),
    git.defaultBranch(),
  ]);
  const locals = local.split("\n").filter(Boolean);
  const have = new Set(locals);
  const origin = new Set(
    remote
      .split("\n")
      .map((ref) => ref.replace(/^origin\//, ""))
      .filter((name) => name && name !== "HEAD" && name !== "origin"),
  );
  const entry = (name: string, remoteOnly: boolean): BranchEntry => ({
    name,
    remote: remoteOnly,
    onOrigin: origin.has(name),
    isDefault: name === defaultName,
  });
  return [
    ...locals.map((name) => entry(name, false)),
    ...[...origin].filter((name) => !have.has(name)).map((name) => entry(name, true)),
  ];
}

/**
 * Deletes a branch here and its copy on origin, merged or not: confirming is the caller's job. The checked-out and
 * default branches are refused. Returns a line for the toast.
 */
export async function deleteBranchEverywhere(svc: Services, projectId: string, name: string): Promise<string> {
  const { root, projectIds } = await checkoutOf(svc, projectId);
  const git = createGit(svc.io, root);
  const exists = async (ref: string) => (await git.raw(["rev-parse", "--verify", "--quiet", ref])).code === 0;
  const [status, defaultName, local, onOrigin] = await Promise.all([
    git.status(),
    git.defaultBranch(),
    exists(`refs/heads/${name}`),
    exists(`refs/remotes/origin/${name}`),
  ]);
  if (name === status.branch) throw new Error(`${name} is checked out. Switch to another branch first.`);
  if (name === defaultName) throw new Error(`${name} is the default branch and can't be deleted here.`);
  if (onOrigin) await git.deleteRemoteBranch(name);
  if (local) await git.deleteBranch(name);
  await showGitState(svc, root, projectIds);
  return local && onOrigin
    ? `Deleted ${name} here and on origin.`
    : onOrigin
      ? `Deleted ${name} on origin.`
      : `Deleted ${name}.`;
}

export interface BranchDetail {
  name: string;
  lastCommit: Date;
  current: boolean;
  /** The branch work merges into; deleting it isn't offered. */
  isDefault: boolean;
  merged: boolean;
  upstreamGone: boolean;
  ahead: number;
}

/** The ref merged branches went into: upstream's default branch for a fork, else origin's. */
async function mergeBase(git: Git): Promise<string | undefined> {
  const [fork, name] = await Promise.all([git.fork().catch(() => undefined), git.defaultBranch()]);
  const candidates = [fork?.ref, name && `origin/${name}`, "origin/main", "origin/master", "main", "master"];
  for (const ref of candidates) {
    if (ref && (await git.raw(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`])).code === 0) return ref;
  }
  return undefined;
}

/** Every local branch and whether it was merged, squash merges included. Newest first, the current branch on top. */
export async function listBranchDetails(
  svc: Services,
  projectId: string,
): Promise<{ base?: string; branches: BranchDetail[] }> {
  const { root } = await checkoutOf(svc, projectId);
  const git = createGit(svc.io, root);
  const [status, branches, base] = await Promise.all([git.status(), git.branches(), mergeBase(git)]);
  const defaultName = base?.replace(/^(origin|upstream)\//, "");
  const merged = new Set(base ? await git.mergedInto(base) : []);
  const limit = createLimit(4);
  const details = await Promise.all(
    branches.map((branch) =>
      limit(async (): Promise<BranchDetail> => {
        const isMerged = merged.has(branch.name) || (base ? await git.squashMerged(base, branch.name) : false);
        return {
          ...branch,
          current: branch.name === status.branch,
          isDefault: branch.name === defaultName,
          merged: isMerged,
        };
      }),
    ),
  );
  return {
    base,
    branches: details.toSorted(
      (a, b) => Number(b.current) - Number(a.current) || b.lastCommit.valueOf() - a.lastCommit.valueOf(),
    ),
  };
}

const firstLine = (error: unknown) => (error instanceof Error ? error.message : String(error)).split("\n")[0];

/**
 * Deletes local branches, merged or not: asking first about unmerged ones is the caller's job. The checked-out branch
 * is never touched, and copies on a remote stay. Returns a line for the toast.
 */
export async function deleteBranches(svc: Services, projectId: string, names: string[]): Promise<string> {
  const { root, projectIds } = await checkoutOf(svc, projectId);
  const git = createGit(svc.io, root);
  const { branch: current } = await git.status();
  const deleted: string[] = [];
  const failed: string[] = [];
  for (const name of names.filter((n) => n !== current)) {
    // One at a time: git locks refs (and packed-refs) while deleting, so parallel deletes fail.
    // react-doctor-disable-next-line react-doctor/async-await-in-loop
    await git.deleteBranch(name).then(
      () => deleted.push(name),
      (error: unknown) => failed.push(`${name}: ${firstLine(error)}`),
    );
  }
  await showGitState(svc, root, projectIds);
  if (deleted.length === 0 && failed.length > 0) throw new Error(`Couldn't delete ${failed.join("; ")}`);
  const done = deleted.length === 1 ? `Deleted ${deleted[0]}.` : `Deleted ${deleted.length} branches.`;
  return failed.length > 0 ? `${done} Kept ${failed.join("; ")}` : done;
}

/** Switches the repo's checkout (every package in it) to `branch`, creating it from HEAD when asked. */
export async function switchBranch(
  svc: Services,
  projectId: string,
  branch: string,
  options: { create?: boolean } = {},
): Promise<void> {
  const { root, projectIds } = await checkoutOf(svc, projectId);
  const git = createGit(svc.io, root);
  await (options.create ? git.switchCreate(branch) : git.switchTo(branch));
  // The switch shows at once. Another branch's lockfile can take the registry seconds, and the fetch fills in what
  // this branch is missing from its remote; neither holds anything up.
  await showGitState(svc, root, projectIds);
  refreshInBackground(svc, projectIds);
  void fetchProject(svc, projectId, { force: true }).catch(() => undefined);
}

/**
 * One-click sync of the checkout, like an editor's Sync button: fetch origin and upstream, fast-forward a fork's default
 * branch to `upstream`, take what origin has, then push what it lacks. Never merges or rebases on its own; a
 * diverged branch stops with git's message. Returns a line for the toast.
 */
export async function syncRepo(svc: Services, projectId: string): Promise<string> {
  const { root, label, remote, projectIds } = await checkoutOf(svc, projectId);
  const git = createGit(svc.io, root);
  await git.fetch();
  const before = await git.status();
  if (!before.branch) throw new Error("HEAD is detached. Switch to a branch first.");

  const steps: string[] = [];
  let moved = false;
  const fork = await git.fork().catch(() => undefined);
  if (fork?.ref && fork.ref.replace(/^upstream\//, "") === before.branch && fork.behind) {
    await git.run(["merge", "--ff-only", fork.ref]);
    steps.push(`took ${fork.behind} from upstream`);
    moved = true;
  }
  const behind = moved ? (await git.status()).behind : before.behind;
  if (before.upstream && behind > 0) {
    await git.fastForward();
    steps.push(`pulled ${behind}`);
    moved = true;
  }
  const after = await git.status();
  let pushed = true;
  if (!after.upstream) {
    await git.push(after.branch ?? before.branch);
    steps.push("published the branch");
  } else if (after.ahead > 0) {
    await git.pushCurrent();
    steps.push(`pushed ${after.ahead}`);
  } else {
    pushed = false;
  }

  await showGitState(svc, root, projectIds);
  if (moved) refreshInBackground(svc, projectIds);
  if (pushed) updatePullRequest(svc, root, remote);
  return steps.length > 0 ? `Synced ${label}: ${steps.join(", ")}.` : `${label} is in sync.`;
}
