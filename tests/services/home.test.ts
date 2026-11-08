import { describe, expect, it, vi } from "vitest";
import { dismissals } from "@/core/db/schema";
import type { Finding } from "@/engine/advisories";
import type { WorkflowRun } from "@/integrations/github";
import type { CiSnapshot } from "@/services/github-feed";
import { homeSummary } from "@/services/home";
import { reportKey } from "@/services/projects";
import { securityKey } from "@/services/security";
import { writeSnapshot } from "@/services/snapshot";
import { outdatedEntry, projectReport, testServices } from "../support/services";

const finding = (id: string, severity: Finding["severity"], dev = false): Finding => ({
  id,
  aliases: [],
  summary: id,
  severity,
  name: "pkg",
  version: "1.0.0",
  dev,
  direct: true,
  url: "u",
});

const run = (extra: Partial<WorkflowRun>): WorkflowRun => ({
  id: 1,
  name: "CI",
  head_branch: "main",
  status: "completed",
  conclusion: "success",
  event: "push",
  html_url: "https://github.com/me/app/actions/runs/1",
  created_at: "2026-11-01T00:00:00Z",
  run_number: 1,
  ...extra,
});

async function setup() {
  const { svc, close } = await testServices();
  await svc.store.addProject({ id: "a", name: "app", remote: "github.com/me/app", path: "/app" });
  await svc.store.addProject({ id: "b", name: "lib", remote: "github.com/me/lib", path: "/lib" });
  return { svc, close };
}

const ci = (runsOfApp: WorkflowRun[]): CiSnapshot => ({
  entries: [{ name: "app", repo: "me/app", defaultBranch: "main", runs: runsOfApp }],
  updatedAt: "2026-11-01T00:00:00Z",
});

const deployment = (id: string, state: string, createdAt: string) => ({
  provider: "vercel",
  id,
  project: "web",
  state,
  createdAt,
});

describe("homeSummary", () => {
  it("is empty and calm without any data", async () => {
    const { svc, close } = await testServices();
    const summary = await homeSummary(svc);
    close();
    expect(summary).toMatchObject({ projects: 0, updates: { major: 0, minor: 0, patch: 0, projects: 0 }, health: [] });
  });

  it("totals updates per bump and counts projects that have any", async () => {
    const { svc, close } = await setup();
    await writeSnapshot(
      svc,
      reportKey("a"),
      projectReport([
        outdatedEntry("react", "18.0.0", "19.0.0", "major"),
        outdatedEntry("zod", "4.0.0", "4.1.0", "minor"),
        outdatedEntry("vite", "8.0.0", "8.0.1", "patch"),
      ]),
    );
    await writeSnapshot(svc, reportKey("b"), projectReport([]));
    const summary = await homeSummary(svc);
    close();
    expect(summary.updates).toEqual({ major: 1, minor: 1, patch: 1, projects: 1 });
    expect(summary.health[0]).toMatchObject({ id: "a", updates: { major: 1, minor: 1, patch: 1 } });
  });

  it("counts advisories by severity, leaves dismissed ones out, and applies the CI audit threshold", async () => {
    const { svc, close } = await setup();
    await writeSnapshot(svc, securityKey("a"), {
      projectId: "a",
      findings: [finding("GHSA-1", "critical"), finding("GHSA-2", "high", true), finding("GHSA-3", "low")],
      scanned: 3,
      updatedAt: "2026-11-01T00:00:00Z",
    });
    await svc.store.db.insert(dismissals).values({ id: "d1", target: "GHSA-3", hlc: "0", deviceId: "dev" });
    const summary = await homeSummary(svc);
    close();
    expect(summary.security).toEqual({
      bySeverity: { critical: 1, high: 1, moderate: 0, low: 0 },
      total: 2,
      failingAudit: 1,
    });
  });

  it("orders projects by how much needs attention", async () => {
    const { svc, close } = await setup();
    await writeSnapshot(svc, reportKey("a"), projectReport([outdatedEntry("x", "1.0.0", "1.0.1", "patch")]));
    await writeSnapshot(svc, reportKey("b"), { ...projectReport([]), error: "broken" });
    const summary = await homeSummary(svc);
    close();
    expect(summary.health.map((h) => [h.name, h.score])).toEqual([
      ["lib", 20],
      ["app", 1],
    ]);
  });

  it("marks a repo failing from its latest default branch run", async () => {
    const { svc, close } = await setup();
    await writeSnapshot(svc, "ci", ci([run({ conclusion: "failure", display_title: "Fix tests" }), run({ id: 0 })]));
    const summary = await homeSummary(svc);
    close();
    expect(summary.ci.failing).toEqual([
      { name: "app", repo: "me/app", url: "https://github.com/me/app/actions/runs/1", title: "Fix tests" },
    ]);
    expect(summary.health.find((h) => h.id === "a")?.ci).toBe("failure");
  });

  it("shows a running workflow as pending", async () => {
    const { svc, close } = await setup();
    await writeSnapshot(svc, "ci", ci([run({ status: "in_progress", conclusion: null })]));
    const summary = await homeSummary(svc);
    close();
    expect(summary.ci.repos[0]?.state).toBe("pending");
  });

  it("ignores pull request runs for the default branch state", async () => {
    const { svc, close } = await setup();
    await writeSnapshot(svc, "ci", ci([run({ head_branch: "feature/x", conclusion: "failure" })]));
    const summary = await homeSummary(svc);
    close();
    expect(summary.ci.failing).toEqual([]);
  });

  it("treats timed out runs as failing", async () => {
    const { svc, close } = await setup();
    await writeSnapshot(svc, "ci", ci([run({ conclusion: "timed_out" })]));
    const summary = await homeSummary(svc);
    close();
    expect(summary.ci.repos[0]?.state).toBe("failure");
  });

  it("lists failing deploys by their latest deployment only", async () => {
    const { svc, close } = await setup();
    await writeSnapshot(svc, "deploys", {
      deployments: [deployment("2", "ready", "2026-11-02T00:00:00Z"), deployment("1", "error", "2026-11-01T00:00:00Z")],
      errors: [],
      configured: ["vercel"],
      updatedAt: "2026-11-02T00:00:00Z",
    });
    const summary = await homeSummary(svc);
    close();
    expect(summary.deploys.failing).toEqual([]);
  });
});

describe("what homeSummary reads", () => {
  it("reads each project's report once", async () => {
    const { svc, close } = await testServices();
    await svc.store.addProject({ id: "p1", name: "app", remote: null, path: "/app" });
    await writeSnapshot(svc, reportKey("p1"), projectReport([]));
    const query = vi.spyOn(svc.driver, "query");
    await homeSummary(svc);
    close();
    expect(query.mock.calls.filter(([, params]) => JSON.stringify(params).includes("report:p1"))).toHaveLength(1);
  });
});
