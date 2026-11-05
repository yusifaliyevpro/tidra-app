import { createGit, GitError, isClean } from "./git";
import type { Io, OutputStream } from "./io";
import { editCatalogs, editManifest, type CatalogEdit, type ManifestEdit } from "./manifest";
import type { OutdatedEntry } from "./outdated";
import { join, relative } from "./path";
import { addCommand, display, installCommand, type AddField, type Check, type Command } from "./pm";
import { formatSpec, rangeStyle } from "./spec";
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

/**
 * The package.json key for a dependency: its own name, or an alias whose `npm:` spec points at it. Matching on the
 * spec alone would confuse packages that share a version, like a family of `@tiptap/*` packages all at 3.32.0.
 */
export function manifestKey(deps: Record<string, string> | undefined, name: string, spec: string): string | undefined {
  if (!deps) return undefined;
  if (deps[name] === spec) return name;
  return Object.entries(deps).find(([, value]) => value === spec && value.startsWith(`npm:${name}@`))?.[0];
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
      const key = manifestKey(importer.manifest[usage.field], entry.name, usage.spec);
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

export interface AddStep {
  /** Importer folder relative to the workspace root, "." for the root. */
  importer: string;
  command: Command;
}

/**
 * The package-manager commands that apply the selection: one `add` per importer, dependency field and pin style, so
 * the manager writes package.json and the lockfile itself. Catalog entries are not covered; they live in the catalog.
 */
export function planAddCommands(workspace: Workspace, selections: Selection[]): AddStep[] {
  const groups = new Map<string, { importer: string; field: AddField; exact: boolean; specs: string[] }>();
  const importers = new Map(workspace.importers.map((i) => [i.path, i]));
  for (const { entry, version } of selections) {
    if (entry.catalog) continue;
    for (const usage of entry.usages) {
      if (usage.field === "peerDependencies") continue;
      const importer = importers.get(usage.importer);
      const key = manifestKey(importer?.manifest[usage.field], entry.name, usage.spec);
      if (!key) continue;
      const spec = formatSpec(usage.spec, version, workspace.saveExact);
      const exact = rangeStyle(spec) === "exact";
      const id = `${usage.importer}\u0000${usage.field}\u0000${exact}`;
      const group = groups.get(id) ?? { importer: usage.importer, field: usage.field, exact, specs: [] };
      group.specs.push(`${key}@${spec}`);
      groups.set(id, group);
    }
  }
  return [...groups.values()].map(({ importer, field, exact, specs }) => ({
    importer,
    command: addCommand(workspace.pm, specs, field, {
      exact,
      inWorkspaceRoot: importer === "." && workspace.importers.length > 1,
    }),
  }));
}

/** `chore(deps): bump react 19.2.0 → 19.3.1` for one package; a summary line plus a list for several. */
export function commitMessage(selections: Selection[]): string {
  const line = ({ entry, version }: Selection) => `${entry.name} ${entry.current ?? entry.range} → ${version}`;
  if (selections.length === 1 && selections[0]) return `chore(deps): bump ${line(selections[0])}`;
  return [`chore(deps): bump ${selections.length} dependencies`, "", ...selections.map((s) => `- ${line(s)}`)].join(
    "\n",
  );
}

/** Stops after the checks: committing is always the user's click. */
export const UPDATE_STEPS = ["preflight", "branch", "write", "install", "checks"] as const;
export type UpdateStep = (typeof UPDATE_STEPS)[number];
export type StepState = "running" | "done" | "skipped" | "failed";

export interface UpdateOptions {
  /** Create and switch to this branch first; `undefined` updates the current branch. */
  branch?: string;
  checks: Check[];
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
  /** The message Commit uses for this update's changes. */
  message?: string;
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
  const result: UpdateResult = { ok: false, changes, touched: [], message: commitMessage(selections) };
  let step: UpdateStep = "preflight";

  const exec = async (command: Command, cwd = workspace.root) => {
    options.onOutput?.(
      `$ ${display(command)}
`,
      "stdout",
    );
    const run = await io.run(command.program, command.args, {
      cwd,
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
  const catalogChanges = changes.filter((c) => c.path === workspace.workspaceYaml?.path);
  const adds = planAddCommands(workspace, selections);

  try {
    begin("preflight");
    if (changes.length === 0) throw new Error("Nothing to update: the selected versions are already written.");
    const status = await git.status();
    result.previousBranch = status.branch;
    if (!isClean(status)) throw new Error("The working tree has uncommitted changes. Commit or stash them first.");
    done();

    if (options.branch) {
      begin("branch", options.branch);
      await git.switchCreate(options.branch);
      result.createdBranch = options.branch;
      done();
    } else skip("branch");

    result.touched = changes.map((c) => relative(workspace.root, c.path));
    if (catalogChanges.length > 0) {
      begin("write");
      for (const change of catalogChanges) await io.writeText(change.path, change.after);
      done();
    } else skip("write");

    begin("install");
    try {
      for (const add of adds) await exec(add.command, join(workspace.root, add.importer));
      if (catalogChanges.length > 0) await exec(installCommand(workspace.pm));
    } finally {
      // Also when an install fails: an earlier one may already have rewritten the lockfile, and Revert must restore it.
      for (const dir of new Set([".", ...adds.map((a) => a.importer)])) {
        for (const name of LOCKFILE_NAMES) {
          const path = dir === "." ? name : `${dir}/${name}`;
          if (!result.touched.includes(path) && (await io.exists(join(workspace.root, path))))
            result.touched.push(path);
        }
      }
    }
    done();

    if (options.checks.length > 0) {
      begin("checks");
      for (const check of options.checks) await exec(check.command);
      done();
    } else skip("checks");

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
