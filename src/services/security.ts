import * as z from "@zod/mini";
import {
  batchQueries,
  OSV_BATCH_LIMIT,
  OSV_BATCH_URL,
  OsvBatchSchema,
  osvVulnUrl,
  OsvVulnSchema,
  toFinding,
  type Finding,
  type OsvVuln,
} from "@/engine/advisories";
import { createLimit } from "@/engine/limit";
import { fetchWithRetry } from "@/engine/registry";
import { loadWorkspace } from "@/engine/workspace";
import type { Services } from "./context";
import { cached, HOUR, readSnapshot, readSnapshots, writeSnapshot } from "./snapshot";

export interface SecurityReport {
  projectId: string;
  findings: Finding[];
  scanned: number;
  error?: string;
  /** Lockfile hash the findings belong to; an unchanged lockfile skips OSV for a while. */
  lockfileHash?: string;
  updatedAt: string;
}

/** Advisory databases change slowly; an unchanged lockfile is re-queried at most this often. */
const RESCAN_MS = 12 * HOUR;

export const securityKey = (projectId: string) => `security:${projectId}`;

/** A failed lookup throws, so it isn't cached as an answer and the next scan asks again. */
async function vulnDetails(svc: Services, id: string): Promise<OsvVuln | undefined> {
  const hit = await cached(svc, `osv:${id}`, 24 * HOUR, async () => {
    const response = await fetchWithRetry(svc.io.fetch, osvVulnUrl(id), {});
    const data: unknown = response.ok ? await response.json() : undefined;
    if (!z.validate(OsvVulnSchema, data)) throw new Error(`Could not read advisory ${id}`);
    return { vuln: data };
  }).catch(() => undefined);
  return hit?.vuln;
}

export async function scanProject(
  svc: Services,
  projectId: string,
  options: { force?: boolean } = {},
): Promise<SecurityReport> {
  const project = await svc.store.getProject(projectId);
  const updatedAt = new Date().toISOString();
  if (!project?.path) return { projectId, findings: [], scanned: 0, error: "No folder on this device.", updatedAt };
  try {
    const workspace = await loadWorkspace(svc.io, project.path);
    const previous = options.force ? undefined : await readSecurity(svc, projectId);
    if (
      previous &&
      !previous.error &&
      workspace.lockfileHash &&
      previous.lockfileHash === workspace.lockfileHash &&
      Date.parse(updatedAt) - Date.parse(previous.updatedAt) < RESCAN_MS
    ) {
      return previous;
    }
    const packages = workspace.lockfile.packages;
    const direct = new Set(
      workspace.importers.flatMap((i) => [
        ...Object.keys(i.manifest.dependencies ?? {}),
        ...Object.keys(i.manifest.devDependencies ?? {}),
        ...Object.keys(i.manifest.optionalDependencies ?? {}),
      ]),
    );
    const findings: Finding[] = [];
    let complete = true;
    for (let start = 0; start < packages.length; start += OSV_BATCH_LIMIT) {
      const chunk = packages.slice(start, start + OSV_BATCH_LIMIT);
      const response = await fetchWithRetry(svc.io.fetch, OSV_BATCH_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ queries: batchQueries(chunk) }),
      });
      if (!response.ok) throw new Error(`OSV returned ${response.status}`);
      const data: unknown = await response.json();
      if (!z.validate(OsvBatchSchema, data)) throw new Error("Unexpected response from OSV");
      const hits = data.results.flatMap((result, index) => {
        const pkg = chunk[index];
        return pkg ? (result.vulns ?? []).map(({ id }) => ({ id, pkg })) : [];
      });
      const limit = createLimit(8);
      const details = await Promise.all(hits.map((hit) => limit(() => vulnDetails(svc, hit.id))));
      for (const [i, hit] of hits.entries()) {
        const vuln = details[i];
        if (vuln) findings.push(toFinding(vuln, hit.pkg, direct.has(hit.pkg.name)));
        else complete = false;
      }
    }
    const unique = new Map(findings.map((f) => [`${f.id}:${f.name}@${f.version}`, f]));
    const report = {
      projectId,
      findings: [...unique.values()],
      scanned: packages.length,
      // Without the hash the next scan doesn't reuse this one, so a missing advisory is looked up again.
      lockfileHash: complete ? workspace.lockfileHash : undefined,
      updatedAt,
    };
    await writeSnapshot(svc, securityKey(projectId), report);
    return report;
  } catch (error) {
    // Offline or OSV down: what was last known still holds, so it stays on screen next to the error.
    const previous = await readSecurity(svc, projectId);
    const report = {
      projectId,
      findings: previous?.findings ?? [],
      scanned: previous?.scanned ?? 0,
      error: error instanceof Error ? error.message : String(error),
      updatedAt,
    };
    await writeSnapshot(svc, securityKey(projectId), report);
    return report;
  }
}

export async function readSecurity(svc: Services, projectId: string) {
  return (await readSnapshot<SecurityReport>(svc, securityKey(projectId)))?.data;
}

export const readAllSecurity = (svc: Services, projectIds: string[]) =>
  readSnapshots<SecurityReport>(svc, projectIds.map(securityKey));

export async function scanAllProjects(svc: Services, signal?: AbortSignal): Promise<void> {
  const limit = createLimit(3);
  const projects = await svc.store.listProjects();
  await Promise.all(projects.map((p) => limit(async () => (signal?.aborted ? undefined : scanProject(svc, p.id)))));
  await svc.queryClient.invalidateQueries({ queryKey: ["security"] });
}
