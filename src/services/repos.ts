import { repoLabel } from "@/engine/discover";
import { createGit, githubSlug } from "@/engine/git";
import type { Services } from "./context";
import { readAllReports, refreshProject, type GitInfoCache, type ProjectReport } from "./projects";

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
export async function listRepos(svc: Services): Promise<RepoGroup[]> {
  const groups = new Map<string, RepoGroup>();
  for (const { project, report } of await readAllReports(svc)) {
    const root = project.path && project.subdir ? project.path.slice(0, -(project.subdir.length + 1)) : project.path;
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
    group.report ??= report;
    groups.set(key, group);
  }
  return [...groups.values()].toSorted((a, b) => a.label.localeCompare(b.label));
}

export type RepoAction = "fetch" | "pull" | "push" | "prune";

/** Runs a git action on the repo's checkout, then refreshes every package in it. Returns a line for the toast. */
export async function runRepoAction(svc: Services, repo: RepoGroup, action: RepoAction): Promise<string> {
  if (!repo.root) throw new Error("This repository has no folder on this device.");
  const git = createGit(svc.io, repo.root);
  let done: string;
  if (action === "fetch") {
    await git.fetch();
    done = `Fetched ${repo.label}.`;
  } else if (action === "pull") {
    await git.pull();
    done = `Pulled ${repo.label}.`;
  } else if (action === "push") {
    await git.pushCurrent();
    done = `Pushed ${repo.label}.`;
  } else {
    const gone = (repo.report?.branches ?? []).filter((b) => b.upstreamGone && b.name !== repo.report?.git?.branch);
    for (const branch of gone) await git.run(["branch", "-d", branch.name]);
    done = gone.length === 1 ? `Deleted ${gone[0]?.name}.` : `Deleted ${gone.length} merged branches.`;
  }
  const gitCache: GitInfoCache = new Map();
  await Promise.all(repo.projects.map((p) => refreshProject(svc, p.id, { gitCache })));
  await svc.queryClient.invalidateQueries({ queryKey: ["reports"] });
  return done;
}

async function repoOfProject(svc: Services, projectId: string): Promise<RepoGroup & { root: string }> {
  const repo = (await listRepos(svc)).find((r) => r.projects.some((p) => p.id === projectId));
  if (!repo?.root) throw new Error("This project has no folder on this device.");
  return { ...repo, root: repo.root };
}

/** Local branches, then origin's branches that have no local copy yet; `git switch` creates those on demand. */
export async function listBranches(svc: Services, projectId: string): Promise<{ name: string; remote: boolean }[]> {
  const { root } = await repoOfProject(svc, projectId);
  const git = createGit(svc.io, root);
  const [local, remote] = await Promise.all([
    git.run(["for-each-ref", "--sort=-committerdate", "--format=%(refname:short)", "refs/heads"]),
    git.run(["for-each-ref", "--sort=-committerdate", "--format=%(refname:short)", "refs/remotes/origin"]),
  ]);
  const locals = local.split("\n").filter(Boolean);
  const have = new Set(locals);
  const remotes = remote
    .split("\n")
    .map((ref) => ref.replace(/^origin\//, ""))
    .filter((name) => name && name !== "HEAD" && name !== "origin" && !have.has(name));
  return [...locals.map((name) => ({ name, remote: false })), ...remotes.map((name) => ({ name, remote: true }))];
}

/** Switches the repo's checkout (every package in it) to `branch`, creating it from HEAD when asked. */
export async function switchBranch(
  svc: Services,
  projectId: string,
  branch: string,
  options: { create?: boolean } = {},
): Promise<void> {
  const repo = await repoOfProject(svc, projectId);
  const git = createGit(svc.io, repo.root);
  await (options.create ? git.switchCreate(branch) : git.switchTo(branch));
  const gitCache: GitInfoCache = new Map();
  await Promise.all(repo.projects.map((p) => refreshProject(svc, p.id, { gitCache })));
  svc.invalidate(["branch-pull"], ["branches"]);
}

/**
 * One-click sync of the checkout, like an editor's Sync button: fetch every remote, fast-forward a fork's default
 * branch to `upstream`, pull what origin has, then push what it lacks. Never merges or rebases on its own; a
 * diverged branch stops with git's message. Returns a line for the toast.
 */
export async function syncRepo(svc: Services, projectId: string): Promise<string> {
  const repo = await repoOfProject(svc, projectId);
  const git = createGit(svc.io, repo.root);
  await git.fetch();
  const before = await git.status();
  if (!before.branch) throw new Error("HEAD is detached. Switch to a branch first.");

  const steps: string[] = [];
  const fork = await git.fork().catch(() => undefined);
  const base = fork?.ref?.replace(/^upstream\//, "");
  if (fork?.ref && base === before.branch) {
    const behind = Number(await git.run(["rev-list", "--count", `HEAD..${fork.ref}`]));
    if (behind > 0) {
      await git.run(["merge", "--ff-only", fork.ref]);
      steps.push(`took ${behind} from upstream`);
    }
  }
  if (before.upstream && before.behind > 0) {
    await git.pull();
    steps.push(`pulled ${before.behind}`);
  }
  const after = await git.status();
  if (!after.upstream) {
    await git.push(after.branch ?? before.branch);
    steps.push("published the branch");
  } else if (after.ahead > 0) {
    await git.pushCurrent();
    steps.push(`pushed ${after.ahead}`);
  }

  const gitCache: GitInfoCache = new Map();
  await Promise.all(repo.projects.map((p) => refreshProject(svc, p.id, { gitCache })));
  svc.invalidate(["branch-pull"], ["branches"]);
  return steps.length > 0 ? `Synced ${repo.label}: ${steps.join(", ")}.` : `${repo.label} is in sync.`;
}
