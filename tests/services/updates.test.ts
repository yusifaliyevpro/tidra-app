import { describe, expect, it, vi } from "vitest";
import { runs } from "@/core/db/schema";
import type { RunResult } from "@/engine/io";
import {
  branchName,
  freshBranchName,
  finishInterruptedRuns,
  listRuns,
  revertRun,
  startBatch,
  startUpdate,
  subscribeBatch,
  subscribeRun,
  type BatchProgress,
  type RunProgress,
  type UpdatePick,
} from "@/services/updates";
import { memoryIo, ok } from "../support/memory-io";
import { outdatedEntry, testServices } from "../support/services";

describe("startBatch", () => {
  it("marks projects that cannot start as failed and finishes", async () => {
    const { svc, close } = await testServices();
    const id = startBatch(svc, [
      {
        projectId: "missing",
        name: "A",
        picks: [{ entry: outdatedEntry("x", "1.0.0", "1.0.1", "patch"), version: "1.0.1" }],
      },
    ]);
    const final = await new Promise<BatchProgress>((resolve) => {
      subscribeBatch(id, (progress) => {
        if (progress.done) resolve(progress);
      });
    });
    close();
    expect(final.items).toEqual([
      expect.objectContaining({
        projectId: "missing",
        state: "failed",
        detail: "This project has no folder on this device.",
      }),
    ]);
  });
});

describe("update runs", () => {
  it("records a run that throws as failed instead of leaving it running", async () => {
    const { svc, close } = await testServices(memoryIo({}));
    await svc.store.addProject({ id: "p1", name: "web", remote: null, path: "/web" });
    const id = startBatch(svc, [
      {
        projectId: "p1",
        name: "web",
        picks: [{ entry: outdatedEntry("x", "1.0.0", "1.0.1", "patch"), version: "1.0.1" }],
      },
    ]);
    await new Promise<void>((resolve) => {
      subscribeBatch(id, (progress) => {
        if (progress.done) resolve();
      });
    });
    const [run] = await listRuns(svc, "p1");
    close();
    expect(run).toEqual(
      expect.objectContaining({ ok: false, log: expect.stringContaining("No readable package.json") }),
    );
    expect(run?.finishedAt).toBeTruthy();
  });

  it("marks runs left unfinished by a previous session as failed", async () => {
    const { svc, close } = await testServices();
    const startedAt = new Date().toISOString();
    await svc.store.db.insert(runs).values([
      { id: "a", projectId: "p1", kind: "update", title: "Update 1 package", startedAt },
      {
        id: "b",
        projectId: "p1",
        kind: "update",
        title: "Update 1 package",
        startedAt,
        finishedAt: startedAt,
        ok: true,
      },
    ]);
    await finishInterruptedRuns(svc);
    const all = await listRuns(svc, "p1");
    close();
    expect(all.map((r) => [r.id, r.ok])).toEqual(
      expect.arrayContaining([
        ["a", false],
        ["b", true],
      ]),
    );
    expect(all.every((r) => r.finishedAt)).toBe(true);
    expect(all.find((r) => r.id === "a")?.log).toContain("Tidra closed before this update finished.");
  });
});

const MANIFEST = '{\n  "name": "web",\n  "scripts": { "check": "tsc" },\n  "dependencies": { "react": "^18.3.1" }\n}\n';
const react = (version = "19.3.1"): UpdatePick => ({
  entry: outdatedEntry("react", "18.3.1", version, "major"),
  version,
});

async function project(
  run: (program: string, args: string[]) => RunResult = () => ok("# branch.oid a\n# branch.head main\n"),
) {
  const io = memoryIo({ "/web/package.json": MANIFEST }, { run: (program, args) => run(program, args) });
  const { svc, close } = await testServices(io);
  await svc.store.addProject({ id: "p1", name: "web", remote: null, path: "/web" });
  return { io, svc, close };
}

const finished = (runId: string) =>
  new Promise<RunProgress>((resolve) => {
    const stop = subscribeRun(runId, (progress) => {
      if (progress.result) {
        stop();
        resolve(progress);
      }
    });
  });

describe("branchName", () => {
  it("stamps the UTC date and minute", () => {
    expect(branchName(new Date("2026-11-04T09:05:59Z"))).toBe("tidra/deps-20261104-0905");
    expect(branchName(new Date("2026-11-04T09:05:00Z"), "tidra/actions-")).toBe("tidra/actions-20261104-0905");
  });
});

describe("freshBranchName", () => {
  it("adds a number when the stamped name is taken", () => {
    const now = new Date("2026-11-04T09:05:00Z");
    expect(freshBranchName(["main"], now)).toBe("tidra/deps-20261104-0905");
    expect(freshBranchName(["tidra/deps-20261104-0905", "tidra/deps-20261104-0905-2"], now)).toBe(
      "tidra/deps-20261104-0905-3",
    );
  });
});

describe("startUpdate", () => {
  it("runs on the current branch, runs the checks and records a successful run with its commit message", async () => {
    const { io, svc, close } = await project();
    const runId = await startUpdate(svc, "p1", [react()]);
    const progress = await finished(runId);
    await vi.waitFor(async () => expect((await listRuns(svc, "p1"))[0]?.finishedAt).toBeTruthy());
    const [run] = await listRuns(svc, "p1");
    close();
    expect(progress.result).toMatchObject({ ok: true, message: "chore(deps): bump react 18.3.1 → 19.3.1" });
    expect(progress.steps).toMatchObject({
      preflight: { state: "done" },
      checks: { state: "done" },
    });
    expect(progress.log).toContain("$ npm run check");
    expect(run).toMatchObject({ id: runId, title: "Update react", ok: true });
    expect(io.runs.some((r) => r.args[0] === "switch")).toBe(false);
  });

  it("records a failing check as a failed run", async () => {
    const { svc, close } = await project((program, args) =>
      program === "npm" && args[0] === "run"
        ? { code: 2, stdout: "", stderr: "type error" }
        : ok("# branch.oid a\n# branch.head main\n"),
    );
    const progress = await finished(await startUpdate(svc, "p1", [react()]));
    await vi.waitFor(async () => expect((await listRuns(svc, "p1"))[0]?.ok).toBe(false));
    close();
    expect(progress.result).toMatchObject({ ok: false, failedStep: "checks" });
  });

  it("refuses a project without a folder on this device", async () => {
    const { svc, close } = await project();
    await expect(startUpdate(svc, "missing", [react()])).rejects.toThrow("no folder on this device");
    close();
  });

  it("gives late subscribers the latest progress right away", async () => {
    const { svc, close } = await project();
    const runId = await startUpdate(svc, "p1", [react()]);
    await finished(runId);
    const seen: RunProgress[] = [];
    subscribeRun(runId, (progress) => seen.push(progress))();
    close();
    expect(seen).toHaveLength(1);
    expect(seen[0]?.result?.ok).toBe(true);
  });
});

describe("startBatch", () => {
  it("updates each project and reports ok or failed per project", async () => {
    const { svc, close } = await project();
    const states: string[][] = [];
    const id = startBatch(svc, [
      { projectId: "p1", name: "web", picks: [react()] },
      { projectId: "gone", name: "gone", picks: [react()] },
    ]);
    await new Promise<void>((resolve) =>
      subscribeBatch(id, (progress) => {
        states.push(progress.items.map((i) => i.state));
        if (progress.done) resolve();
      }),
    );
    close();
    expect(states.at(-1)).toEqual(["ok", "failed"]);
  });
});

describe("revertRun", () => {
  it("restores the touched files and reinstalls", async () => {
    const { io, svc, close } = await project();
    await revertRun(svc, "p1", { ok: true, changes: [], touched: ["package.json"] });
    close();
    expect(io.runs.map((r) => [r.program, ...r.args].join(" "))).toEqual(
      expect.arrayContaining(["git checkout -- package.json", "npm install"]),
    );
  });
});
