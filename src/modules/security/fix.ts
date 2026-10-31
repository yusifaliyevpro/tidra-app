import type { Finding } from "@/engine/advisories";
import { createGit } from "@/engine/git";
import { editJsonOverrides, editYamlOverrides } from "@/engine/manifest";
import { join } from "@/engine/path";
import { installCommand } from "@/engine/pm";
import { loadWorkspace } from "@/engine/workspace";
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

/** Transitive dependencies get an override (pnpm/npm/bun) or resolution (yarn), then a reinstall and commit. */
export async function fixWithOverride(svc: Services, projectId: string, finding: Finding): Promise<void> {
  const project = await svc.store.getProject(projectId);
  if (!project?.path || !finding.fixedIn) throw new Error("No fixed version is known for this advisory.");
  const workspace = await loadWorkspace(svc.io, project.path);
  const value = `^${finding.fixedIn}`;
  let file: string;
  if (workspace.pm.name === "pnpm") {
    file = join(workspace.root, "pnpm-workspace.yaml");
    const text = (await svc.io.readText(file)) ?? "";
    await svc.io.writeText(file, editYamlOverrides(text, [{ name: finding.name, value }]));
  } else {
    file = join(workspace.root, "package.json");
    const text = workspace.importers[0]?.manifestText ?? "{}";
    await svc.io.writeText(
      file,
      editJsonOverrides(text, workspace.pm.name === "yarn" ? "resolutions" : "overrides", [
        { name: finding.name, value },
      ]),
    );
  }
  const install = installCommand(workspace.pm);
  const result = await svc.io.run(install.program, install.args, { cwd: workspace.root });
  if (result.code !== 0) throw new Error(`${install.program} install failed:\n${result.stderr.slice(-2000)}`);
  const git = createGit(svc.io, workspace.root);
  const status = await git.status().catch(() => undefined);
  if (status) {
    const candidates = [
      file.slice(workspace.root.length + 1),
      "pnpm-lock.yaml",
      "package-lock.json",
      "yarn.lock",
      "bun.lock",
    ];
    const present = [];
    for (const path of candidates) if (await svc.io.exists(join(workspace.root, path))) present.push(path);
    await git.add(present);
    await git.commit(`fix(deps): override ${finding.name} to ${value} (${finding.id})`);
  }
  await scanProject(svc, projectId);
  await refreshProject(svc, projectId);
}
