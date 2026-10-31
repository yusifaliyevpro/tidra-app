import { describe, expect, it } from "vitest";
import { planBatch, startBatch, subscribeBatch, type BatchProgress } from "@/services/updates";
import { outdatedEntry, projectReport, testServices } from "../support/services";

describe("planBatch", () => {
  it("keeps projects with updates at the chosen levels and targets latest", () => {
    const plans = planBatch(
      [
        {
          project: { id: "a", name: "A", path: "/a" },
          report: projectReport([
            outdatedEntry("x", "1.0.0", "1.0.1", "patch"),
            outdatedEntry("y", "1.0.0", "2.0.0", "major"),
          ]),
        },
        {
          project: { id: "b", name: "B", path: "/b" },
          report: projectReport([outdatedEntry("z", "1.0.0", "2.0.0", "major")]),
        },
        {
          project: { id: "c", name: "C", path: null },
          report: projectReport([outdatedEntry("x", "1.0.0", "1.0.1", "patch")]),
        },
        { project: { id: "d", name: "D", path: "/d" } },
      ],
      new Set(["patch", "minor"]),
    );
    expect(plans).toEqual([
      { projectId: "a", name: "A", picks: [{ entry: expect.objectContaining({ name: "x" }), version: "1.0.1" }] },
    ]);
  });
});

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
