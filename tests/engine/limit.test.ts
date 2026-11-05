import { describe, expect, it } from "vitest";
import { createLimit } from "@/engine/limit";

describe("createLimit", () => {
  it("never runs more tasks than the limit at once", async () => {
    const limit = createLimit(2);
    let active = 0;
    let peak = 0;
    const task = async (value: number) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return value;
    };
    const results = await Promise.all([1, 2, 3, 4, 5].map((n) => limit(() => task(n))));
    expect(results).toEqual([1, 2, 3, 4, 5]);
    expect(peak).toBe(2);
  });

  it("frees the slot when a task throws", async () => {
    const limit = createLimit(1);
    await expect(limit(() => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    await expect(limit(() => Promise.resolve("next"))).resolves.toBe("next");
  });
});

describe("createLimit edge cases", () => {
  it("starts queued tasks in call order", async () => {
    const limit = createLimit(1);
    const started: number[] = [];
    await Promise.all(
      [1, 2, 3, 4].map((n) =>
        limit(async () => {
          started.push(n);
          await Promise.resolve();
        }),
      ),
    );
    expect(started).toEqual([1, 2, 3, 4]);
  });

  it("never exceeds the limit while new tasks keep arriving as others finish", async () => {
    const limit = createLimit(3);
    let active = 0;
    let peak = 0;
    const task = (delay: number) =>
      limit(async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, delay));
        active--;
      });
    const all: Promise<void>[] = [];
    for (let round = 0; round < 40; round++) {
      all.push(task(round % 5).then(() => task(round % 3)));
      if (round % 7 === 0) await Promise.resolve();
    }
    await Promise.all(all);
    expect(peak).toBe(3);
  });

  it("returns each task's own result", async () => {
    const limit = createLimit(2);
    await expect(Promise.all([limit(async () => "a"), limit(async () => 2)])).resolves.toEqual(["a", 2]);
  });
});
