import { ulid } from "ulid";
import type { ProjectWithPath } from "@/core/store";
import { findProjects, findRepoRoot } from "@/engine/discover";
import { createGit, normalizeRemote, type BranchInfo, type GitStatus } from "@/engine/git";
import { createLimit } from "@/engine/limit";
import { computeOutdated, DEFAULT_MAJOR_PINS, type OutdatedEntry } from "@/engine/outdated";
import { basename, join, normalize, relative } from "@/engine/path";
import { checksFromLines, detectChecks, display } from "@/engine/pm";
import { loadWorkspace, type PackageManager, type Workspace } from "@/engine/workspace";
import type { Services } from "./context";
import { readSnapshot, writeSnapshot } from "./snapshot";

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
  /** Direct dependency names across every importer, used by search and security. */
  dependencies: { name: string; spec: string; importer: string; field: string }[];
  error?: string;
  updatedAt: string;
}

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

export async function buildReport(svc: Services, project: ProjectWithPath): Promise<ProjectReport> {
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
  const git = createGit(svc.io, project.path);
  const [gitStatus, branches] = await Promise.all([
    git.status().catch(() => undefined),
    git.branches().catch(() => []),
  ]);
  try {
    const workspace = await loadWorkspace(svc.io, project.path);
    const { entries, errors } = await computeOutdated(workspace, svc.registry(workspace.npm), {
      majorPins: project.majorPins ?? DEFAULT_MAJOR_PINS,
    });
    return {
      ...base,
      pm: workspace.pm,
      importers: workspace.importers.map((i) => ({ path: i.path, name: i.manifest.name })),
      scripts: workspace.importers[0]?.manifest.scripts ?? {},
      checks: projectChecks(project, workspace).map((c) => display(c.command)),
      outdated: entries,
      registryErrors: errors,
      git: gitStatus,
      branches,
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
      dependencies: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function refreshProject(svc: Services, projectId: string): Promise<ProjectReport | undefined> {
  const project = await svc.store.getProject(projectId);
  if (!project) return undefined;
  const report = await buildReport(svc, project);
  await writeSnapshot(svc, reportKey(projectId), report);
  await svc.queryClient.invalidateQueries({ queryKey: ["report", projectId] });
  await svc.queryClient.invalidateQueries({ queryKey: ["reports"] });
  await svc.queryClient.invalidateQueries({ queryKey: ["home"] });
  return report;
}

/** A few projects at a time: each one already fans out registry requests through the shared limiter. */
export async function refreshAllProjects(svc: Services, signal?: AbortSignal): Promise<void> {
  const limit = createLimit(3);
  const projects = await svc.store.listProjects();
  await Promise.all(
    projects.map((project) => limit(async () => (signal?.aborted ? undefined : refreshProject(svc, project.id)))),
  );
}

export async function readAllReports(svc: Services): Promise<{ project: ProjectWithPath; report?: ProjectReport }[]> {
  const projects = await svc.store.listProjects();
  return Promise.all(projects.map(async (project) => ({ project, report: await readReport(svc, project.id) })));
}
