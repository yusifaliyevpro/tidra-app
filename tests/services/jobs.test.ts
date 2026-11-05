import * as z from "@zod/mini";
import { describe, expect, it } from "vitest";
import { JOB_INTERVALS_SETTING, JOBS, readJobIntervals, registerJobs } from "@/services/jobs";
import { testServices } from "../support/services";

describe("job definitions", () => {
  it("have unique ids and positive default intervals", () => {
    expect(new Set(JOBS.map((j) => j.id)).size).toBe(JOBS.length);
    for (const job of JOBS) expect(job.defaultMinutes).toBeGreaterThan(0);
  });

  it("only poll cheap GitHub and deploy state while the window is visible", () => {
    expect(
      JOBS.filter((j) => j.visibleOnly)
        .map((j) => j.id)
        .toSorted(),
    ).toEqual(["ci", "deploys"]);
  });
});

describe("registerJobs", () => {
  it("registers every job in launch priority order with the user's intervals", async () => {
    const { svc, close } = await testServices();
    await svc.store.setSetting(JOB_INTERVALS_SETTING, { ci: 15 });
    await registerJobs(svc);
    const states = svc.scheduler.states();
    expect(await readJobIntervals(svc)).toEqual({ ci: 15 });
    close();
    expect(states.map((s) => s.id)).toEqual([
      "projects",
      "inbox",
      "ci",
      "security",
      "actions",
      "bot-pulls",
      "deploys",
      "timeline",
      "sync",
      "packages",
      "toolchain",
    ]);
  });

  it("remembers a successful run, so a relaunch doesn't redo fresh work", async () => {
    const { svc, close } = await testServices();
    await registerJobs(svc);
    await svc.scheduler.runNow("packages");
    const lastRuns = await svc.store.getLocal("jobLastRuns", z.record(z.string(), z.number()), {});
    expect(Object.keys(lastRuns)).toEqual(["packages"]);

    const relaunched = await testServices();
    await relaunched.svc.store.setLocal("jobLastRuns", { packages: Date.now() });
    await registerJobs(relaunched.svc);
    const packages = relaunched.svc.scheduler.states().find((s) => s.id === "packages");
    const projects = relaunched.svc.scheduler.states().find((s) => s.id === "projects");
    relaunched.close();
    close();
    expect(packages?.nextRun).toBeGreaterThan(Date.now() + 60 * 60_000);
    expect(projects?.nextRun).toBeLessThanOrEqual(Date.now());
  });
});
