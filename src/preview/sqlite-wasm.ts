import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import type { SqlDriver } from "@/core/db/driver";

type Bindable = string | number | null;

const bindable = (value: unknown): Bindable => {
  if (typeof value === "boolean") return Number(value);
  if (typeof value === "string" || typeof value === "number" || value === null) return value;
  return value === undefined ? null : JSON.stringify(value);
};

/** In-memory SQLite for the browser preview, so the UI runs without the Rust side. */
export async function createWasmDriver(): Promise<SqlDriver> {
  const sqlite3 = await sqlite3InitModule();
  const db = new sqlite3.oo1.DB(":memory:", "c");
  return {
    query: async (sql, params) =>
      db.exec({ sql, bind: params.map(bindable), rowMode: "array", returnValue: "resultRows" }),
    execute: async (sql, params) => {
      db.exec({ sql, bind: params.map(bindable) });
    },
    script: async (sql) => {
      db.exec(`BEGIN;\n${sql}\nCOMMIT;`);
    },
  };
}
