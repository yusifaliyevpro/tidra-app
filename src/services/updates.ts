import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { runs } from "@/core/db/schema";
import {
  revertUpdate,
  runUpdate,
  type Selection,
  type StepState,
  type UpdateResult,
  type UpdateStep,
} from "@/engine/apply";
import { githubSlug } from "@/engine/git";
import { createLimit } from "@/engine/limit";
import type { OutdatedEntry } from "@/engine/outdated";
import type { Bump } from "@/engine/versions";
import { loadWorkspace } from "@/engine/workspace";
import type { Services } from "./context";
import { projectChecks, refreshProject, type ProjectReport } from "./projects";

export interface RunProgress {
  runId: string;
  steps: Partial<Record<UpdateStep, { state: StepState; detail?: string }>>;
  log: string;
  result?: UpdateResult;
  pullRequestUrl?: string;
}

export type UpdatePick = { entry: OutdatedEntry; version: string };

/** Latest value per id plus its subscribers; late subscribers get the current value right away. */
function createChannel<T>() {
  const latest = new Map<string, T>();
  const listeners = new Map<string, Set<(value: T) => void>>();
  const emit = (id: string, value: T) => {
    latest.set(id, value);
    for (const listener of listeners.get(id) ?? []) listener(value);
  };
  const subscribe = (id: string, listener: (value: T) => void): (() => void) => {
    const set = listeners.get(id) ?? new Set();
    set.add(listener);
    listeners.set(id, set);
    const current = latest.get(id);
    if (current !== undefined) listener(current);
    return () => set.delete(listener);
  };
  return { emit, subscribe };
}

const runChannel = createChannel<RunProgress>();
const emitRun = (progress: RunProgress) =>
  runChannel.emit(progress.runId, { ...progress, steps: { ...progress.steps } });
export const subscribeRun = runChannel.subscribe;

export function branchName(now = new Date()): string {
  const stamp = now
    .toISOString()
    .slice(0, 16)
    .replace(/[-:T]/g, "")
    .replace(/^(\d{8})(\d{4})$/, "$1-$2");
  return `tidra/deps-${stamp}`;
}

/** Records the run and returns its id together with a promise for the finished progress. */
async function launchUpdate(svc: Services, projectId: string, picks: UpdatePick[]) {
  const project = await svc.store.getProject(projectId);
  if (!project?.path) throw new Error("This project has no folder on this device.");
  const path = project.path;
  const runId = ulid().toLowerCase();
  const title = picks.length === 1 ? `Update ${picks[0]?.entry.name}` : `Update ${picks.length} packages`;
  await svc.store.db
    .insert(runs)
    .values({ id: runId, projectId, kind: "update", title, startedAt: new Date().toISOString() });

  const progress: RunProgress = { runId, steps: {}, log: "" };
  emitRun(progress);

  const done = (async () => {
    const workspace = await loadWorkspace(svc.io, path);
    const selections: Selection[] = picks;
    const result = await runUpdate(svc.io, workspace, selections, {
      branch: project.updateOnBranch ? branchName() : undefined,
      checks: projectChecks(project, workspace),
      commit: true,
      push: project.pushAfterCommit || project.openPullRequest,
      onStep: (step, state, detail) => {
        progress.steps[step] = { state, detail };
        emitRun(progress);
      },
      onOutput: (chunk) => {
        progress.log += chunk;
        emitRun(progress);
      },
    });
    progress.result = result;

    if (result.ok && project.openPullRequest && result.createdBranch && project.remote) {
      try {
        const slug = githubSlug(`https://${project.remote}`);
        const github = await svc.github();
        if (slug && github.hasToken) {
          const repo = await github.repo(slug.owner, slug.repo);
          const pr = await github.createPull(repo.full_name, {
            title: title.replace("Update", "Bump"),
            head: result.createdBranch,
            base: repo.default_branch,
            body: picks
              .map((p) => `- \`${p.entry.name}\` ${p.entry.current ?? p.entry.range} → ${p.version}`)
              .join("\n"),
          });
          progress.pullRequestUrl = pr.html_url;
        }
      } catch (error) {
        progress.log += `\nCould not open a pull request: ${error instanceof Error ? error.message : String(error)}\n`;
      }
    }

    emitRun(progress);
    await svc.store.db
      .update(runs)
      .set({
        finishedAt: new Date().toISOString(),
        ok: result.ok,
        result: { ...result, changes: [] },
        log: progress.log,
      })
      .where(eq(runs.id, runId));
    await refreshProject(svc, projectId);
    await svc.queryClient.invalidateQueries({ queryKey: ["runs", projectId] });
    return progress;
  })();

  return { runId, done };
}

/** Starts an update in the background and returns its run id; progress streams to subscribers and is saved to `runs`. */
export async function startUpdate(svc: Services, projectId: string, picks: UpdatePick[]): Promise<string> {
  const { runId, done } = await launchUpdate(svc, projectId, picks);
  done.catch(() => undefined);
  return runId;
}

export interface BatchPlan {
  projectId: string;
  name: string;
  picks: UpdatePick[];
}

/** One plan per project with something to update in the given bump levels, each package going to its latest. */
export function planBatch(
  rows: { project: { id: string; name: string; path?: string | null }; report?: ProjectReport | null }[],
  bumps: ReadonlySet<Bump>,
): BatchPlan[] {
  return rows.flatMap(({ project, report }) => {
    if (!project.path || !report) return [];
    const picks = report.outdated.filter((e) => bumps.has(e.bump)).map((entry) => ({ entry, version: entry.latest }));
    return picks.length > 0 ? [{ projectId: project.id, name: project.name, picks }] : [];
  });
}

export type BatchItemState = "queued" | "running" | "ok" | "failed";

export interface BatchItem {
  projectId: string;
  name: string;
  packages: number;
  state: BatchItemState;
  runId?: string;
  detail?: string;
}

export interface BatchProgress {
  id: string;
  items: BatchItem[];
  done: boolean;
}

const batchChannel = createChannel<BatchProgress>();
export const subscribeBatch = batchChannel.subscribe;

/** Runs updates project by project, a few at a time, since each one installs and runs the project's checks. */
export function startBatch(svc: Services, plans: BatchPlan[], concurrency = 2): string {
  const id = ulid().toLowerCase();
  const items: BatchItem[] = plans.map((plan) => ({
    projectId: plan.projectId,
    name: plan.name,
    packages: plan.picks.length,
    state: "queued",
  }));
  const emit = (done = false) => batchChannel.emit(id, { id, items: items.map((item) => ({ ...item })), done });
  const set = (index: number, patch: Partial<BatchItem>) => {
    const item = items[index];
    if (item) items[index] = { ...item, ...patch };
    emit();
  };
  emit();

  const limit = createLimit(concurrency);
  void Promise.all(
    plans.map((plan, index) =>
      limit(async () => {
        set(index, { state: "running" });
        try {
          const { runId, done } = await launchUpdate(svc, plan.projectId, plan.picks);
          set(index, { runId });
          const { result } = await done;
          set(index, result?.ok ? { state: "ok" } : { state: "failed", detail: failureDetail(result) });
        } catch (error) {
          set(index, { state: "failed", detail: error instanceof Error ? error.message : String(error) });
        }
      }),
    ),
  ).then(() => emit(true));

  return id;
}

function failureDetail(result: UpdateResult | undefined) {
  if (!result) return "Did not finish";
  return result.failedStep ? `Failed at ${result.failedStep}${result.error ? `: ${result.error}` : ""}` : result.error;
}

export async function revertRun(svc: Services, projectId: string, result: UpdateResult): Promise<void> {
  const project = await svc.store.getProject(projectId);
  if (!project?.path) return;
  const workspace = await loadWorkspace(svc.io, project.path);
  await revertUpdate(svc.io, workspace, result);
  await refreshProject(svc, projectId);
}

export async function listRuns(svc: Services, projectId: string) {
  return svc.store.db.query.runs.findMany({
    where: eq(runs.projectId, projectId),
    orderBy: (table, { desc }) => desc(table.startedAt),
    limit: 20,
  });
}
