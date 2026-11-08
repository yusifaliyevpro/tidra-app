import * as z from "@zod/mini";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import type { SqlDriver } from "@/core/db/driver";
import { SYNCED_TABLES } from "@/core/db/schema";
import { SYNCED_SECRET_KEYS, type SecretKey, type SecretStore } from "@/core/secrets";
import type { Clock } from "./hlc";
import type { EncryptedRow, SyncConnection } from "./provider";
import type { Vault } from "./vault";

/** Secrets ride along as a virtual table; their HLCs live in `kv` because the keychain has no metadata. */
export const SECRETS_TABLE = "__secrets";
const SECRET_HLC_PREFIX = "secret-hlc:";
const PULL_CURSOR = "sync:pulled";
const PUSH_CURSOR = "sync:pushed";
const PAGE = 500;
const ZERO = "0";

interface TableMeta {
  name: string;
  columns: string[];
}

export const SYNCED_TABLE_META: TableMeta[] = Object.values(SYNCED_TABLES).map((table) => {
  const config = getTableConfig(table);
  return { name: config.name, columns: config.columns.map((column) => column.name) };
});

const SecretPayload = z.compile(z.object({ value: z.nullable(z.string()) }));
const RowPayload = z.compile(z.record(z.string(), z.unknown()));

export interface SyncResult {
  pushed: number;
  pulled: number;
  /** Rows that failed to decrypt: a different vault, or tampering. Never applied. */
  rejected: number;
}

export interface SyncDeps {
  driver: SqlDriver;
  connection: SyncConnection;
  vault: Vault;
  clock: Clock;
  secrets: SecretStore;
}

const quote = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`;

async function getKv(driver: SqlDriver, key: string): Promise<string> {
  const rows = await driver.query("SELECT value FROM kv WHERE key = ?", [key]);
  const raw = rows[0]?.[0];
  if (typeof raw !== "string") return ZERO;
  const value: unknown = JSON.parse(raw);
  return typeof value === "string" ? value : ZERO;
}

async function setKv(driver: SqlDriver, key: string, value: string) {
  await driver.execute(
    "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
    [key, JSON.stringify(value)],
  );
}

/** Call whenever a synced secret changes so the next sync uploads it. */
export async function stampSecret(driver: SqlDriver, clock: Clock, key: SecretKey): Promise<void> {
  await setKv(driver, SECRET_HLC_PREFIX + key, clock.tick());
}

async function localChanges(deps: SyncDeps, since: string): Promise<EncryptedRow[]> {
  const [tables, secrets] = await Promise.all([
    Promise.all(
      SYNCED_TABLE_META.map(async (table) => {
        const rows = await deps.driver.query(
          `SELECT ${table.columns.map(quote).join(", ")} FROM ${quote(table.name)} WHERE hlc > ? AND device_id = ?`,
          [since, deps.clock.deviceId],
        );
        return Promise.all(
          rows.map(async (values): Promise<EncryptedRow> => {
            const row = Object.fromEntries(table.columns.map((column, i) => [column, values[i]]));
            const id = String(row.id);
            const sealed = await deps.vault.encryptRow(table.name, id, JSON.stringify(row));
            const deleted = row.deleted === 1 || row.deleted === true;
            return { ...sealed, id, hlc: String(row.hlc), deleted, deviceId: deps.clock.deviceId };
          }),
        );
      }),
    ),
    Promise.all(
      SYNCED_SECRET_KEYS.map(async (key): Promise<EncryptedRow | undefined> => {
        const hlc = await getKv(deps.driver, SECRET_HLC_PREFIX + key);
        if (hlc === ZERO || hlc <= since || !hlc.endsWith(`:${deps.clock.deviceId}`)) return undefined;
        const value = (await deps.secrets.get(key)) ?? null;
        const sealed = await deps.vault.encryptRow(SECRETS_TABLE, key, JSON.stringify({ value }));
        return { ...sealed, id: key, hlc, deleted: value === null, deviceId: deps.clock.deviceId };
      }),
    ),
  ]);
  const out = [...tables.flat(), ...secrets.filter((row): row is EncryptedRow => row !== undefined)];
  return out.toSorted((a, b) => (a.hlc < b.hlc ? -1 : 1));
}

async function applyRemote(deps: SyncDeps, row: EncryptedRow, tables: Map<string, TableMeta>): Promise<boolean> {
  const table = tables.get(row.tableHash);
  if (!table) return false;
  let json: string;
  try {
    json = await deps.vault.decryptRow(table.name, row.id, row);
  } catch {
    return false;
  }
  const payload: unknown = JSON.parse(json);

  if (table.name === SECRETS_TABLE) {
    if (!z.validate(SecretPayload, payload)) return false;
    const key = SYNCED_SECRET_KEYS.find((k) => k === row.id);
    if (!key || (await getKv(deps.driver, SECRET_HLC_PREFIX + key)) >= row.hlc) return true;
    if (payload.value === null) await deps.secrets.delete(key);
    else await deps.secrets.set(key, payload.value);
    await setKv(deps.driver, SECRET_HLC_PREFIX + key, row.hlc);
    return true;
  }

  if (!z.validate(RowPayload, payload)) return false;
  // Only known columns are written, so a decrypted payload can never inject SQL identifiers.
  const columns = table.columns.filter((column) => column in payload);
  const values = columns.map((column) => {
    const value = payload[column];
    return value !== null && typeof value === "object" ? JSON.stringify(value) : value;
  });
  const updates = columns.filter((c) => c !== "id").map((c) => `${quote(c)} = excluded.${quote(c)}`);
  await deps.driver.execute(
    `INSERT INTO ${quote(table.name)} (${columns.map(quote).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})
     ON CONFLICT (id) DO UPDATE SET ${updates.join(", ")} WHERE excluded.hlc > ${quote(table.name)}.hlc`,
    values,
  );
  return true;
}

/** Push local changes, then pull and merge remote ones; the newer HLC wins per row. */
export async function syncOnce(deps: SyncDeps): Promise<SyncResult> {
  const result: SyncResult = { pushed: 0, pulled: 0, rejected: 0 };

  const pushedCursor = await getKv(deps.driver, PUSH_CURSOR);
  const outgoing = await localChanges(deps, pushedCursor);
  for (let i = 0; i < outgoing.length; i += PAGE) {
    const page = outgoing.slice(i, i + PAGE);
    await deps.connection.push(page);
    result.pushed += page.length;
    const last = page.at(-1);
    if (last) await setKv(deps.driver, PUSH_CURSOR, last.hlc);
  }

  const metas: TableMeta[] = [...SYNCED_TABLE_META, { name: SECRETS_TABLE, columns: [] }];
  const hashes = await Promise.all(metas.map((meta) => deps.vault.tableHash(meta.name)));
  const tables = new Map(metas.map((meta, i) => [hashes[i] ?? "", meta]));

  let cursor = await getKv(deps.driver, PULL_CURSOR);
  for (;;) {
    const page = await deps.connection.pull(cursor, PAGE);
    for (const row of page) {
      deps.clock.receive(row.hlc);
      if (row.deviceId === deps.clock.deviceId) continue;
      if (await applyRemote(deps, row, tables)) result.pulled++;
      else result.rejected++;
    }
    const last = page.at(-1);
    if (!last) break;
    cursor = last.hlc;
    await setKv(deps.driver, PULL_CURSOR, cursor);
    if (page.length < PAGE) break;
  }
  return result;
}

/** Forget sync progress, e.g. after connecting to a different database. */
export async function resetSyncCursors(driver: SqlDriver): Promise<void> {
  await driver.execute("DELETE FROM kv WHERE key IN (?, ?)", [PULL_CURSOR, PUSH_CURSOR]);
}

/** Marks every local row and secret as changed so the next sync uploads everything (first connect). */
export async function markAllForUpload(deps: Pick<SyncDeps, "driver" | "clock" | "secrets">): Promise<void> {
  for (const table of SYNCED_TABLE_META) {
    const ids = await deps.driver.query(`SELECT id FROM ${quote(table.name)}`, []);
    for (const [id] of ids) {
      await deps.driver.execute(`UPDATE ${quote(table.name)} SET hlc = ?, device_id = ? WHERE id = ?`, [
        deps.clock.tick(),
        deps.clock.deviceId,
        id,
      ]);
    }
  }
  for (const key of SYNCED_SECRET_KEYS) {
    if (await deps.secrets.get(key)) await stampSecret(deps.driver, deps.clock, key);
  }
}
