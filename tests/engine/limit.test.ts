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
