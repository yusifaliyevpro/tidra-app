import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createScheduler, type JobState } from "@/core/scheduler";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const minutes = (n: number) => n * 60_000;

describe("scheduler", () => {
  it("runs registered jobs on start and again after their interval", async () => {
    const run = vi.fn<() => Promise<void>>().mockResolvedValue();
    const scheduler = createScheduler({ random: () => 0, tickMs: 1000 });
    scheduler.register({ id: "outdated", title: "Outdated", intervalMinutes: 30, run });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(minutes(29));
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(minutes(1) + 1000);
    expect(run).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });

  it("hands out snapshots that a finished run never changes in place", async () => {
    const { promise, resolve } = Promise.withResolvers<void>();
    const scheduler = createScheduler({ random: () => 0 });
    scheduler.register({ id: "projects", title: "Projects", intervalMinutes: 30, run: () => promise });
    const running = scheduler.runNow("projects");
    const during = scheduler.states();
    resolve();
    await running;
    expect(during[0]?.running).toBe(true);
    expect(scheduler.states()[0]?.running).toBe(false);
  });

  it("backs off after failures and records the error", async () => {
    const run = vi.fn<() => Promise<void>>().mockRejectedValue(new Error("rate limited"));
    const scheduler = createScheduler({ random: () => 0, tickMs: 1000 });
    scheduler.register({ id: "ci", title: "CI", intervalMinutes: 5, run });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(scheduler.states()[0]).toMatchObject({ failures: 1, lastError: "rate limited" });

    await vi.advanceTimersByTimeAsync(minutes(6));
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(minutes(5));
    expect(run).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });

  it("skips visible-only jobs while hidden and everything while paused", async () => {
    let visible = false;
    const ci = vi.fn<() => Promise<void>>().mockResolvedValue();
    const outdated = vi.fn<() => Promise<void>>().mockResolvedValue();
    const scheduler = createScheduler({ isVisible: () => visible, tickMs: 1000 });
    scheduler.register({ id: "ci", title: "CI", intervalMinutes: 5, visibleOnly: true, run: ci });
    scheduler.setPaused(true);
    scheduler.register({ id: "outdated", title: "Outdated", intervalMinutes: 30, run: outdated });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(2000);
    expect(outdated).not.toHaveBeenCalled();

    scheduler.setPaused(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(outdated).toHaveBeenCalledTimes(1);
    expect(ci).not.toHaveBeenCalled();

    visible = true;
    await vi.advanceTimersByTimeAsync(1000);
    expect(ci).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });

  it("never runs the same job twice at once", async () => {
    const { promise, resolve } = Promise.withResolvers<void>();
    const run = vi.fn<() => Promise<void>>(() => promise);
    const scheduler = createScheduler();
    scheduler.register({ id: "slow", title: "Slow", intervalMinutes: 1, run });
    void scheduler.runNow("slow");
    void scheduler.runNow("slow");
    expect(run).toHaveBeenCalledTimes(1);
    resolve();
    await promise;
  });

  it("aborts running jobs on stop", async () => {
    let aborted = false;
    const scheduler = createScheduler();
    scheduler.register({
      id: "long",
      title: "Long",
      intervalMinutes: 1,
      run: (signal) =>
        new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => {
            aborted = true;
            resolve();
          });
        }),
    });
    scheduler.start();
    scheduler.stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(aborted).toBe(true);
  });
});

describe("scheduler at launch", () => {
  it("waits for a job's interval when it ran recently in an earlier session", async () => {
    let time = 1_000_000;
    const run = vi.fn<() => Promise<undefined>>(async () => undefined);
    const scheduler = createScheduler({ now: () => time, random: () => 0, tickMs: 60_000 });
    scheduler.register({ id: "fresh", title: "Fresh", intervalMinutes: 30, run }, time - 10 * 60_000);
    scheduler.register({ id: "stale", title: "Stale", intervalMinutes: 30, run }, time - 40 * 60_000);
    scheduler.start();
    await Promise.resolve();
    expect(run).toHaveBeenCalledTimes(1);
    time += 20 * 60_000;
    scheduler.setPaused(false);
    await Promise.resolve();
    expect(run).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });

  it("runs at most maxConcurrent jobs at once and starts the next when one finishes", async () => {
    const releases: (() => void)[] = [];
    const started: string[] = [];
    const scheduler = createScheduler({ maxConcurrent: 2, tickMs: 60_000 });
    for (const id of ["a", "b", "c"]) {
      scheduler.register({
        id,
        title: id,
        intervalMinutes: 30,
        run: () =>
          new Promise<void>((resolve) => {
            started.push(id);
            releases.push(resolve);
          }),
      });
    }
    scheduler.start();
    expect(started).toEqual(["a", "b"]);
    releases[0]?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toEqual(["a", "b", "c"]);
    scheduler.stop();
  });
});

describe("scheduler extras", () => {
  it("runs every job once for runAll and records failures without throwing", async () => {
    const ok = vi.fn<() => Promise<void>>().mockResolvedValue();
    const scheduler = createScheduler({ random: () => 0 });
    scheduler.register({ id: "a", title: "A", intervalMinutes: 5, run: ok });
    scheduler.register({ id: "b", title: "B", intervalMinutes: 5, run: () => Promise.reject(new Error("offline")) });
    await scheduler.runAll();
    expect(ok).toHaveBeenCalledTimes(1);
    expect(scheduler.states().find((s) => s.id === "b")).toMatchObject({
      failures: 1,
      lastError: "offline",
      running: false,
    });
  });

  it("does nothing for unknown jobs", async () => {
    await expect(createScheduler().runNow("missing")).resolves.toBeUndefined();
  });

  it("reports changes to its listener", async () => {
    const onChange = vi.fn<(states: JobState[]) => void>();
    const scheduler = createScheduler({ random: () => 0, onChange });
    scheduler.register({ id: "a", title: "A", intervalMinutes: 5, run: () => Promise.resolve() });
    await scheduler.runNow("a");
    expect(onChange.mock.calls.map(([states]) => states[0]?.running)).toEqual([false, true, false]);
  });

  it("keeps to maxConcurrent for runAll", async () => {
    const scheduler = createScheduler({ random: () => 0, maxConcurrent: 2 });
    let active = 0;
    let peak = 0;
    const run = async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active--;
    };
    for (const id of ["a", "b", "c", "d"]) scheduler.register({ id, title: id, intervalMinutes: 5, run });
    const all = scheduler.runAll();
    await vi.advanceTimersByTimeAsync(50);
    await all;
    expect(peak).toBe(2);
  });
});
