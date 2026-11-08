import type { Client } from "@libsql/client/web";
import * as z from "@zod/mini";
import { SyncSetupError, type EncryptedRow, type SyncProvider } from "../provider";
import { VaultHeaderSchema } from "../vault";

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS tidra_vault (id INTEGER PRIMARY KEY CHECK (id = 1), header TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS tidra_rows (
    table_hash TEXT NOT NULL,
    id TEXT NOT NULL,
    nonce TEXT NOT NULL,
    ciphertext TEXT NOT NULL,
    hlc TEXT NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0,
    device_id TEXT NOT NULL,
    PRIMARY KEY (table_hash, id)
  )`,
  `CREATE INDEX IF NOT EXISTS tidra_rows_hlc ON tidra_rows (hlc)`,
];

const RowSchema = z.compile(
  z.object({
    table_hash: z.string(),
    id: z.string(),
    nonce: z.string(),
    ciphertext: z.string(),
    hlc: z.string(),
    deleted: z.number(),
    device_id: z.string(),
  }),
);

/** libSQL over HTTP; the same SQL also runs against any sqld server the user hosts. */
export const turso: SyncProvider = {
  id: "turso",
  label: "Turso",
  description: "Turso or your own sqld server. Tables are created on first connect.",
  fields: [
    { key: "url", label: "Database URL", placeholder: "libsql://your-db-your-org.turso.io" },
    { key: "authToken", label: "Auth token", secret: true },
  ],
  connect(config, fetcher) {
    if (!config.url) throw new SyncSetupError("Enter the database URL.");
    let client: Client | undefined;
    // The client loads on first use, so people who never sync don't load it at launch.
    const db = async () => {
      const { createClient } = await import("@libsql/client/web");
      return (client ??= createClient({ url: config.url ?? "", authToken: config.authToken, fetch: fetcher }));
    };

    return {
      async ensureSchema() {
        await (await db()).batch(SCHEMA, "write");
      },
      async readHeader() {
        const result = await (await db()).execute("SELECT header FROM tidra_vault WHERE id = 1");
        const raw = result.rows[0]?.header;
        if (typeof raw !== "string") return undefined;
        const header: unknown = JSON.parse(raw);
        return z.validate(VaultHeaderSchema, header) ? header : undefined;
      },
      async writeHeader(header) {
        await (
          await db()
        ).execute({
          sql: "INSERT INTO tidra_vault (id, header) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET header = excluded.header",
          args: [JSON.stringify(header)],
        });
      },
      async pull(since, limit) {
        const result = await (
          await db()
        ).execute({
          sql: "SELECT table_hash, id, nonce, ciphertext, hlc, deleted, device_id FROM tidra_rows WHERE hlc > ? ORDER BY hlc LIMIT ?",
          args: [since, limit],
        });
        return result.rows.flatMap((row): EncryptedRow[] => {
          const plain = { ...row };
          return z.validate(RowSchema, plain)
            ? [
                {
                  tableHash: plain.table_hash,
                  id: plain.id,
                  nonce: plain.nonce,
                  ciphertext: plain.ciphertext,
                  hlc: plain.hlc,
                  deleted: plain.deleted === 1,
                  deviceId: plain.device_id,
                },
              ]
            : [];
        });
      },
      async push(rows) {
        if (rows.length === 0) return;
        await (
          await db()
        ).batch(
          rows.map((row) => ({
            sql: `INSERT INTO tidra_rows (table_hash, id, nonce, ciphertext, hlc, deleted, device_id)
                  VALUES (?, ?, ?, ?, ?, ?, ?)
                  ON CONFLICT (table_hash, id) DO UPDATE SET
                    nonce = excluded.nonce, ciphertext = excluded.ciphertext, hlc = excluded.hlc,
                    deleted = excluded.deleted, device_id = excluded.device_id
                  WHERE excluded.hlc > tidra_rows.hlc`,
            args: [row.tableHash, row.id, row.nonce, row.ciphertext, row.hlc, row.deleted ? 1 : 0, row.deviceId],
          })),
          "write",
        );
      },
    };
  },
};
