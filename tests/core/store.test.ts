import * as z from "@zod/mini";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "@/core/db/client";
import { bundledMigrations, migrate } from "@/core/db/migrate";
import { createStore, type Store } from "@/core/store";
import { createClock } from "@/sync/hlc";
import { nodeSqliteDriver } from "../support/node-sqlite";

let driver: ReturnType<typeof nodeSqliteDriver>;
let store: Store;

beforeEach(async () => {
  driver = nodeSqliteDriver();
  await migrate(driver, bundledMigrations());
  let wall = 1000;
  store = createStore(
    createDb(driver),
    createClock("device-a", () => wall++),
  );
});

afterEach(() => driver.close());

describe("migrate", () => {
  it("applies bundled migrations once", async () => {
    expect(bundledMigrations().map((m) => m.tag)).toContain("0000_init");
    expect(await migrate(driver, bundledMigrations())).toEqual([]);
  });
});

describe("store", () => {
  it("round-trips synced settings and local values", async () => {
    expect(await store.getSetting("ciThreshold", z.string(), "high")).toBe("high");
    await store.setSetting("ciThreshold", "critical");
    await store.setSetting("ciThreshold", "moderate");
    expect(await store.getSetting("ciThreshold", z.string(), "high")).toBe("moderate");

    await store.setSetting("bad", 42);
    expect(await store.getSetting("bad", z.string(), "fallback")).toBe("fallback");
    await store.setLocal("onboarded", true);
    expect(await store.getLocal("onboarded", z.boolean(), false)).toBe(true);
  });

  it("keeps project paths per device and hides removed projects", async () => {
    await store.addProject({ id: "p1", name: "web", remote: "github.com/o/web", path: "C:/code/web" });
    await store.addProject({ id: "p2", name: "api", remote: null, path: "C:/code/api" });
    expect((await store.listProjects()).map((p) => [p.name, p.path])).toEqual([
      ["api", "C:/code/api"],
      ["web", "C:/code/web"],
    ]);

    await store.updateProject("p1", { checks: ["pnpm check"], updateOnBranch: false });
    expect(await store.getProject("p1")).toMatchObject({
      checks: ["pnpm check"],
      updateOnBranch: false,
      deviceId: "device-a",
    });

    await store.removeProject("p2");
    expect((await store.listProjects()).map((p) => p.id)).toEqual(["p1"]);
  });

  it("stamps every synced write with a newer HLC", async () => {
    await store.addProject({ id: "p1", name: "web", remote: null, path: "/w" });
    const first = (await store.getProject("p1"))!.hlc;
    await store.updateProject("p1", { name: "web-app" });
    expect((await store.getProject("p1"))!.hlc > first).toBe(true);
  });

  it("stores snapshots and the HTTP cache", async () => {
    await store.setSnapshot("outdated:p1", { entries: [1, 2] });
    const Snapshot = z.object({ entries: z.array(z.number()) });
    expect((await store.getSnapshot("outdated:p1", Snapshot))?.data).toEqual({ entries: [1, 2] });
    expect(await store.getSnapshot("outdated:p1", z.string())).toBeUndefined();
    await store.httpCache.set("abbr:react", { etag: '"x"', body: "{}" });
    expect(await store.httpCache.get("abbr:react")).toEqual({ etag: '"x"', body: "{}" });
    expect(await store.httpCache.get("missing")).toBeUndefined();
  });

  it("watches and unwatches repos", async () => {
    await store.watchRepo("vitejs", "vite");
    expect((await store.listWatchedRepos()).map((r) => r.id)).toEqual(["vitejs/vite"]);
    await store.unwatchRepo("vitejs/vite");
    expect(await store.listWatchedRepos()).toEqual([]);
  });
});
