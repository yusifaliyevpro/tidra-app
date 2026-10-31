import * as z from "@zod/mini";
import { afterEach, describe, expect, it } from "vitest";
import { createDb } from "@/core/db/client";
import { bundledMigrations, migrate } from "@/core/db/migrate";
import { memorySecrets, SECRET_KEYS } from "@/core/secrets";
import { createStore } from "@/core/store";
import { markAllForUpload, stampSecret, syncOnce } from "@/sync/engine";
import { createClock } from "@/sync/hlc";
import { createVault, type Vault } from "@/sync/vault";
import { memorySyncServer } from "../support/memory-sync";
import { nodeSqliteDriver } from "../support/node-sqlite";

const FAST = { algorithm: "argon2id", memoryKiB: 256, iterations: 1, parallelism: 1 } as const;
const drivers: ReturnType<typeof nodeSqliteDriver>[] = [];
afterEach(() => drivers.splice(0).forEach((d) => d.close()));

async function device(
  id: string,
  vault: Vault,
  connection: ReturnType<typeof memorySyncServer>["connection"],
  start: number,
) {
  const driver = nodeSqliteDriver();
  drivers.push(driver);
  await migrate(driver, bundledMigrations());
  let wall = start;
  const clock = createClock(id, () => wall++);
  const secrets = memorySecrets();
  const store = createStore(createDb(driver), clock);
  const sync = () => syncOnce({ driver, connection, vault, clock, secrets });
  return { driver, clock, secrets, store, sync };
}

describe("syncOnce", () => {
  it("moves projects, settings and secrets between devices, encrypted", async () => {
    const server = memorySyncServer();
    const { vault } = await createVault("pw", FAST);
    const a = await device("dev-a", vault, server.connection, 1000);
    const b = await device("dev-b", vault, server.connection, 1000);

    await a.store.addProject({ id: "p1", name: "secret-web-app", remote: "github.com/me/web", path: "C:/code/web" });
    await a.store.setSetting("ciThreshold", "critical");
    await a.secrets.set(SECRET_KEYS.github, "ghp_supersecret");
    await stampSecret(a.driver, a.clock, SECRET_KEYS.github);

    expect(await a.sync()).toEqual({ pushed: 3, pulled: 0, rejected: 0 });
    const serialized = JSON.stringify([...server.rows.values()]);
    for (const plaintext of ["secret-web-app", "ghp_supersecret", "critical", "projects", "C:/code/web"]) {
      expect(serialized).not.toContain(plaintext);
    }

    expect(await b.sync()).toMatchObject({ pulled: 3, rejected: 0 });
    const [project] = await b.store.listProjects();
    expect(project).toMatchObject({ id: "p1", name: "secret-web-app", remote: "github.com/me/web", path: undefined });
    expect(await b.store.getSetting("ciThreshold", z.string(), "high")).toBe("critical");
    expect(await b.secrets.get(SECRET_KEYS.github)).toBe("ghp_supersecret");
  });

  it("keeps the newer write when both devices edit the same row", async () => {
    const server = memorySyncServer();
    const { vault } = await createVault("pw", FAST);
    const a = await device("dev-a", vault, server.connection, 1000);
    const b = await device("dev-b", vault, server.connection, 5000);

    await a.store.addProject({ id: "p1", name: "web", remote: null, path: "/a" });
    await a.sync();
    await b.sync();

    await a.store.updateProject("p1", { name: "older edit" });
    await b.store.updateProject("p1", { name: "newer edit" });
    await a.sync();
    await b.sync();
    await a.sync();

    expect((await a.store.getProject("p1"))?.name).toBe("newer edit");
    expect((await b.store.getProject("p1"))?.name).toBe("newer edit");
  });

  it("propagates deletions", async () => {
    const server = memorySyncServer();
    const { vault } = await createVault("pw", FAST);
    const a = await device("dev-a", vault, server.connection, 1000);
    const b = await device("dev-b", vault, server.connection, 1000);
    await a.store.addProject({ id: "p1", name: "web", remote: null, path: "/a" });
    await a.sync();
    await b.sync();
    await b.store.removeProject("p1");
    await b.sync();
    await a.sync();
    expect(await a.store.listProjects()).toEqual([]);
  });

  it("rejects rows encrypted with another vault", async () => {
    const server = memorySyncServer();
    const mine = await createVault("pw", FAST);
    const theirs = await createVault("other", FAST);
    const a = await device("dev-a", theirs.vault, server.connection, 1000);
    const b = await device("dev-b", mine.vault, server.connection, 1000);
    await a.store.setSetting("x", 1);
    await a.sync();
    expect(await b.sync()).toMatchObject({ pulled: 0 });
  });

  it("uploads existing data on first connect", async () => {
    const server = memorySyncServer();
    const { vault } = await createVault("pw", FAST);
    const a = await device("dev-a", vault, server.connection, 1000);
    await a.store.addProject({ id: "p1", name: "web", remote: null, path: "/a" });
    await a.secrets.set(SECRET_KEYS.vercel, "vercel-token");
    await markAllForUpload(a);
    expect((await a.sync()).pushed).toBe(2);
    expect((await a.sync()).pushed).toBe(0);
  });
});
