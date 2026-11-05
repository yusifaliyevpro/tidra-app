import { describe, expect, it, vi } from "vitest";
import { SECRET_KEYS } from "@/core/secrets";
import {
  changeVaultPassword,
  connectionCode,
  createSync,
  disconnectSync,
  newRecoveryKey,
  probeDatabase,
  restoreFromCode,
  restoreSync,
  runSync,
  syncStatus,
} from "@/services/sync";
import type { SyncProvider } from "@/sync/provider";
import { memorySyncServer } from "../support/memory-sync";
import { testServices } from "../support/services";

const server = vi.hoisted(() => ({ current: undefined as ReturnType<typeof memorySyncServer> | undefined }));

// Test-sized KDF parameters; the real derivation code still runs.
vi.mock(import("@/sync/crypto"), async (importOriginal) => ({
  ...(await importOriginal()),
  DEFAULT_KDF: { algorithm: "argon2id" as const, memoryKiB: 256, iterations: 1, parallelism: 1 },
}));

vi.mock(import("@/sync/registry"), () => {
  const memory: SyncProvider = {
    id: "memory",
    label: "Memory",
    description: "",
    fields: [],
    connect: () => {
      if (!server.current) throw new Error("no server");
      return server.current.connection;
    },
  };
  return { SYNC_PROVIDERS: [memory], findSyncProvider: (id: string) => (id === "memory" ? memory : undefined) };
});

async function freshServer() {
  server.current = memorySyncServer();
  return server.current;
}

describe("sync service", () => {
  it("reports not connected before setup", async () => {
    await freshServer();
    const { svc, close } = await testServices();
    expect(await syncStatus(svc)).toEqual({ connected: false, provider: undefined });
    expect(await runSync(svc)).toBeUndefined();
    close();
  });

  it("creates a vault on an empty database, uploads everything and moves it to a second device", async () => {
    await freshServer();
    const a = await testServices();
    await a.svc.store.addProject({ id: "p1", name: "web", remote: "github.com/me/web", path: "/web" });
    expect(await probeDatabase(a.svc, "memory", {})).toBe("empty");

    const created = await createSync(a.svc, "memory", {}, "hunter2");
    expect(created.recoveryKey).toMatch(/\S/);
    expect(created.result?.pushed).toBeGreaterThan(0);
    expect(await syncStatus(a.svc)).toMatchObject({ connected: true, provider: "memory", lastResult: { rejected: 0 } });
    expect(await probeDatabase(a.svc, "memory", {})).toBe("existing");

    const b = await testServices();
    await restoreFromCode(b.svc, created.connectionCode, "hunter2");
    const projects = await b.svc.store.listProjects();
    a.close();
    b.close();
    expect(projects.map((p) => [p.id, p.name, p.path])).toEqual([["p1", "web", undefined]]);
  });

  it("refuses to create a second vault and to restore from an empty database", async () => {
    await freshServer();
    const { svc, close } = await testServices();
    await expect(restoreSync(svc, "memory", {}, { password: "x" })).rejects.toThrow("No Tidra vault found");
    await createSync(svc, "memory", {}, "pw");
    await expect(createSync(svc, "memory", {}, "pw")).rejects.toThrow("already has a Tidra vault");
    close();
  });

  it("restores with the recovery key, and refuses a wrong password", async () => {
    await freshServer();
    const a = await testServices();
    const { recoveryKey } = await createSync(a.svc, "memory", {}, "right");
    const b = await testServices();
    await expect(restoreSync(b.svc, "memory", {}, { password: "wrong" })).rejects.toThrow("Could not decrypt");
    await expect(restoreSync(b.svc, "memory", {}, { recoveryKey })).resolves.toBeDefined();
    expect((await syncStatus(b.svc)).connected).toBe(true);
    a.close();
    b.close();
  });

  it("changes the password and rotates the recovery key without changing the data key", async () => {
    await freshServer();
    const a = await testServices();
    const { recoveryKey } = await createSync(a.svc, "memory", {}, "old");
    const code = await changeVaultPassword(a.svc, "new");
    const rotated = await newRecoveryKey(a.svc);
    await expect(connectionCode(a.svc, "old")).rejects.toThrow("Could not decrypt");
    await expect(connectionCode(a.svc, "new")).resolves.toEqual(expect.any(String));

    const b = await testServices();
    await restoreFromCode(b.svc, code, "new");
    const c = await testServices();
    await expect(restoreSync(c.svc, "memory", {}, { recoveryKey })).rejects.toThrow("Could not decrypt");
    await expect(restoreSync(c.svc, "memory", {}, { recoveryKey: rotated })).resolves.toBeDefined();
    a.close();
    b.close();
    c.close();
  });

  it("records a failed sync and forgets everything on disconnect", async () => {
    const s = await freshServer();
    const { svc, close } = await testServices();
    await createSync(svc, "memory", {}, "pw");
    s.connection.pull = () => Promise.reject(new Error("offline"));
    await expect(runSync(svc)).rejects.toThrow("offline");
    expect(await syncStatus(svc)).toMatchObject({ connected: true, lastError: "offline" });

    await disconnectSync(svc);
    expect(await syncStatus(svc)).toEqual({ connected: false, provider: undefined });
    expect(await svc.secrets.get(SECRET_KEYS.syncDataKey)).toBeUndefined();
    close();
  });

  it("explains that sync needs a connection for password changes", async () => {
    await freshServer();
    const { svc, close } = await testServices();
    await expect(changeVaultPassword(svc, "x")).rejects.toThrow("Sync is not connected.");
    close();
  });

  it("rejects a connection code made with another password", async () => {
    await freshServer();
    const a = await testServices();
    const { connectionCode: code } = await createSync(a.svc, "memory", {}, "pw");
    const b = await testServices();
    await expect(restoreFromCode(b.svc, code, "not-pw")).rejects.toThrow("Could not decrypt");
    a.close();
    b.close();
  });
});
