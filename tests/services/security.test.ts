import * as z from "@zod/mini";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { projectPaths } from "@/core/db/schema";
import { OSV_BATCH_URL } from "@/engine/advisories";
import { readSecurity, scanAllProjects, scanProject } from "@/services/security";
import { jsonResponse, memoryIo } from "../support/memory-io";
import { testServices } from "../support/services";

const files = {
  "/app/package.json": JSON.stringify({
    name: "app",
    dependencies: { semver: "^7.0.0" },
    devDependencies: { vite: "^8.0.0" },
  }),
  "/app/package-lock.json": JSON.stringify({
    lockfileVersion: 3,
    packages: {
      "": {},
      "node_modules/semver": { version: "7.5.0" },
      "node_modules/vite": { version: "8.0.0", dev: true },
      "node_modules/esbuild": { version: "0.30.0", dev: true },
    },
  }),
};

const BatchBody = z.object({ queries: z.array(z.object({ package: z.object({ name: z.string() }) })) });

const SEMVER_VULN = {
  id: "GHSA-semver",
  summary: "ReDoS",
  database_specific: { severity: "HIGH" },
  affected: [
    {
      package: { name: "semver", ecosystem: "npm" },
      ranges: [{ type: "SEMVER", events: [{ introduced: "7.0.0" }, { fixed: "7.5.2" }] }],
    },
  ],
};

interface Osv {
  batch?: () => Response;
  vuln?: (id: string) => Response;
}

async function setup(osv: Osv = {}) {
  const requests: string[] = [];
  const io = memoryIo(files, {
    fetch: async (input, init) => {
      const url = new Request(input, init).url;
      requests.push(url);
      if (url === OSV_BATCH_URL) {
        if (osv.batch) return osv.batch();
        const body = BatchBody.parse(JSON.parse(typeof init?.body === "string" ? init.body : "{}"));
        return jsonResponse({
          results: body.queries.map((q) => (q.package.name === "semver" ? { vulns: [{ id: "GHSA-semver" }] } : {})),
        });
      }
      const id = url.split("/").pop() ?? "";
      return osv.vuln ? osv.vuln(id) : jsonResponse(SEMVER_VULN);
    },
  });
  const { svc, close } = await testServices(io);
  await svc.store.addProject({ id: "p1", name: "app", remote: null, path: "/app" });
  return { svc, close, requests };
}

describe("scanProject", () => {
  it("reports advisories for installed packages with their fix and whether they're direct", async () => {
    const { svc, close } = await setup();
    const report = await scanProject(svc, "p1");
    close();
    expect(report).toMatchObject({ projectId: "p1", scanned: 3 });
    expect(report.error).toBeUndefined();
    expect(report.findings).toEqual([
      expect.objectContaining({
        id: "GHSA-semver",
        name: "semver",
        version: "7.5.0",
        severity: "high",
        direct: true,
        dev: false,
        fixedIn: "7.5.2",
      }),
    ]);
  });

  it("asks OSV once per lockfile while it is unchanged, unless forced", async () => {
    const { svc, close, requests } = await setup();
    await scanProject(svc, "p1");
    await scanProject(svc, "p1");
    const batches = () => requests.filter((url) => url === OSV_BATCH_URL).length;
    expect(batches()).toBe(1);
    await scanProject(svc, "p1", { force: true });
    close();
    expect(batches()).toBe(2);
  });

  it("caches advisory details across projects and scans", async () => {
    const { svc, close, requests } = await setup();
    await scanProject(svc, "p1");
    await scanProject(svc, "p1", { force: true });
    close();
    expect(requests.filter((url) => url.includes("/v1/vulns/")).length).toBe(1);
  });

  it("explains a project without a folder on this device", async () => {
    const { svc, close } = await setup();
    await svc.store.addProject({ id: "p2", name: "elsewhere", remote: "github.com/me/x", path: "/elsewhere" });
    await svc.store.db.delete(projectPaths).where(eq(projectPaths.projectId, "p2"));
    const report = await scanProject(svc, "p2");
    close();
    expect(report).toMatchObject({ findings: [], scanned: 0, error: "No folder on this device." });
  });

  it("reports OSV failures as the scan's error", async () => {
    const { svc, close } = await setup({ batch: () => new Response("{}", { status: 400 }) });
    const report = await scanProject(svc, "p1");
    close();
    expect(report.error).toBe("OSV returned 400");
  });

  it("keeps the last findings when a later scan fails", async () => {
    let up = true;
    const { svc, close } = await setup({
      batch: () =>
        up
          ? jsonResponse({ results: [{ vulns: [{ id: "GHSA-semver" }] }, {}, {}] })
          : new Response("{}", { status: 400 }),
    });
    await scanProject(svc, "p1");
    up = false;
    await scanProject(svc, "p1", { force: true });
    const report = await readSecurity(svc, "p1");
    close();
    expect(report?.findings.map((f) => f.id)).toEqual(["GHSA-semver"]);
  });

  it("asks again for advisory details that failed to load", async () => {
    let up = false;
    const { svc, close } = await setup({
      vuln: () => (up ? jsonResponse(SEMVER_VULN) : new Response("{}", { status: 400 })),
    });
    expect((await scanProject(svc, "p1")).findings).toEqual([]);
    up = true;
    const report = await scanProject(svc, "p1", { force: true });
    close();
    expect(report.findings.map((f) => f.id)).toEqual(["GHSA-semver"]);
  });
});

describe("scanAllProjects", () => {
  it("scans every project and stops starting new scans once aborted", async () => {
    const { svc, close, requests } = await setup();
    const controller = new AbortController();
    controller.abort();
    await scanAllProjects(svc, controller.signal);
    expect(requests).toEqual([]);
    await scanAllProjects(svc);
    close();
    expect(requests.filter((url) => url === OSV_BATCH_URL)).toHaveLength(1);
  });
});

describe("incomplete scans", () => {
  it("doesn't reuse a scan that is missing an advisory, even without force", async () => {
    let up = false;
    const { svc, close, requests } = await setup({
      vuln: () => (up ? jsonResponse(SEMVER_VULN) : new Response("{}", { status: 400 })),
    });
    await scanProject(svc, "p1");
    up = true;
    const report = await scanProject(svc, "p1");
    close();
    expect(report.findings.map((f) => f.id)).toEqual(["GHSA-semver"]);
    expect(requests.filter((url) => url === OSV_BATCH_URL)).toHaveLength(2);
  });

  it("shows the error next to the last findings when a scan fails", async () => {
    let up = true;
    const { svc, close } = await setup({
      batch: () =>
        up
          ? jsonResponse({ results: [{ vulns: [{ id: "GHSA-semver" }] }, {}, {}] })
          : new Response("{}", { status: 400 }),
    });
    await scanProject(svc, "p1");
    up = false;
    const report = await scanProject(svc, "p1", { force: true });
    close();
    expect(report.error).toBe("OSV returned 400");
    expect(report.findings).toHaveLength(1);
  });
});
