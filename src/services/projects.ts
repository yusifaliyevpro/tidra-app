import { ulid } from "ulid";
import type { ProjectWithPath } from "@/core/store";
import { findProjects, findRepoRoot } from "@/engine/discover";
import { createGit, normalizeRemote, type BranchInfo, type ForkInfo, type GitStatus } from "@/engine/git";
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
    const parsed: unknown = JSON.parse(manifest);
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

function readGitInfo(svc: Services, project: ProjectWithPath & { path: string }, cache?: GitInfoCache) {
  const root = project.subdir ? project.path.slice(0, -(project.subdir.length + 1)) : project.path;
  const hit = cache?.get(root);
  if (hit) return hit;
  const git = createGit(svc.io, root);
  const info = Promise.all([
    git.status().catch(() => undefined),
    git.branches().catch(() => []),
    git.fork().catch(() => undefined),
  ]);
  cache?.set(root, info);
  return info;
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
  const [gitStatus, branches, fork] = await readGitInfo(svc, { ...project, path: project.path }, gitCache);
  try {
    const workspace = await loadWorkspace(svc.io, project.path);
    const reuse =
      previous &&
      !previous.error &&
      previous.fingerprint === workspace.fingerprint &&
      previous.checkedAt &&
      Date.parse(base.updatedAt) - Date.parse(previous.checkedAt) < REUSE_MS;
    const { entries, errors } = reuse
      ? { entries: previous.outdated, errors: previous.registryErrors }
      : await computeOutdated(workspace, svc.registry(workspace.npm), {
          majorPins: project.majorPins ?? DEFAULT_MAJOR_PINS,
        });
    return {
      ...base,
      fingerprint: workspace.fingerprint,
      checkedAt: reuse ? previous.checkedAt : base.updatedAt,
      pm: workspace.pm,
      importers: workspace.importers.map((i) => ({ path: i.path, name: i.manifest.name })),
      scripts: workspace.importers[0]?.manifest.scripts ?? {},
      checks: projectChecks(project, workspace).map((c) => display(c.command)),
      outdated: entries,
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
  const previous = options.force ? undefined : await readReport(svc, projectId);
  const report = await buildReport(svc, project, previous, options.gitCache);
  await writeSnapshot(svc, reportKey(projectId), report);
  svc.invalidate(["report", projectId], ["reports"], ["home"], ["palette"]);
  return report;
}

/** A few projects at a time: each one already fans out registry requests through the shared limiter. */
export async function refreshAllProjects(svc: Services, signal?: AbortSignal): Promise<void> {
  const limit = createLimit(4);
  const projects = await svc.store.listProjects();
  await fetchCheckouts(svc, projects, signal);
  const gitCache: GitInfoCache = new Map();
  await Promise.all(
    projects.map((project) =>
      limit(async () => (signal?.aborted ? undefined : refreshProject(svc, project.id, { gitCache }))),
    ),
  );
}

const FETCH_TIMEOUT_MS = 20_000;
const FETCH_FRESH_MS = 5 * 60_000;
/** When each checkout was last fetched this session, so opening a project doesn't refetch every time. */
const lastFetched = new Map<string, number>();

const checkoutRoot = (p: ProjectWithPath) => (p.path && p.subdir ? p.path.slice(0, -(p.subdir.length + 1)) : p.path);

/** One quiet `git fetch` with a time limit; a slow or unreachable remote never blocks anything. */
async function fetchCheckout(svc: Services, root: string, signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  await createGit(svc.io, root)
    .raw(["fetch", "--all", "--prune", "--quiet"], { signal: signal ? AbortSignal.any([signal, timeout]) : timeout })
    .catch(() => undefined);
  lastFetched.set(root, Date.now());
}

/** Keeps ahead/behind counts (and the Sync button) current; one quiet fetch per checkout, failures ignored. */
async function fetchCheckouts(svc: Services, projects: ProjectWithPath[], signal?: AbortSignal) {
  const roots = new Set(projects.flatMap((p) => (p.remote ? [checkoutRoot(p) ?? ""] : [])).filter(Boolean));
  const limit = createLimit(4);
  await Promise.all(
    [...roots].map((root) => limit(async () => (signal?.aborted ? undefined : fetchCheckout(svc, root, signal)))),
  );
}

/**
 * Fetches the project's checkout, then refreshes every package in it, so commits waiting upstream show as a Sync
 * count. Skipped when it was fetched in the last few minutes unless `force`. Returns whether it fetched.
 */
export async function fetchProject(svc: Services, projectId: string, options: { force?: boolean } = {}) {
  const project = await svc.store.getProject(projectId);
  const root = project ? checkoutRoot(project) : undefined;
  if (!project?.remote || !root) return false;
  if (!options.force && Date.now() - (lastFetched.get(root) ?? 0) < FETCH_FRESH_MS) return false;
  await fetchCheckout(svc, root);
  const members = (await svc.store.listProjects()).filter((p) => checkoutRoot(p) === root);
  const gitCache: GitInfoCache = new Map();
  await Promise.all(members.map((p) => refreshProject(svc, p.id, { gitCache })));
  return true;
}

export async function readAllReports(svc: Services): Promise<{ project: ProjectWithPath; report?: ProjectReport }[]> {
  const projects = await svc.store.listProjects();
  const reports = await readSnapshots<ProjectReport>(
    svc,
    projects.map((p) => reportKey(p.id)),
  );
  return projects.map((project, i) => ({ project, report: reports[i] }));
}
