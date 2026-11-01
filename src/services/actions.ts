import { applyActionUpdates, currentVersion, nextRef, parseWorkflowUses, type ActionUse } from "@/engine/actions";
import { fingerprint } from "@/engine/fingerprint";
import { createGit } from "@/engine/git";
import { createLimit } from "@/engine/limit";
import { join } from "@/engine/path";
import type { Services } from "./context";
import { listRepos, type RepoGroup } from "./repos";
import { cached, HOUR, readSnapshot, readSnapshots, writeSnapshot } from "./snapshot";

export interface ActionItem extends ActionUse {
  file: string;
  current?: string;
  latestTag?: string;
  next?: { ref: string; comment?: string };
}

export interface ActionsReport {
  repoKey: string;
  items: ActionItem[];
  error?: string;
  /** Hash of every workflow file; unchanged workflows reuse the last answer while release lookups are cached. */
  fingerprint?: string;
  updatedAt: string;
}

const RESCAN_MS = 6 * HOUR;

export const actionsKey = (repoKey: string) => `actions:repo:${repoKey}`;

async function latestOf(svc: Services, repo: string) {
  const [owner = "", name = ""] = repo.split("/");
  return cached(svc, `gh-latest:${repo.toLowerCase()}`, 12 * HOUR, async () => ({
    latest: await (await svc.github()).latestRelease(owner, name),
  }));
}

/** Workflows live at the repo root, so a monorepo's packages share one scan. */
export async function scanActions(
  svc: Services,
  repo: Pick<RepoGroup, "key" | "root">,
  options: { force?: boolean } = {},
): Promise<ActionsReport> {
  const updatedAt = new Date().toISOString();
  if (!repo.root) return { repoKey: repo.key, items: [], updatedAt };
  const dir = join(repo.root, ".github", "workflows");
  const items: ActionItem[] = [];
  let error: string | undefined;
  let hash: string | undefined;
  try {
    if (!(await svc.io.exists(dir))) throw new NoWorkflows();
    const files = (await svc.io.readDir(dir)).filter((entry) => !entry.isDir && /\.ya?ml$/.test(entry.name));
    const texts = await Promise.all(files.map((entry) => svc.io.readText(join(dir, entry.name))));
    hash = await fingerprint(files.flatMap((entry, i) => [entry.name, texts[i]]));
    const previous = options.force ? undefined : await readActions(svc, repo.key);
    if (
      previous &&
      !previous.error &&
      previous.fingerprint === hash &&
      Date.parse(updatedAt) - Date.parse(previous.updatedAt) < RESCAN_MS
    ) {
      return previous;
    }
    const uses = files.flatMap((entry, i) =>
      parseWorkflowUses(texts[i] ?? "").map((use) => ({ ...use, file: `.github/workflows/${entry.name}` })),
    );
    const sources = [...new Set(uses.map((use) => use.repo))];
    const latest = new Map(
      await Promise.all(sources.map(async (source) => [source, (await latestOf(svc, source)).latest] as const)),
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
    if (!(caught instanceof NoWorkflows)) error = caught instanceof Error ? caught.message : String(caught);
  }
  const report = { repoKey: repo.key, items, error, fingerprint: hash, updatedAt };
  await writeSnapshot(svc, actionsKey(repo.key), report);
  return report;
}

class NoWorkflows extends Error {}

export async function readActions(svc: Services, repoKey: string) {
  return (await readSnapshot<ActionsReport>(svc, actionsKey(repoKey)))?.data;
}

/** Every repo with its last scan, for the Actions screen. */
export async function readAllActions(svc: Services) {
  const repos = await listRepos(svc);
  const reports = await readSnapshots<ActionsReport>(
    svc,
    repos.map((repo) => actionsKey(repo.key)),
  );
  return repos.map((repo, i) => ({ repo, report: reports[i] }));
}

/** Rewrites the selected refs and commits only the workflow files on the current branch. */
export async function applyActionUpdatesToRepo(svc: Services, repoKey: string, items: ActionItem[]): Promise<string> {
  const repo = (await listRepos(svc)).find((r) => r.key === repoKey);
  if (!repo?.root) throw new Error("This repository has no folder on this device.");
  const byFile = Map.groupBy(
    items.filter((i) => i.next),
    (i) => i.file,
  );
  const root = repo.root;
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
  const git = createGit(svc.io, root);
  await git.add([...byFile.keys()]);
  const names = [...new Set(items.map((i) => i.action))];
  const message =
    names.length === 1
      ? `ci: bump ${names[0]} to ${items[0]?.latestTag ?? "latest"}`
      : `ci: bump ${names.length} GitHub Actions`;
  await git.run(["commit", "-m", message, "--", ...byFile.keys()]);
  await scanActions(svc, repo, { force: true });
  await svc.queryClient.invalidateQueries({ queryKey: ["actions"] });
  return message;
}

export async function scanAllActions(svc: Services, signal?: AbortSignal) {
  const limit = createLimit(3);
  const repos = await listRepos(svc);
  await Promise.all(repos.map((repo) => limit(async () => (signal?.aborted ? undefined : scanActions(svc, repo)))));
  await svc.queryClient.invalidateQueries({ queryKey: ["actions"] });
}
