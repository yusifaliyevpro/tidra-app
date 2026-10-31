import type { EncryptedRow, SyncConnection } from "@/sync/provider";
import type { VaultHeader } from "@/sync/vault";

/** A shared "server" that behaves like the Turso/Supabase providers: newer HLC wins on upsert. */
export function memorySyncServer() {
  const rows = new Map<string, EncryptedRow>();
  let header: VaultHeader | undefined;
  const connection: SyncConnection = {
    ensureSchema: async () => {},
    readHeader: async () => header,
    writeHeader: async (next) => {
      header = next;
    },
    pull: async (since, limit) =>
      [...rows.values()]
        .filter((row) => row.hlc > since)
        .toSorted((a, b) => (a.hlc < b.hlc ? -1 : 1))
        .slice(0, limit),
    push: async (incoming) => {
      for (const row of incoming) {
        const key = `${row.tableHash}/${row.id}`;
        const existing = rows.get(key);
        if (!existing || row.hlc > existing.hlc) rows.set(key, row);
      }
    },
  };
  return { connection, rows };
}
