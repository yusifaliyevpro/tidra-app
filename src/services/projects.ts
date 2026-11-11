import { ulid } from "ulid";
import type { ProjectWithPath } from "@/core/store";
import { findProjects, findRepoRoot, repoLabel } from "@/engine/discover";
import { createGit, githubSlug, normalizeRemote, type BranchInfo, type ForkInfo, type GitStatus } from "@/engine/git";
import { createLimit } from "@/engine/limit";
import { computeOutdated, DEFAULT_MAJOR_PINS, type OutdatedEntry } from "@/engine/outdated";
import { basename, join, normalize, relative } from "@/engine/path";
import { checksFromLines, detectChecks, display, type Command } from "@/engine/pm";
import { loadWorkspace, type PackageManager, type Workspace } from "@/engine/workspace";
import type { Services } from "./context";
import { readSnapshot, readSnapshots, writeSnapshot } from "./snapshot";

export interface ProjectReport {
  projectId: string;
  pm: PackageManager;
  importers: { path: string; name?: string }[];
  scripts: Record<string, string>;
  checks: string[];
  outdated: OutdatedEntry[];
  /** Updates still younger than minimumReleaseAge; missing in reports from older versions. */
  waiting?: OutdatedEntry[];
  registryErrors: { name: string; message: string }[];
  git?: GitStatus;
  branches: BranchInfo[];
  fork?: ForkInfo;
  /** Direct dependency names across every importer, used by search and security. */
  dependencies: { name: string; spec: string; importer: string; field: string }[];
  error?: string;
  /** Workspace fingerprint the outdated list was computed from. */
  fingerprint?: string;
  /** When the registry was last asked; reused while the fingerprint matches and this is recent. */
  checkedAt?: string;
  updatedAt: string;
}

/** Unchanged files reuse the last registry answers this long; "Check again" always asks. */
const REUSE_MS = 2 * 3_600_000;

export const reportKey = (projectId: string) => `report:${projectId}`;

export async function readReport(svc: Services, projectId: string) {
  return (await readSnapshot<ProjectReport>(svc, reportKey(projectId)))?.data;
}

/** Projects under a folder, nested ones included, each tagged with its repo so the UI can group them. */
export const scanForProjects = (svc: Services, folder: string) => findProjects(svc.io, folder);

/**
 * Adds a folder. A synced project with the same remote and subfolder is reused so devices share one entry,
 * and adding a folder that is already a project on this device does not duplicate it.
 */
export async function addProject(svc: Services, path: string): Promise<string> {
  const manifest = await svc.io.readText(join(path, "package.json"));
  if (manifest === null) throw new Error("No package.json in this folder.");
  const [remoteUrl, repoRoot] = await Promise.all([createGit(svc.io, path).remoteUrl(), findRepoRoot(svc.io, path)]);
  const remote = remoteUrl ? (normalizeRemote(remoteUrl) ?? null) : null;
  const inRepo = repoRoot ? relative(repoRoot, path) : ".";
  const subdir = inRepo === "." ? "" : inRepo;

  const projects = await svc.store.listProjects();
  const existing =
    projects.find((p) => p.path && normalize(p.path).toLowerCase() === normalize(path).toLowerCase()) ??
    (remote ? projects.find((p) => p.remote === remote && p.subdir === subdir) : undefined);
  if (existing) {
    await svc.store.setProjectPath(existing.id, path);
    return existing.id;
  }
  let name = basename(path);
  try {
    const parsed: unknown = JSON.parse(manifest.replace(/^\uFEFF/, ""));
    if (typeof parsed === "object" && parsed !== null && "name" in parsed && typeof parsed.name === "string") {
      name = parsed.name;
    }
  } catch {
    // An unparsable manifest still gets a project entry named after its folder; the report shows the error.
  }
  const id = ulid().toLowerCase();
  await svc.store.addProject({ id, name, remote, subdir, path });
  return id;
}

export function projectChecks(project: ProjectWithPath, workspace: Workspace) {
  return project.checks?.length
    ? checksFromLines(project.checks)
    : detectChecks(workspace.pm, workspace.importers[0]?.manifest ?? {});
}

/** The commands "Run checks" runs, in the workspace root like an update's checks. */
export async function checkCommands(svc: Services, projectId: string): Promise<{ cwd: string; commands: Command[] }> {
  const project = await svc.store.getProject(projectId);
  if (!project?.path) throw new Error("This project has no folder on this device.");
  const workspace = await loadWorkspace(svc.io, project.path);
  return { cwd: workspace.root, commands: projectChecks(project, workspace).map((check) => check.command) };
}

type GitInfo = [GitStatus | undefined, BranchInfo[], ForkInfo | undefined];

/** Git state belongs to the checkout, so packages of one repo share a single set of git calls. */
export type GitInfoCache = Map<string, Promise<GitInfo>>;

/** Goes up whenever a checkout's git state changes, so answers read before that are never used after it. */
const gitEpochs = new Map<string, number>();
const gitEpoch = (root: string) => gitEpochs.get(root) ?? 0;
const gitCacheKey = (root: string) => `${root}#${gitEpoch(root)}`;

export const checkoutRoot = (p: ProjectWithPath) =>
  p.path && p.subdir ? p.path.slice(0, -(p.subdir.length + 1)) : p.path;

function readGitInfo(svc: Services, project: ProjectWithPath & { path: string }, cache?: GitInfoCache) {
  const root = checkoutRoot(project) ?? project.path;
  const hit = cache?.get(gitCacheKey(root));
  if (hit) return hit;
  const info = gitInfoAt(svc, root);
  cache?.set(gitCacheKey(root), info);
  return info;
}

function gitInfoAt(svc: Services, root: string): Promise<GitInfo> {
  const git = createGit(svc.io, root);
  return Promise.all([
    git.status().catch(() => undefined),
    git.branches().catch(() => []),
    git.fork().catch(() => undefined),
  ]);
}

export async function buildReport(
  svc: Services,
  project: ProjectWithPath,
  previous?: ProjectReport,
  gitCache?: GitInfoCache,
): Promise<ProjectReport> {
  const base = { projectId: project.id, updatedAt: new Date().toISOString() };
  if (!project.path) {
    return {
      ...base,
      pm: { name: "npm", yarnBerry: false },
      importers: [],
      scripts: {},
      checks: [],
      outdated: [],
      registryErrors: [],
      branches: [],
      dependencies: [],
      error: "This project has no folder on this device yet.",
    };
  }
  // Git (possibly waiting on a fetch) and the registry run side by side.
  const gitInfo = readGitInfo(svc, { ...project, path: project.path }, gitCache);
  try {
    const workspace = await loadWorkspace(svc.io, project.path);
    const reuse =
      previous &&
      !previous.error &&
      previous.fingerprint === workspace.fingerprint &&
      previous.checkedAt &&
      Date.parse(base.updatedAt) - Date.parse(previous.checkedAt) < REUSE_MS;
    const { entries, waiting, errors } = reuse
      ? { entries: previous.outdated, waiting: previous.waiting ?? [], errors: previous.registryErrors }
      : await computeOutdated(workspace, svc.registry(workspace.npm), {
          majorPins: project.majorPins ?? DEFAULT_MAJOR_PINS,
        });
    const [gitStatus, branches, fork] = await gitInfo;
    return {
      ...base,
      fingerprint: workspace.fingerprint,
      checkedAt: reuse ? previous.checkedAt : base.updatedAt,
      pm: workspace.pm,
      importers: workspace.importers.map((i) => ({ path: i.path, name: i.manifest.name })),
      scripts: workspace.importers[0]?.manifest.scripts ?? {},
      checks: projectChecks(project, workspace).map((c) => display(c.command)),
      outdated: entries,
      waiting,
      registryErrors: errors,
      git: gitStatus,
      branches,
      fork,
      dependencies: workspace.importers.flatMap((importer) =>
        (["dependencies", "devDependencies", "optionalDependencies"] as const).flatMap((field) =>
          Object.entries(importer.manifest[field] ?? {}).map(([name, spec]) => ({
            name,
            spec,
            importer: importer.path,
            field,
          })),
        ),
      ),
    };
  } catch (error) {
    const [gitStatus, branches, fork] = await gitInfo;
    return {
      ...base,
      pm: { name: "npm", yarnBerry: false },
      importers: [],
      scripts: {},
      checks: [],
      outdated: [],
      registryErrors: [],
      git: gitStatus,
      branches,
      fork,
      dependencies: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** `force` skips the fingerprint shortcut and asks the registry again. */
export async function refreshProject(
  svc: Services,
  projectId: string,
  options: { force?: boolean; gitCache?: GitInfoCache } = {},
): Promise<ProjectReport | undefined> {
  const project = await svc.store.getProject(projectId);
  if (!project) return undefined;
  const refresh = (latestRefresh.get(projectId) ?? 0) + 1;
  latestRefresh.set(projectId, refresh);
  const root = checkoutRoot(project);
  const epoch = root ? gitEpoch(root) : 0;
  const previous = options.force ? undefined : await readReport(svc, projectId);
  const built = await buildReport(svc, project, previous, options.gitCache);
  // A newer refresh has seen newer files (a branch switch, say); this one must not write over it.
  if (latestRefresh.get(projectId) !== refresh) return built;
  const report = root && gitEpoch(root) !== epoch ? withGitInfo(built, await gitInfoAt(svc, root)) : built;
  await writeSnapshot(svc, reportKey(projectId), report);
  svc.invalidate(["report", projectId], ["reports"], ["home"], ["palette"]);
  return report;
}

const latestRefresh = new Map<string, number>();

const withGitInfo = (report: ProjectReport, [git, branches, fork]: GitInfo): ProjectReport => ({
  ...report,
  git,
  branches,
  fork,
});

/**
 * Rereads a checkout's git state into its reports, leaving everything else alone. Takes tens of milliseconds, so the
 * screen can show a switch, pull or fetch at once. Returns whether anything changed.
 */
export async function writeGitState(svc: Services, root: string, projectIds: string[]): Promise<boolean> {
  gitEpochs.set(root, gitEpoch(root) + 1);
  const [info, reports] = await Promise.all([
    gitInfoAt(svc, root),
    readSnapshots<ProjectReport>(svc, projectIds.map(reportKey)),
  ]);
  const fresh = JSON.stringify(info);
  const stale = projectIds.flatMap((id, i) => {
    const report = reports[i];
    return report && JSON.stringify([report.git, report.branches, report.fork]) !== fresh ? [{ id, report }] : [];
  });
  await Promise.all(stale.map(({ id, report }) => writeSnapshot(svc, reportKey(id), withGitInfo(report, info))));
  return stale.length > 0;
}

/** Everything about the working tree may have changed (pulled commits, another branch): reads it again, registry too. */
export function refreshInBackground(svc: Services, projectIds: string[]) {
  const gitCache: GitInfoCache = new Map();
  void Promise.all(projectIds.map((id) => refreshProject(svc, id, { gitCache }))).catch(() => undefined);
}

export interface Checkout {
  root: string;
  label: string;
  remote: string | null;
  projectIds: string[];
}

/** The checkout a project lives in and the packages sharing it. Reads no reports: this runs on every git action. */
export async function checkoutOf(svc: Services, projectId: string): Promise<Checkout> {
  const projects = await svc.store.listProjects();
  const project = projects.find((p) => p.id === projectId);
  // A package synced from another device has no folder here, but a sibling in the same repo may.
  const root =
    project &&
    (checkoutRoot(project) ??
      projects.flatMap((p) => (p.remote && p.remote === project.remote ? (checkoutRoot(p) ?? []) : []))[0]);
  if (!project || !root) throw new Error("This project has no folder on this device.");
  return {
    root,
    label: project.subdir ? (repoLabel(project.remote, root) ?? project.name) : project.name,
    remote: project.remote,
    projectIds: projects.filter((p) => checkoutRoot(p) === root).map((p) => p.id),
  };
}

/**
 * Fetches and registry lookups overlap: each checkout's git state waits only for its own fetch, while the registry
 * work of every project starts right away (a few projects at a time, sharing the registry limiter).
 */
export async function refreshAllProjects(svc: Services, signal?: AbortSignal): Promise<void> {
  const limit = createLimit(4);
  const fetchLimit = createLimit(8);
  const projects = await svc.store.listProjects();
  const gitCache: GitInfoCache = new Map();
  const roots = new Set(projects.flatMap((p) => (p.remote ? [checkoutRoot(p) ?? ""] : [])).filter(Boolean));
  for (const root of roots) {
    const fetched = fetchLimit(async () => (signal?.aborted ? undefined : fetchCheckout(svc, root, signal)));
    gitCache.set(
      gitCacheKey(root),
      fetched.then(() => gitInfoAt(svc, root)),
    );
  }
  await Promise.all(
    projects.map((project) =>
      limit(async () => (signal?.aborted ? undefined : refreshProject(svc, project.id, { gitCache }))),
    ),
  );
}

const FETCH_TIMEOUT_MS = 20_000;
const FETCH_FRESH_MS = 60_000;
/** When each checkout was last fetched this session, so moving between screens doesn't refetch every time. */
const lastFetched = new Map<string, number>();

/**
 * One quiet `git fetch` with a time limit; a slow or unreachable remote never blocks anything. Skipped when GitHub's
 * branch heads already match the local remote refs: a fetch spends ~2 s on the SSH handshake alone.
 */
async function fetchCheckout(svc: Services, root: string, signal?: AbortSignal) {
  if (!(await remotesUnchanged(svc, root).catch(() => false))) {
    const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
    await createGit(svc.io, root)
      .fetch({ signal: signal ? AbortSignal.any([signal, timeout]) : timeout })
      .catch(() => undefined);
  }
  lastFetched.set(root, Date.now());
}

/** Whether `git fetch` would bring nothing: every GitHub remote's branches match their `refs/remotes` copies. */
export async function remotesUnchanged(svc: Services, root: string): Promise<boolean> {
  const github = await svc.github();
  if (!github.hasToken) return false;
  const git = createGit(svc.io, root);
  const [urls, refs] = await Promise.all([
    git.raw(["config", "--get-regexp", String.raw`^remote\.(origin|upstream)\.url$`]),
    git.raw([
      "for-each-ref",
      "--format=%(refname:lstrip=2) %(objectname)",
      "refs/remotes/origin",
      "refs/remotes/upstream",
    ]),
  ]);
  const remotes = urls.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [key = "", url = ""] = line.split(" ");
      return { name: key.split(".")[1] ?? "", slug: githubSlug(url) };
    });
  if (remotes.length === 0 || remotes.some((r) => !r.slug)) return false;
  const local = new Map(
    refs.stdout
      .split(/\r?\n/)
      .map((line) => {
        const [ref = "", sha = ""] = line.split(" ");
        return [ref, sha] as const;
      })
      .filter(([ref]) => ref && !ref.endsWith("/HEAD")),
  );
  for (const { name, slug } of remotes) {
    const heads = slug ? await github.branchHeads(`${slug.owner}/${slug.repo}`) : undefined;
    if (!heads) return false;
    const mine = [...local].filter(([ref]) => ref.startsWith(`${name}/`));
    if (mine.length !== heads.size) return false;
    if (!mine.every(([ref, sha]) => heads.get(ref.slice(name.length + 1)) === sha)) return false;
  }
  return true;
}

/**
 * Fetches a checkout and updates its git state, so commits waiting upstream show as a Sync count. Fetching doesn't
 * touch the working tree, so there is no need to ask the registry again. Skipped when it just ran, unless `force`.
 */
async function fetchAndShow(svc: Services, checkout: { root: string; projectIds: string[] }, force = false) {
  const { root, projectIds } = checkout;
  if (!force && Date.now() - (lastFetched.get(root) ?? 0) < FETCH_FRESH_MS) return false;
  await fetchCheckout(svc, root);
  const changed = await writeGitState(svc, root, projectIds);
  if (changed) svc.invalidate(...projectIds.map((id) => ["report", id]), ["reports"], ["home"], ["palette"]);
  svc.invalidate(["branches"], ["branch-pull"]);
  return true;
}

/** Keeps a project's Sync count current: runs when its page opens and after a branch switch. Returns whether it fetched. */
export async function fetchProject(svc: Services, projectId: string, options: { force?: boolean } = {}) {
  const project = await svc.store.getProject(projectId);
  if (!project?.remote) return false;
  const checkout = await checkoutOf(svc, projectId).catch(() => undefined);
  return checkout ? fetchAndShow(svc, checkout, options.force) : false;
}

/** The same for every repo, when a screen with Sync buttons opens or the window regains focus. */
export async function fetchAllCheckouts(svc: Services): Promise<void> {
  const projects = (await svc.store.listProjects()).filter((p) => p.remote);
  const limit = createLimit(8);
  const checkouts = Map.groupBy(
    projects.filter((p) => p.path),
    (p) => checkoutRoot(p) ?? "",
  );
  await Promise.all(
    [...checkouts].map(([root, members]) =>
      limit(() => fetchAndShow(svc, { root, projectIds: members.map((p) => p.id) }).catch(() => false)),
    ),
  );
}

export async function readAllReports(svc: Services): Promise<{ project: ProjectWithPath; report?: ProjectReport }[]> {
  const projects = await svc.store.listProjects();
  const reports = await readSnapshots<ProjectReport>(
    svc,
    projects.map((p) => reportKey(p.id)),
  );
  return projects.map((project, i) => ({ project, report: reports[i] }));
}
