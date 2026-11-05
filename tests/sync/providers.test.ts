import { describe, expect, it } from "vitest";
import { SyncSetupError } from "@/sync/provider";
import { supabase } from "@/sync/providers/supabase";
import { turso } from "@/sync/providers/turso";
import { findSyncProvider, SYNC_PROVIDERS } from "@/sync/registry";

const noFetch = () => Promise.reject(new Error("no network"));

describe("sync provider registry", () => {
  it("finds providers by id", () => {
    expect(SYNC_PROVIDERS.map((p) => p.id)).toEqual(["turso", "supabase"]);
    expect(findSyncProvider("supabase")).toBe(supabase);
    expect(findSyncProvider("dropbox")).toBeUndefined();
  });
});

describe("turso", () => {
  it("asks for the database URL before connecting", () => {
    expect(() => turso.connect({}, noFetch)).toThrow(SyncSetupError);
    expect(() => turso.connect({ url: "libsql://db.turso.io", authToken: "t" }, noFetch)).not.toThrow();
  });
});

const json = (body: unknown, status = 200) => Response.json(body, { status });

describe("supabase", () => {
  type Handler = (url: URL, init?: RequestInit) => Response;
  const connect = (handler: Handler) => {
    const calls: { url: URL; method: string; body: unknown }[] = [];
    const connection = supabase.connect(
      { url: "https://p.supabase.co", serviceKey: "service" },
      async (input, init) => {
        const request = new Request(input, init);
        const url = new URL(request.url);
        calls.push({
          url,
          method: request.method,
          body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
        });
        return handler(url, init);
      },
    );
    return { connection, calls };
  };
  it("asks for the project URL and service-role key", () => {
    expect(() => supabase.connect({ url: "https://p.supabase.co" }, noFetch)).toThrow(
      "Enter the project URL and service-role key.",
    );
  });

  it("tells the user to run the setup SQL when the tables are missing", async () => {
    const { connection } = connect(() =>
      json({ code: "42P01", message: 'relation "public.tidra_vault" does not exist' }, 404),
    );
    await expect(connection.ensureSchema()).rejects.toBeInstanceOf(SyncSetupError);
  });

  it("passes other database errors through", async () => {
    const { connection } = connect(() => json({ message: "permission denied" }, 401));
    await expect(connection.ensureSchema()).rejects.toThrow("permission denied");
  });

  it("pulls rows newer than the cursor, in HLC order, as encrypted rows", async () => {
    const { connection, calls } = connect(() =>
      json([{ table_hash: "t", id: "1", nonce: "n", ciphertext: "c", hlc: "h2", deleted: false, device_id: "d" }]),
    );
    expect(await connection.pull("h1", 500)).toEqual([
      { tableHash: "t", id: "1", nonce: "n", ciphertext: "c", hlc: "h2", deleted: false, deviceId: "d" },
    ]);
    const params = calls[0]?.url.searchParams;
    expect(calls[0]?.url.pathname).toBe("/rest/v1/tidra_rows");
    expect(params?.get("hlc")).toBe("gt.h1");
    expect(params?.get("order")).toBe("hlc.asc");
    expect(params?.get("limit")).toBe("500");
  });

  it("pushes through the HLC-guarded function, and skips empty pushes", async () => {
    const { connection, calls } = connect(() => new Response(null, { status: 204 }));
    await connection.push([]);
    expect(calls).toEqual([]);
    await connection.push([
      { tableHash: "t", id: "1", nonce: "n", ciphertext: "c", hlc: "h", deleted: true, deviceId: "d" },
    ]);
    expect(calls[0]?.url.pathname).toBe("/rest/v1/rpc/tidra_push");
    expect(calls[0]?.body).toEqual({
      rows: [{ table_hash: "t", id: "1", nonce: "n", ciphertext: "c", hlc: "h", deleted: true, device_id: "d" }],
    });
  });

  it("reads no header from an empty vault table", async () => {
    const { connection } = connect(() => json(null));
    expect(await connection.readHeader()).toBeUndefined();
  });
});
