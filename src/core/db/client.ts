import { drizzle, type SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy";
import type { SqlDriver } from "./driver";
import * as schema from "./schema";

export type Db = SqliteRemoteDatabase<typeof schema>;

export function createDb(driver: SqlDriver): Db {
  return drizzle(
    async (sql, params, method) => {
      if (method === "run") {
        await driver.execute(sql, params);
        return { rows: [] };
      }
      const rows = await driver.query(sql, params);
      if (method !== "get") return { rows };
      // Drizzle reads a single row for `get` and treats a missing one as "no match"; its type says any[].
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      return { rows: rows[0] as unknown[] };
    },
    { schema },
  );
}
