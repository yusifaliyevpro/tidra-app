import { describe, expect, it } from "vitest";
import { startBatch, subscribeBatch, type BatchProgress } from "@/services/updates";
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
