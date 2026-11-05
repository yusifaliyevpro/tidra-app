import semver from "semver";
import { ulid } from "ulid";
import { runs } from "@/core/db/schema";
import type { Finding } from "@/engine/advisories";
import { createGit } from "@/engine/git";
import { editJsonOverrides, editYamlOverrides } from "@/engine/manifest";
import { join, relative } from "@/engine/path";
import { installCommand } from "@/engine/pm";
import { parseVersionOutput } from "@/engine/toolchain";
import { loadWorkspace, type Workspace } from "@/engine/workspace";
import type { Services } from "@/services/context";
import { refreshProject } from "@/services/projects";
import { scanProject } from "@/services/security";
import { startUpdate } from "@/services/updates";

/** Direct dependencies are bumped through the normal update flow so checks run and the change is committed. */
export async function fixDirect(svc: Services, projectId: string, finding: Finding): Promise<string> {
  const report = await refreshProject(svc, projectId);
  const entry = report?.outdated.find((e) => e.name === finding.name);
  if (!entry || !finding.fixedIn) throw new Error(`No update for ${finding.name} is available yet.`);
  return startUpdate(svc, projectId, [{ entry, version: finding.fixedIn }]);
}

/** pnpm 10 reads overrides from pnpm-workspace.yaml; older versions only from `pnpm.overrides` in package.json. */
async function pnpmReadsYamlOverrides(svc: Services, workspace: Workspace) {
  const version =
    workspace.pm.version ??
    parseVersionOutput((await svc.io.run("pnpm", ["--version"], { cwd: workspace.root })).stdout);
  return !version || !semver.valid(version) || semver.major(version) >= 10;
}

/**
 * Transitive dependencies get an override (pnpm/npm/bun) or resolution (yarn), then a reinstall. The commit stays the
 * user's click: a recorded run gives Commit on the project page its message.
 */
export async function fixWithOverride(svc: Services, projectId: string, finding: Finding): Promise<void> {
  const project = await svc.store.getProject(projectId);
  if (!project?.path || !finding.fixedIn) throw new Error("No fixed version is known for this advisory.");
  const workspace = await loadWorkspace(svc.io, project.path);
  const value = `^${finding.fixedIn}`;
  const edit = [{ name: finding.name, value }];
  const useYaml = workspace.pm.name === "pnpm" && (await pnpmReadsYamlOverrides(svc, workspace));
  const file = join(workspace.root, useYaml ? "pnpm-workspace.yaml" : "package.json");
  const original = await svc.io.readText(file);
  if (useYaml) {
    await svc.io.writeText(file, editYamlOverrides(original ?? "", edit));
  } else {
    const field =
      workspace.pm.name === "pnpm" ? "pnpm.overrides" : workspace.pm.name === "yarn" ? "resolutions" : "overrides";
    await svc.io.writeText(file, editJsonOverrides(original ?? "{}", field, edit));
  }
  const install = installCommand(workspace.pm);
  const result = await svc.io.run(install.program, install.args, { cwd: workspace.root });
  if (result.code !== 0) {
    // Nothing fixed, so nothing stays behind: put the file back, or remove it if this fix created it.
    if (original !== null) await svc.io.writeText(file, original);
    else await createGit(svc.io, workspace.root).raw(["clean", "-f", "--", relative(workspace.root, file)]);
    throw new Error(`${install.program} install failed:\n${result.stderr.slice(-2000)}`);
  }
  const now = new Date().toISOString();
  await svc.store.db.insert(runs).values({
    id: ulid().toLowerCase(),
    projectId,
    kind: "fix",
    title: `Override ${finding.name}`,
    startedAt: now,
    finishedAt: now,
    ok: true,
    result: {
      ok: true,
      message: `fix(deps): override ${finding.name} to ${value} (${finding.id})`,
      changes: [],
      touched: [],
    },
  });
  svc.invalidate(["runs", projectId]);
  await scanProject(svc, projectId);
  await refreshProject(svc, projectId);
}
