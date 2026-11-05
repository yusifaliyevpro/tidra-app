import * as z from "@zod/mini";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SECRET_KEYS } from "@/core/secrets";
import { emptyConfig, parseNpmrc } from "@/engine/npmrc";
import { createServices } from "@/services/context";
import { memoryIo } from "../support/memory-io";
import { nodeSqliteDriver } from "../support/node-sqlite";

afterEach(() => vi.useRealTimers());

describe("createServices", () => {
  it("keeps one device id across restarts on the same database", async () => {
    const driver = nodeSqliteDriver();
    const first = await createServices({ io: memoryIo(), driver, preview: true });
    const id = await first.store.getLocal("deviceId", z.string(), "");
    const second = await createServices({ io: memoryIo(), driver, preview: true });
    const again = await second.store.getLocal("deviceId", z.string(), "");
    driver.close();
    expect(id).toMatch(/^[0-9a-z]{26}$/);
    expect(again).toBe(id);
  });

  it("starts its clock after every timestamp already on disk", async () => {
    const driver = nodeSqliteDriver();
    const first = await createServices({ io: memoryIo(), driver, preview: true });
    await first.store.addProject({ id: "p1", name: "a", remote: null, path: "/a" });
    const written = (await first.store.getProject("p1"))?.hlc ?? "";
    const second = await createServices({ io: memoryIo(), driver, preview: true });
    const next = second.clock.tick();
    driver.close();
    expect(next > written).toBe(true);
  });

  it("coalesces bursts of invalidations into one per key", async () => {
    vi.useFakeTimers();
    const driver = nodeSqliteDriver();
    const svc = await createServices({ io: memoryIo(), driver, preview: true });
    const spy = vi.spyOn(svc.queryClient, "invalidateQueries");
    svc.invalidate(["reports"], ["home"]);
    svc.invalidate(["reports"]);
    svc.invalidate(["report", "p1"]);
    expect(spy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(250);
    driver.close();
    expect(spy.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([["reports"], ["home"], ["report", "p1"]]);
  });

  it("reuses one registry client per npm configuration", async () => {
    const driver = nodeSqliteDriver();
    const svc = await createServices({ io: memoryIo(), driver, preview: true });
    const a = svc.registry(emptyConfig());
    const b = svc.registry(emptyConfig());
    const c = svc.registry(parseNpmrc("registry=https://r.acme.dev", {}));
    driver.close();
    expect(b).toBe(a);
    expect(c).not.toBe(a);
  });

  it("gives the GitHub client the stored token, and drops it when cleared", async () => {
    const driver = nodeSqliteDriver();
    const svc = await createServices({ io: memoryIo(), driver, preview: true });
    expect((await svc.github()).hasToken).toBe(false);
    await svc.setSecret(SECRET_KEYS.github, "ghp_x");
    expect((await svc.github()).hasToken).toBe(true);
    await svc.setSecret(SECRET_KEYS.github, "");
    expect((await svc.github()).hasToken).toBe(false);
    driver.close();
  });
});
