import {
  applyActionUpdates,
  currentVersion,
  nextRef,
  parseWorkflowUses,
  setInputValue,
  type ActionUse,
  type ToolInput,
} from "@/engine/actions";
import { fingerprint } from "@/engine/fingerprint";
import { createGit } from "@/engine/git";
import { createLimit } from "@/engine/limit";
import { join } from "@/engine/path";
import type { Services } from "./context";
import { checkoutRoot, refreshProject } from "./projects";
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
  /** A release lookup failed, so the next scan shouldn't reuse this one. */
  incomplete?: boolean;
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
  let incomplete = false;
  try {
    if (!(await svc.io.exists(dir))) throw new NoWorkflows();
    const files = (await svc.io.readDir(dir)).filter((entry) => !entry.isDir && /\.ya?ml$/.test(entry.name));
    const texts = await Promise.all(files.map((entry) => svc.io.readText(join(dir, entry.name))));
    // The leading marker retires reports saved before tool versions were read.
    hash = await fingerprint(["tool-inputs", ...files.flatMap((entry, i) => [entry.name, texts[i]])]);
    const previous = options.force ? undefined : await readActions(svc, repo.key);
    if (
      previous &&
      !previous.error &&
      !previous.incomplete &&
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
      await Promise.all(
        sources.map(async (source) => {
          // One failed lookup (rate limit, a repo gone) only skips that action.
          const found = await latestOf(svc, source).catch(() => {
            incomplete = true;
            return undefined;
          });
          return [source, found?.latest] as const;
        }),
      ),
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
  const report = { repoKey: repo.key, items, error, fingerprint: hash, incomplete, updatedAt };
  await writeSnapshot(svc, actionsKey(repo.key), report);
  return report;
}

class NoWorkflows extends Error {}

export async function readActions(svc: Services, repoKey: string) {
  return (await readSnapshot<ActionsReport>(svc, actionsKey(repoKey)))?.data;
}

/** Every repo with its last scan, for the Actions screen. */
export async function readAllActions(svc: Services, known?: RepoGroup[]) {
  const repos = known ?? (await listRepos(svc));
  const reports = await readSnapshots<ActionsReport>(
    svc,
    repos.map((repo) => actionsKey(repo.key)),
  );
  return repos.map((repo, i) => ({ repo, report: reports[i] }));
}

/**
 * Rewrites the selected refs on the current branch and commits only the workflow files; the user picks the branch
 * beforehand. Uncommitted work elsewhere stays out of the commit. Returns the commit message and branch for the toast.
 */
export async function applyActionUpdatesToRepo(
  svc: Services,
  repoKey: string,
  items: ActionItem[],
): Promise<{ message: string; branch: string }> {
  const { repo, root, git } = await openRepo(svc, repoKey);

  // The files can differ from what was scanned, so updates are matched by action and ref, not line number.
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
  if (applied.length === 0) throw new Error("These actions are already up to date on this branch.");

  const files = [...new Set(applied.map((i) => i.file))];
  const names = [...new Set(applied.map((i) => i.action))];
  const message =
    names.length === 1
      ? `ci: bump ${names[0]} to ${applied[0]?.latestTag ?? "latest"}`
      : `ci: bump ${names.length} GitHub Actions`;
  return { message, branch: await commitWorkflows(svc, repo, git, files, message) };
}

async function openRepo(svc: Services, repoKey: string) {
  const repo = (await listRepos(svc)).find((r) => r.key === repoKey);
  if (!repo?.root) throw new Error("This repository has no folder on this device.");
  return { repo, root: repo.root, git: createGit(svc.io, repo.root) };
}

async function commitWorkflows(
  svc: Services,
  repo: RepoGroup,
  git: ReturnType<typeof createGit>,
  files: string[],
  message: string,
) {
  await git.add(files);
  await git.run(["commit", "-m", message, "--", ...files]);
  const branch = (await git.status()).branch ?? "HEAD";
  await scanActions(svc, repo, { force: true });
  await Promise.all(repo.projects.map((p) => refreshProject(svc, p.id)));
  await svc.queryClient.invalidateQueries({ queryKey: ["actions"] });
  return branch;
}

/**
 * Sets a tool version input (setup-node's `node-version`, pnpm's `version`) wherever the same action sets it to the
 * same value in that workflow file, and commits it on the current branch: the user picks the branch beforehand.
 */
export async function setToolVersion(
  svc: Services,
  repoKey: string,
  item: Pick<ActionItem, "file" | "action">,
  input: ToolInput,
  value: string,
): Promise<{ message: string; branch: string }> {
  const next = value.trim();
  if (!next) throw new Error(`Enter a ${input.tool} version.`);
  if (next === input.value) throw new Error(`${input.tool} is already ${next} in this workflow.`);
  const { repo, root, git } = await openRepo(svc, repoKey);
  const path = join(root, item.file);
  const text = await svc.io.readText(path);
  // The file can differ from what was scanned, so inputs are matched by action, name and value.
  const lines = (text === null ? [] : parseWorkflowUses(text))
    .filter((use) => use.action === item.action)
    .flatMap((use) => use.inputs ?? [])
    .filter((found) => found.name === input.name && found.value === input.value)
    .map((found) => found.line);
  if (text === null || lines.length === 0) {
    throw new Error(
      `${item.file} no longer sets ${input.tool} ${input.value}. Check again to see its current version.`,
    );
  }
  await svc.io.writeText(
    path,
    lines.reduce((current, line) => setInputValue(current, line, next), text),
  );
  const message = `ci: use ${input.tool} ${next}`;
  return { message, branch: await commitWorkflows(svc, repo, git, [item.file], message) };
}

/** Another branch or pulled commits can bring other workflows: rescans the repos these packages live in. */
export async function rescanActionsOf(svc: Services, projectIds: string[]) {
  // From the project list, not listRepos: that reads every report, and this runs on each branch switch.
  const wanted = new Set(projectIds);
  const roots = new Map<string, string>();
  for (const project of await svc.store.listProjects()) {
    const root = checkoutRoot(project);
    if (root && wanted.has(project.id)) roots.set(project.remote ?? root, root);
  }
  await Promise.all([...roots].map(([key, root]) => scanActions(svc, { key, root })));
  svc.invalidate(["actions"]);
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
