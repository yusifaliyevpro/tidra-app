import { createGit, GitError, isClean } from "./git";
import type { Io, OutputStream } from "./io";
import { editCatalogs, editManifest, type CatalogEdit, type ManifestEdit } from "./manifest";
import type { OutdatedEntry } from "./outdated";
import { relative } from "./path";
import { display, installCommand, type Check, type Command } from "./pm";
import { formatSpec } from "./spec";
import type { Workspace } from "./workspace";

export interface Selection {
  entry: OutdatedEntry;
  version: string;
}

export interface FileChange {
  path: string;
  before: string;
  after: string;
}

/** Computes every file rewrite for the selection. Peer ranges are left alone; they describe consumers, not this project. */
export function planFileChanges(workspace: Workspace, selections: Selection[]): FileChange[] {
  const manifestEdits = new Map<string, ManifestEdit[]>();
  const importers = new Map(workspace.importers.map((i) => [i.path, i]));
  const catalogEdits: CatalogEdit[] = [];

  for (const { entry, version } of selections) {
    if (entry.catalog) {
      catalogEdits.push({
        catalog: entry.catalog,
        name: entry.name,
        value: formatSpec(entry.range, version, workspace.saveExact),
      });
      continue;
    }
    for (const usage of entry.usages) {
      if (usage.field === "peerDependencies") continue;
      const importer = importers.get(usage.importer);
      if (!importer) continue;
      const key = Object.entries(importer.manifest[usage.field] ?? {}).find(([, v]) => v === usage.spec)?.[0];
      if (!key) continue;
      const edits = manifestEdits.get(importer.manifestPath) ?? [];
      edits.push({ field: usage.field, name: key, value: formatSpec(usage.spec, version, workspace.saveExact) });
      manifestEdits.set(importer.manifestPath, edits);
    }
  }

  const changes: FileChange[] = [];
  for (const importer of workspace.importers) {
    const edits = manifestEdits.get(importer.manifestPath);
    if (!edits) continue;
    const after = editManifest(importer.manifestText, edits);
    if (after !== importer.manifestText)
      changes.push({ path: importer.manifestPath, before: importer.manifestText, after });
  }
  if (catalogEdits.length > 0 && workspace.workspaceYaml) {
    const { path, text } = workspace.workspaceYaml;
    const after = editCatalogs(text, catalogEdits);
    if (after !== text) changes.push({ path, before: text, after });
  }
  return changes;
}

/** `chore(deps): bump react 19.2.0 → 19.3.1` for one package; a summary line plus a list for several. */
export function commitMessage(selections: Selection[]): string {
  const line = ({ entry, version }: Selection) => `${entry.name} ${entry.current ?? entry.range} → ${version}`;
  if (selections.length === 1 && selections[0]) return `chore(deps): bump ${line(selections[0])}`;
  return [`chore(deps): bump ${selections.length} dependencies`, "", ...selections.map((s) => `- ${line(s)}`)].join(
    "\n",
  );
}

export const UPDATE_STEPS = ["preflight", "branch", "write", "install", "checks", "commit", "push"] as const;
export type UpdateStep = (typeof UPDATE_STEPS)[number];
export type StepState = "running" | "done" | "skipped" | "failed";

export interface UpdateOptions {
  /** Create and switch to this branch first; `undefined` updates the current branch. */
  branch?: string;
  /** Stash local changes instead of refusing to run on a dirty tree. */
  stash?: boolean;
  checks: Check[];
  commit: boolean;
  push: boolean;
  onStep?: (step: UpdateStep, state: StepState, detail?: string) => void;
  onOutput?: (chunk: string, stream: OutputStream) => void;
  signal?: AbortSignal;
}

export interface UpdateResult {
  ok: boolean;
  failedStep?: UpdateStep;
  error?: string;
  previousBranch?: string;
  createdBranch?: string;
  commitSha?: string;
  changes: FileChange[];
  /** Files the update touched, relative to the project root, for revert. */
  touched: string[];
}

const LOCKFILE_NAMES = [
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "npm-shrinkwrap.json",
];

export async function runUpdate(
  io: Io,
  workspace: Workspace,
  selections: Selection[],
  options: UpdateOptions,
): Promise<UpdateResult> {
  const git = createGit(io, workspace.root);
  const changes = planFileChanges(workspace, selections);
  const result: UpdateResult = { ok: false, changes, touched: [] };
  let step: UpdateStep = "preflight";

  const exec = async (command: Command) => {
    options.onOutput?.(`$ ${display(command)}\n`, "stdout");
    const run = await io.run(command.program, command.args, {
      cwd: workspace.root,
      env: { FORCE_COLOR: "1" },
      onOutput: options.onOutput,
      signal: options.signal,
    });
    if (run.code !== 0) throw new Error(`${display(command)} exited with ${run.code ?? "a signal"}`);
  };
  const begin = (next: UpdateStep, detail?: string) => {
    step = next;
    options.onStep?.(next, "running", detail);
  };
  const skip = (next: UpdateStep) => options.onStep?.(next, "skipped");
  const done = () => options.onStep?.(step, "done");

  try {
    begin("preflight");
    if (changes.length === 0) throw new Error("Nothing to update: the selected versions are already written.");
    const status = await git.status();
    result.previousBranch = status.branch;
    if (!isClean(status)) {
      if (!options.stash) throw new Error("The working tree has uncommitted changes. Commit or stash them first.");
      await git.stash();
    }
    done();

    if (options.branch) {
      begin("branch", options.branch);
      await git.switchCreate(options.branch);
      result.createdBranch = options.branch;
      done();
    } else skip("branch");

    begin("write");
    for (const change of changes) await io.writeText(change.path, change.after);
    result.touched = changes.map((c) => relative(workspace.root, c.path));
    done();

    begin("install");
    await exec(installCommand(workspace.pm));
    for (const name of LOCKFILE_NAMES) {
      if (await io.exists(`${workspace.root}/${name}`)) result.touched.push(name);
    }
    done();

    if (options.checks.length > 0) {
      begin("checks");
      for (const check of options.checks) await exec(check.command);
      done();
    } else skip("checks");

    if (options.commit) {
      begin("commit");
      await git.add(result.touched);
      await git.commit(commitMessage(selections));
      result.commitSha = await git.headSha();
      done();
    } else skip("commit");

    if (options.push && options.commit && result.createdBranch) {
      begin("push");
      await git.push(result.createdBranch);
      done();
    } else skip("push");

    result.ok = true;
  } catch (error) {
    result.failedStep = step;
    result.error = error instanceof GitError || error instanceof Error ? error.message : String(error);
    options.onStep?.(step, "failed", result.error);
  }
  return result;
}

/** Undoes an update that has not been committed: restores files, leaves the created branch, reinstalls. */
export async function revertUpdate(
  io: Io,
  workspace: Workspace,
  result: UpdateResult,
  onOutput?: UpdateOptions["onOutput"],
) {
  const git = createGit(io, workspace.root);
  if (result.touched.length > 0) await git.restore(result.touched);
  if (result.createdBranch && result.previousBranch) {
    await git.switchTo(result.previousBranch);
    await git.deleteBranch(result.createdBranch);
  }
  const command = installCommand(workspace.pm);
  await io.run(command.program, command.args, { cwd: workspace.root, onOutput });
}
