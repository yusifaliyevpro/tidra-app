import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { SqlDriver } from "@/core/db/driver";

function toSqlite(value: unknown): SQLInputValue {
  if (typeof value === "boolean") return Number(value);
  if (typeof value === "string" || typeof value === "number" || value === null) return value;
  return value === undefined ? null : JSON.stringify(value);
}

const isRows = (value: unknown): value is unknown[][] => Array.isArray(value) && value.every(Array.isArray);

/** In-memory SQLite with the same contract as the Rust driver, for core and sync tests. */
export function nodeSqliteDriver(): SqlDriver & { close(): void } {
  const db = new DatabaseSync(":memory:");
  return {
    query: async (sql, params) => {
      const stmt = db.prepare(sql);
      stmt.setReturnArrays(true);
      const rows: unknown = stmt.all(...params.map(toSqlite));
      if (!isRows(rows)) throw new Error("node:sqlite did not return array rows");
      return rows;
    },
    execute: async (sql, params) => {
      db.prepare(sql).run(...params.map(toSqlite));
    },
    script: async (sql) => {
      db.exec(`BEGIN;\n${sql}\nCOMMIT;`);
    },
    close: () => db.close(),
  };
}
