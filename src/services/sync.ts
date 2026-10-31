import * as z from "@zod/mini";
import { SECRET_KEYS } from "@/core/secrets";
import { fromBase64, toBase64 } from "@/sync/crypto";
import { markAllForUpload, resetSyncCursors, syncOnce, type SyncResult } from "@/sync/engine";
import type { ConnectionConfig, SyncConnection } from "@/sync/provider";
import { findSyncProvider } from "@/sync/registry";
import {
  changePassword,
  createVault,
  decodeConnectionCode,
  encodeConnectionCode,
  rotateRecoveryKey,
  unlockVault,
  vaultFromKey,
  type Vault,
} from "@/sync/vault";
import type { Services } from "./context";

const StoredConnection = z.compile(z.object({ provider: z.string(), config: z.record(z.string(), z.string()) }));
export type StoredConnection = z.infer<typeof StoredConnection>;

export interface SyncStatus {
  connected: boolean;
  provider?: string;
  lastSync?: string;
  lastResult?: SyncResult;
  lastError?: string;
}

const STATUS_KEY = "syncStatus";
const StatusSchema = z.looseObject({
  lastSync: z.optional(z.string()),
  lastError: z.optional(z.string()),
  lastResult: z.optional(z.object({ pushed: z.number(), pulled: z.number(), rejected: z.number() })),
});

async function storedConnection(svc: Services): Promise<StoredConnection | undefined> {
  const raw = await svc.secrets.get(SECRET_KEYS.syncConnection);
  if (!raw) return undefined;
  const value: unknown = JSON.parse(raw);
  return z.validate(StoredConnection, value) ? value : undefined;
}

function connect(svc: Services, stored: StoredConnection): SyncConnection {
  const provider = findSyncProvider(stored.provider);
  if (!provider) throw new Error(`Unknown sync provider "${stored.provider}".`);
  return provider.connect(stored.config, svc.io.fetch);
}

async function localVault(svc: Services): Promise<Vault | undefined> {
  const key = await svc.secrets.get(SECRET_KEYS.syncDataKey);
  return key ? vaultFromKey(fromBase64(key)) : undefined;
}

async function connectionAndVault(svc: Services) {
  const [stored, vault] = await Promise.all([storedConnection(svc), localVault(svc)]);
  return { stored, vault };
}

export async function syncStatus(svc: Services): Promise<SyncStatus> {
  const [{ stored, vault }, status] = await Promise.all([
    connectionAndVault(svc),
    svc.store.getLocal(STATUS_KEY, StatusSchema, {}),
  ]);
  return { connected: Boolean(stored && vault), provider: stored?.provider, ...status };
}

/** Whether the database already holds a vault (restore with the password) or is empty (create a new vault). */
export async function probeDatabase(
  svc: Services,
  provider: string,
  config: ConnectionConfig,
): Promise<"empty" | "existing"> {
  const connection = connect(svc, { provider, config });
  await connection.ensureSchema();
  return (await connection.readHeader()) ? "existing" : "empty";
}

async function finishConnect(svc: Services, stored: StoredConnection, vault: Vault) {
  await svc.secrets.set(SECRET_KEYS.syncConnection, JSON.stringify(stored));
  await svc.secrets.set(SECRET_KEYS.syncDataKey, toBase64(vault.rawKey));
  await resetSyncCursors(svc.driver);
}

/** First device: creates the vault, uploads everything, and returns the recovery kit to show once. */
export async function createSync(svc: Services, provider: string, config: ConnectionConfig, password: string) {
  const stored = { provider, config };
  const connection = connect(svc, stored);
  await connection.ensureSchema();
  if (await connection.readHeader())
    throw new Error("This database already has a Tidra vault. Restore from it instead.");
  const { header, vault, recoveryKey } = await createVault(password);
  await connection.writeHeader(header);
  await finishConnect(svc, stored, vault);
  await markAllForUpload(svc);
  const result = await runSync(svc);
  return { recoveryKey, connectionCode: await encodeConnectionCode(stored, password), result };
}

/** Another device: unlocks the existing vault with the password or recovery key and pulls everything. */
export async function restoreSync(
  svc: Services,
  provider: string,
  config: ConnectionConfig,
  secret: { password: string } | { recoveryKey: string },
) {
  const stored = { provider, config };
  const connection = connect(svc, stored);
  const header = await connection.readHeader();
  if (!header) throw new Error("No Tidra vault found in this database.");
  const vault = await unlockVault(header, secret);
  await finishConnect(svc, stored, vault);
  await markAllForUpload(svc);
  return runSync(svc);
}

export async function restoreFromCode(svc: Services, code: string, password: string) {
  const decoded: unknown = await decodeConnectionCode(code, password);
  if (!z.validate(StoredConnection, decoded)) throw new Error("The connection code is damaged.");
  return restoreSync(svc, decoded.provider, decoded.config, { password });
}

export async function runSync(svc: Services): Promise<SyncResult | undefined> {
  const { stored, vault } = await connectionAndVault(svc);
  if (!stored || !vault) return undefined;
  try {
    const result = await syncOnce({
      driver: svc.driver,
      connection: connect(svc, stored),
      vault,
      clock: svc.clock,
      secrets: svc.secrets,
    });
    await svc.store.setLocal(STATUS_KEY, { lastSync: new Date().toISOString(), lastResult: result });
    if (result.pulled > 0) await svc.queryClient.invalidateQueries();
    return result;
  } catch (error) {
    await svc.store.setLocal(STATUS_KEY, {
      lastSync: new Date().toISOString(),
      lastError: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    await svc.queryClient.invalidateQueries({ queryKey: ["sync"] });
  }
}

export async function disconnectSync(svc: Services) {
  await svc.secrets.delete(SECRET_KEYS.syncConnection);
  await svc.secrets.delete(SECRET_KEYS.syncDataKey);
  await resetSyncCursors(svc.driver);
  await svc.store.setLocal(STATUS_KEY, {});
  await svc.queryClient.invalidateQueries({ queryKey: ["sync"] });
}

async function connected(svc: Services) {
  const { stored, vault } = await connectionAndVault(svc);
  if (!stored || !vault) throw new Error("Sync is not connected.");
  const connection = connect(svc, stored);
  const header = await connection.readHeader();
  if (!header) throw new Error("The vault header is missing from the database.");
  return { stored, vault, connection, header };
}

export async function changeVaultPassword(svc: Services, newPassword: string) {
  const { stored, vault, connection, header } = await connected(svc);
  await connection.writeHeader(await changePassword(header, vault, newPassword));
  return encodeConnectionCode(stored, newPassword);
}

export async function newRecoveryKey(svc: Services) {
  const { vault, connection, header } = await connected(svc);
  const rotated = await rotateRecoveryKey(header, vault);
  await connection.writeHeader(rotated.header);
  return rotated.recoveryKey;
}

/** Re-issues the connection code; the password is checked against the vault first. */
export async function connectionCode(svc: Services, password: string) {
  const { stored, header } = await connected(svc);
  await unlockVault(header, { password });
  return encodeConnectionCode(stored, password);
}
