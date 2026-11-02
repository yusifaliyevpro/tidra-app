import { QueryClient } from "@tanstack/react-query";
import * as z from "@zod/mini";
import { ulid } from "ulid";
import { createDb } from "@/core/db/client";
import type { SqlDriver } from "@/core/db/driver";
import { bundledMigrations, migrate } from "@/core/db/migrate";
import { createScheduler, type JobState, type Scheduler } from "@/core/scheduler";
import { keychain, memorySecrets, SECRET_KEYS, type SecretKey, type SecretStore } from "@/core/secrets";
import { createStore, type Store } from "@/core/store";
import type { Io } from "@/engine/io";
import type { NpmConfig } from "@/engine/npmrc";
import { createRegistryClient, type RegistryClient } from "@/engine/registry";
import { createGitHub, type GitHub } from "@/integrations/github";
import { stampSecret, SYNCED_TABLE_META } from "@/sync/engine";
import { createClock, type Clock } from "@/sync/hlc";

export interface Services {
  preview: boolean;
  io: Io;
  driver: SqlDriver;
  store: Store;
  clock: Clock;
  secrets: SecretStore;
  scheduler: Scheduler;
  queryClient: QueryClient;
  registry(npm: NpmConfig): RegistryClient;
  github(): Promise<GitHub>;
  /** Writes a secret to the keychain and marks it for the next sync. */
  setSecret(key: SecretKey, value: string | undefined): Promise<void>;
  jobStates(): JobState[];
  /** Invalidates query keys on the next frame-ish tick, so a burst of background writes rerenders once. */
  invalidate(...keys: string[][]): void;
}

/** Restarts the clock past every HLC on disk so a restart never issues an older timestamp. */
async function latestHlc(driver: SqlDriver): Promise<string | undefined> {
  const union = SYNCED_TABLE_META.map((t) => `SELECT hlc FROM "${t.name}"`).join(" UNION ALL ");
  const rows = await driver.query(`SELECT MAX(hlc) FROM (${union})`, []);
  const value = rows[0]?.[0];
  return typeof value === "string" ? value : undefined;
}

export async function createServices(options: { io: Io; driver: SqlDriver; preview: boolean }): Promise<Services> {
  const { io, driver, preview } = options;
  await migrate(driver, bundledMigrations());

  const bootstrap = createStore(createDb(driver), createClock("bootstrap"));
  let deviceId = await bootstrap.getLocal("deviceId", z.string(), "");
  if (!deviceId) {
    deviceId = ulid().toLowerCase();
    await bootstrap.setLocal("deviceId", deviceId);
  }
  const clock = createClock(deviceId, Date.now, await latestHlc(driver));
  const store = createStore(createDb(driver), clock);
  const secrets = preview ? memorySecrets() : keychain;

  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY, refetchOnWindowFocus: false, retry: false } },
  });

  const scheduler = createScheduler({
    // Each job already fans out (git, registry, GitHub); three at once keeps launch smooth.
    maxConcurrent: 3,
    isVisible: () => document.visibilityState === "visible",
    onChange: () => void queryClient.invalidateQueries({ queryKey: ["jobs"] }),
  });

  const registries = new Map<string, RegistryClient>();
  const pendingKeys = new Map<string, string[]>();
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  const flushInvalidations = () => {
    flushTimer = undefined;
    const keys = [...pendingKeys.values()];
    pendingKeys.clear();
    for (const queryKey of keys) void queryClient.invalidateQueries({ queryKey });
  };

  return {
    preview,
    io,
    driver,
    store,
    clock,
    secrets,
    scheduler,
    queryClient,
    registry(npm) {
      const key = JSON.stringify(npm);
      let client = registries.get(key);
      if (!client) {
        client = createRegistryClient({ io, npm, cache: store.httpCache });
        registries.set(key, client);
      }
      return client;
    },
    async github() {
      return createGitHub({
        fetch: io.fetch,
        token: await secrets.get(SECRET_KEYS.github),
        cache: store.httpCache,
      });
    },
    async setSecret(key, value) {
      if (value) await secrets.set(key, value);
      else await secrets.delete(key);
      await stampSecret(driver, clock, key);
      await queryClient.invalidateQueries({ queryKey: ["secrets"] });
    },
    jobStates: () => scheduler.states(),
    invalidate(...keys) {
      for (const key of keys) pendingKeys.set(JSON.stringify(key), key);
      flushTimer ??= setTimeout(flushInvalidations, 250);
    },
  };
}
