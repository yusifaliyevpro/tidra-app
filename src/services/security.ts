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
import { cached, HOUR, readSnapshot, writeSnapshot } from "./snapshot";

export interface SecurityReport {
  projectId: string;
  findings: Finding[];
  scanned: number;
  error?: string;
  updatedAt: string;
}

export const securityKey = (projectId: string) => `security:${projectId}`;

async function vulnDetails(svc: Services, id: string): Promise<OsvVuln | undefined> {
  const hit = await cached(svc, `osv:${id}`, 24 * HOUR, async () => {
    const response = await fetchWithRetry(svc.io.fetch, osvVulnUrl(id), {});
    const data: unknown = response.ok ? await response.json() : undefined;
    return { vuln: z.validate(OsvVulnSchema, data) ? data : undefined };
  });
  return hit.vuln;
}

export async function scanProject(svc: Services, projectId: string): Promise<SecurityReport> {
  const project = await svc.store.getProject(projectId);
  const updatedAt = new Date().toISOString();
  if (!project?.path) return { projectId, findings: [], scanned: 0, error: "No folder on this device.", updatedAt };
  try {
    const workspace = await loadWorkspace(svc.io, project.path);
    const packages = workspace.lockfile.packages;
    const direct = new Set(
      workspace.importers.flatMap((i) => [
        ...Object.keys(i.manifest.dependencies ?? {}),
        ...Object.keys(i.manifest.devDependencies ?? {}),
        ...Object.keys(i.manifest.optionalDependencies ?? {}),
      ]),
    );
    const findings: Finding[] = [];
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
      }
    }
    const unique = new Map(findings.map((f) => [`${f.id}:${f.name}@${f.version}`, f]));
    const report = { projectId, findings: [...unique.values()], scanned: packages.length, updatedAt };
    await writeSnapshot(svc, securityKey(projectId), report);
    return report;
  } catch (error) {
    const report = {
      projectId,
      findings: [],
      scanned: 0,
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

export async function scanAllProjects(svc: Services, signal?: AbortSignal): Promise<void> {
  for (const project of await svc.store.listProjects()) {
    if (signal?.aborted) return;
    await scanProject(svc, project.id);
  }
  await svc.queryClient.invalidateQueries({ queryKey: ["security"] });
}
