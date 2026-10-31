import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createScheduler } from "@/core/scheduler";

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
