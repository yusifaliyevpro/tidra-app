import type { Io } from "@/engine/io";
import type { OutdatedEntry } from "@/engine/outdated";
import { createServices } from "@/services/context";
import type { ProjectReport } from "@/services/projects";
import { memoryIo } from "./memory-io";
import { nodeSqliteDriver } from "./node-sqlite";

/** Real services over in-memory SQLite and a memory Io, with preview-mode secrets. */
export async function testServices(io: Io = memoryIo()) {
  const driver = nodeSqliteDriver();
  const svc = await createServices({ io, driver, preview: true });
  return { svc, close: () => driver.close() };
}

export const outdatedEntry = (
  name: string,
  current: string,
  latest: string,
  bump: OutdatedEntry["bump"],
): OutdatedEntry => ({
  name,
  usages: [{ importer: ".", field: "dependencies", spec: `^${current}` }],
  range: `^${current}`,
  current,
  currentFromLockfile: true,
  latest,
  bump,
  heldBackByAge: false,
});

export const projectReport = (outdated: OutdatedEntry[]): ProjectReport => ({
  projectId: "p1",
  pm: { name: "pnpm", yarnBerry: false },
  importers: [{ path: "." }],
  scripts: {},
  checks: ["check"],
  outdated,
  registryErrors: [],
  branches: [],
  dependencies: [],
  updatedAt: "2026-10-31T00:00:00.000Z",
});
