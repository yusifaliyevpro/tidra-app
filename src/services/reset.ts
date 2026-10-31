import { SECRET_KEYS } from "@/core/secrets";
import type { Services } from "./context";

/** Wipes this device back to a fresh install: every table and keychain entry. A synced database is left alone. */
export async function deleteAllData(svc: Services): Promise<void> {
  svc.scheduler.setPaused(true);
  const tables = await svc.driver.query(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> '__migrations'",
    [],
  );
  await svc.driver.script(tables.map(([name]) => `DELETE FROM "${String(name)}";`).join("\n"));
  await Promise.all(Object.values(SECRET_KEYS).map((key) => svc.secrets.delete(key)));
  svc.queryClient.clear();
}
