import type { SupabaseClient } from "@supabase/supabase-js";
import * as z from "@zod/mini";
import { SyncSetupError, type EncryptedRow, type SyncProvider } from "../provider";
import { VaultHeaderSchema } from "../vault";

/** Run once in the Supabase SQL editor. The upsert function keeps the newer HLC so concurrent devices never regress a row. */
export const SUPABASE_SETUP_SQL = `create table if not exists public.tidra_vault (
  id smallint primary key check (id = 1),
  header jsonb not null
);

create table if not exists public.tidra_rows (
  table_hash text not null,
  id text not null,
  nonce text not null,
  ciphertext text not null,
  hlc text not null,
  deleted boolean not null default false,
  device_id text not null,
  primary key (table_hash, id)
);
create index if not exists tidra_rows_hlc on public.tidra_rows (hlc);

alter table public.tidra_vault enable row level security;
alter table public.tidra_rows enable row level security;

create or replace function public.tidra_push(rows jsonb) returns void
language sql security definer set search_path = public as $$
  insert into tidra_rows (table_hash, id, nonce, ciphertext, hlc, deleted, device_id)
  select r->>'table_hash', r->>'id', r->>'nonce', r->>'ciphertext', r->>'hlc', (r->>'deleted')::boolean, r->>'device_id'
  from jsonb_array_elements(rows) r
  on conflict (table_hash, id) do update set
    nonce = excluded.nonce, ciphertext = excluded.ciphertext, hlc = excluded.hlc,
    deleted = excluded.deleted, device_id = excluded.device_id
  where excluded.hlc > tidra_rows.hlc;
$$;
revoke all on function public.tidra_push(jsonb) from public, anon, authenticated;`;

const RowSchema = z.compile(
  z.array(
    z.object({
      table_hash: z.string(),
      id: z.string(),
      nonce: z.string(),
      ciphertext: z.string(),
      hlc: z.string(),
      deleted: z.boolean(),
      device_id: z.string(),
    }),
  ),
);

const MISSING_TABLE = /relation .*tidra_|Could not find the (table|function)/i;

function check(error: { message: string } | null) {
  if (!error) return;
  if (MISSING_TABLE.test(error.message)) {
    throw new SyncSetupError(
      "Tidra's tables are missing. Run the setup SQL in the Supabase SQL editor, then try again.",
    );
  }
  throw new Error(error.message);
}

export const supabase: SyncProvider = {
  id: "supabase",
  label: "Supabase",
  description: "Run the setup SQL once, then use the service-role key.",
  fields: [
    { key: "url", label: "Project URL", placeholder: "https://your-project.supabase.co" },
    { key: "serviceKey", label: "Service-role key", secret: true },
  ],
  setupSql: SUPABASE_SETUP_SQL,
  connect(config, fetcher) {
    if (!config.url || !config.serviceKey) throw new SyncSetupError("Enter the project URL and service-role key.");
    let client: SupabaseClient | undefined;
    // The client loads on first use, so people who never sync don't load it at launch.
    const db = async () => {
      const { createClient } = await import("@supabase/supabase-js");
      return (client ??= createClient(config.url ?? "", config.serviceKey ?? "", {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { fetch: fetcher },
      }));
    };

    return {
      async ensureSchema() {
        const { error } = await (await db()).from("tidra_vault").select("id").limit(1);
        check(error);
      },
      async readHeader() {
        const { data, error } = await (await db()).from("tidra_vault").select("header").eq("id", 1).maybeSingle();
        check(error);
        const header: unknown = data?.header;
        return z.validate(VaultHeaderSchema, header) ? header : undefined;
      },
      async writeHeader(header) {
        const { error } = await (await db()).from("tidra_vault").upsert({ id: 1, header });
        check(error);
      },
      async pull(since, limit) {
        const { data, error } = await (
          await db()
        )
          .from("tidra_rows")
          .select("table_hash, id, nonce, ciphertext, hlc, deleted, device_id")
          .gt("hlc", since)
          .order("hlc")
          .limit(limit);
        check(error);
        const rows: unknown = data ?? [];
        if (!z.validate(RowSchema, rows)) return [];
        return rows.map((row): EncryptedRow => ({
          tableHash: row.table_hash,
          id: row.id,
          nonce: row.nonce,
          ciphertext: row.ciphertext,
          hlc: row.hlc,
          deleted: row.deleted,
          deviceId: row.device_id,
        }));
      },
      async push(rows) {
        if (rows.length === 0) return;
        const payload = rows.map((row) => ({
          table_hash: row.tableHash,
          id: row.id,
          nonce: row.nonce,
          ciphertext: row.ciphertext,
          hlc: row.hlc,
          deleted: row.deleted,
          device_id: row.deviceId,
        }));
        const { error } = await (await db()).rpc("tidra_push", { rows: payload });
        check(error);
      },
    };
  },
};
