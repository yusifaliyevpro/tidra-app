import { applyActionUpdates, currentVersion, nextRef, parseWorkflowUses, type ActionUse } from "@/engine/actions";
import { fingerprint } from "@/engine/fingerprint";
import { createGit } from "@/engine/git";
import { createLimit } from "@/engine/limit";
import { join } from "@/engine/path";
import type { Services } from "./context";
import { refreshProject } from "./projects";
import { ACTIONS_BRANCH_PREFIX } from "./pull-requests";
import { listRepos, type RepoGroup } from "./repos";
import { cached, HOUR, readSnapshot, readSnapshots, writeSnapshot } from "./snapshot";
import { branchName } from "./updates";

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

/**
 * Rewrites the selected refs on a `tidra/actions-<date>` branch cut from the default branch (or keeps adding to the
 * Actions branch already checked out) and commits only the workflow files. Uncommitted work elsewhere is carried
 * along untouched. Returns the commit message and branch for the toast.
 */
export async function applyActionUpdatesToRepo(
  svc: Services,
  repoKey: string,
  items: ActionItem[],
): Promise<{ message: string; branch: string }> {
  const repo = (await listRepos(svc)).find((r) => r.key === repoKey);
  if (!repo?.root) throw new Error("This repository has no folder on this device.");
  const root = repo.root;
  const git = createGit(svc.io, root);
  const status = await git.status();
  let branch = status.branch;
  let created: { name: string; from: string | undefined } | undefined;
  if (!branch?.startsWith(ACTIONS_BRANCH_PREFIX)) {
    const base = (await git.defaultBranch()) ?? branch;
    const name = branchName(new Date(), ACTIONS_BRANCH_PREFIX);
    await git.run(["switch", "-c", name, ...(base ? [base] : [])]);
    created = { name, from: status.branch };
    branch = name;
  }

  // The base branch can differ from what was scanned, so updates are matched by action and ref, not line number.
  const wanted = items.filter((i) => i.next);
  const applied: ActionItem[] = [];
  await Promise.all(
    [...Map.groupBy(wanted, (i) => i.file)].map(async ([file, fileItems]) => {
      const path = join(root, file);
      const text = await svc.io.readText(path);
      if (text === null) return;
      const uses = parseWorkflowUses(text);
      const updates = fileItems.flatMap((item) =>
        uses
          .filter((use) => use.action === item.action && use.ref === item.ref)
          .map((use) => {
            applied.push(item);
            return { line: use.line, ref: item.next?.ref ?? use.ref, comment: item.next?.comment };
          }),
      );
      if (updates.length > 0) await svc.io.writeText(path, applyActionUpdates(text, updates));
    }),
  );
  if (applied.length === 0) {
    if (created) {
      await git.switchTo(created.from ?? "-");
      await git.deleteBranch(created.name);
    }
    throw new Error("These actions are already up to date on the default branch.");
  }

  const files = [...new Set(applied.map((i) => i.file))];
  await git.add(files);
  const names = [...new Set(applied.map((i) => i.action))];
  const message =
    names.length === 1
      ? `ci: bump ${names[0]} to ${applied[0]?.latestTag ?? "latest"}`
      : `ci: bump ${names.length} GitHub Actions`;
  await git.run(["commit", "-m", message, "--", ...files]);
  await scanActions(svc, repo, { force: true });
  await Promise.all(repo.projects.map((p) => refreshProject(svc, p.id)));
  await svc.queryClient.invalidateQueries({ queryKey: ["actions"] });
  return { message, branch };
}

export async function scanAllActions(svc: Services, signal?: AbortSignal) {
  const limit = createLimit(3);
  const repos = await listRepos(svc);
  await Promise.all(repos.map((repo) => limit(async () => (signal?.aborted ? undefined : scanActions(svc, repo)))));
  await svc.queryClient.invalidateQueries({ queryKey: ["actions"] });
}

/** Instructions an AI coding agent can follow to bump the outdated actions and handle any breaking changes. */
export function actionsUpdatePrompt(repo: { label: string; github?: string; root?: string }, items: ActionItem[]) {
  const outdated = items.filter((i) => i.next);
  const byAction = Map.groupBy(outdated, (i) => i.action);
  const lines = [...byAction].map(([action, uses]) => {
    const [first] = uses;
    const from = first?.current ?? first?.ref ?? "?";
    const to = first?.latestTag ?? first?.next?.ref ?? "latest";
    const where = uses.map((u) => `${u.file}:${u.line + 1}`).join(", ");
    return `- ${action}: ${from} → ${to} (${where}). Release notes: https://github.com/${first?.repo ?? action}/releases`;
  });
  return [
    `Update the outdated GitHub Actions in ${repo.github ?? repo.label}${repo.root ? ` (${repo.root})` : ""}:`,
    "",
    ...lines,
    "",
    "For each action:",
    "1. Read the release notes between the current and new version, especially major releases.",
    "2. Bump the `uses:` ref. Keep the existing pinning style: a SHA pin stays a full commit SHA with the version in a trailing comment, a major tag stays a major tag.",
    "3. Apply whatever the new version needs: renamed or removed inputs, changed outputs, new required permissions, runner or Node version requirements, and any project config those changes touch.",
    "",
    "Work on a new branch, keep the change limited to what these updates require, and commit with a message like `ci: bump GitHub Actions`. Finish with a short list of the breaking changes you handled and anything you could not verify.",
  ].join("\n");
}
