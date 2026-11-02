import { describe, expect, it } from "vitest";
import { runs } from "@/core/db/schema";
import { finishInterruptedRuns, listRuns, startBatch, subscribeBatch, type BatchProgress } from "@/services/updates";
import { memoryIo } from "../support/memory-io";
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
