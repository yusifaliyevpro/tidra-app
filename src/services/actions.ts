import { applyActionUpdates, currentVersion, nextRef, parseWorkflowUses, type ActionUse } from "@/engine/actions";
import { createGit } from "@/engine/git";
import { join } from "@/engine/path";
import { GitHubError } from "@/integrations/github";
import type { Services } from "./context";
import { cached, HOUR, readSnapshot, writeSnapshot } from "./snapshot";

export interface ActionItem extends ActionUse {
  file: string;
  current?: string;
  latestTag?: string;
  next?: { ref: string; comment?: string };
}

export interface ActionsReport {
  projectId: string;
  items: ActionItem[];
  error?: string;
  updatedAt: string;
}

export const actionsKey = (projectId: string) => `actions:${projectId}`;

async function latestOf(svc: Services, repo: string) {
  const [owner = "", name = ""] = repo.split("/");
  return cached(svc, `gh-latest:${repo.toLowerCase()}`, 12 * HOUR, async () => ({
    latest: await (await svc.github()).latestRelease(owner, name),
  }));
}

export async function scanActions(svc: Services, projectId: string): Promise<ActionsReport> {
  const project = await svc.store.getProject(projectId);
  const updatedAt = new Date().toISOString();
  if (!project?.path) return { projectId, items: [], updatedAt };
  const dir = join(project.path, ".github", "workflows");
  const items: ActionItem[] = [];
  let error: string | undefined;
  try {
    const files = (await svc.io.readDir(dir)).filter((entry) => !entry.isDir && /\.ya?ml$/.test(entry.name));
    const texts = await Promise.all(files.map((entry) => svc.io.readText(join(dir, entry.name))));
    const uses = files.flatMap((entry, i) =>
      parseWorkflowUses(texts[i] ?? "").map((use) => ({ ...use, file: `.github/workflows/${entry.name}` })),
    );
    const repos = [...new Set(uses.map((use) => use.repo))];
    const latest = new Map(
      await Promise.all(repos.map(async (repo) => [repo, (await latestOf(svc, repo)).latest] as const)),
    );
    for (const use of uses) {
      const release = latest.get(use.repo);
      items.push({
        ...use,
        current: currentVersion(use),
        latestTag: release?.tag,
        next: release ? nextRef(use, release.tag, release.sha) : undefined,
      });
    }
  } catch (caught) {
    error = caught instanceof GitHubError && caught.rateLimited ? caught.message : String(caught);
  }
  const report = { projectId, items, error, updatedAt };
  await writeSnapshot(svc, actionsKey(projectId), report);
  return report;
}

export async function readActions(svc: Services, projectId: string) {
  return (await readSnapshot<ActionsReport>(svc, actionsKey(projectId)))?.data;
}

/** Rewrites the selected refs and commits them on the current branch. */
export async function applyActionUpdatesToProject(
  svc: Services,
  projectId: string,
  items: ActionItem[],
): Promise<void> {
  const project = await svc.store.getProject(projectId);
  if (!project?.path) throw new Error("This project has no folder on this device.");
  const byFile = Map.groupBy(
    items.filter((i) => i.next),
    (i) => i.file,
  );
  const root = project.path;
  await Promise.all(
    [...byFile].map(async ([file, fileItems]) => {
      const path = join(root, file);
      const text = (await svc.io.readText(path)) ?? "";
      const updates = fileItems.flatMap((i) =>
        i.next ? [{ line: i.line, ref: i.next.ref, comment: i.next.comment }] : [],
      );
      await svc.io.writeText(path, applyActionUpdates(text, updates));
    }),
  );
  const git = createGit(svc.io, project.path);
  await git.add([...byFile.keys()]);
  const names = [...new Set(items.map((i) => i.action))];
  await git.commit(
    names.length === 1
      ? `ci: bump ${names[0]} to ${items[0]?.latestTag ?? "latest"}`
      : `ci: bump ${names.length} GitHub Actions`,
  );
  await scanActions(svc, projectId);
  await svc.queryClient.invalidateQueries({ queryKey: ["actions"] });
}

export async function scanAllActions(svc: Services, signal?: AbortSignal) {
  for (const project of await svc.store.listProjects()) {
    if (signal?.aborted) return;
    await scanActions(svc, project.id);
  }
  await svc.queryClient.invalidateQueries({ queryKey: ["actions"] });
}
