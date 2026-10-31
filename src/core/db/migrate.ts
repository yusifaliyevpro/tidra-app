import type { SqlDriver } from "./driver";

export interface Migration {
  tag: string;
  sql: string;
}

/** Bundled drizzle-kit output, ordered by file name (`0000_init.sql`, `0001_...`). */
export function bundledMigrations(): Migration[] {
  const files = import.meta.glob<string>("../../../drizzle/*.sql", { query: "?raw", import: "default", eager: true });
  return Object.entries(files)
    .map(([path, sql]) => ({ tag: path.slice(path.lastIndexOf("/") + 1, -4), sql }))
    .toSorted((a, b) => a.tag.localeCompare(b.tag));
}

/** Applies migrations that have not run yet, each in its own transaction together with its bookkeeping row. */
export async function migrate(driver: SqlDriver, migrations: Migration[]): Promise<string[]> {
  await driver.script("CREATE TABLE IF NOT EXISTS __migrations (tag TEXT PRIMARY KEY, applied_at TEXT NOT NULL);");
  const applied = new Set((await driver.query("SELECT tag FROM __migrations", [])).map((row) => String(row[0])));
  const ran: string[] = [];
  for (const migration of migrations) {
    if (applied.has(migration.tag)) continue;
    const statements = migration.sql.replaceAll("--> statement-breakpoint", "");
    const tag = migration.tag.replaceAll("'", "''");
    await driver.script(
      `${statements}\nINSERT INTO __migrations (tag, applied_at) VALUES ('${tag}', '${new Date().toISOString()}');`,
    );
    ran.push(migration.tag);
  }
  return ran;
}
