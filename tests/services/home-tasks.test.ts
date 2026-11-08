import { describe, expect, it } from "vitest";
import type { HomeSummary, ProjectHealth } from "@/services/home";
import { homeTasks } from "@/services/home-tasks";

const NOW = Date.parse("2026-11-08T12:00:00Z");

const health = (id: string, extra: Partial<ProjectHealth> = {}): ProjectHealth => ({
  id,
  name: id,
  updates: { major: 0, minor: 0, patch: 0 },
  security: { critical: 0, high: 0, moderate: 0, low: 0, total: 0 },
  failsAudit: false,
  changed: 0,
  ahead: 0,
  behind: 0,
  ci: "none",
  score: 0,
  ...extra,
});

const summary = (extra: Partial<HomeSummary>): HomeSummary => ({
  projects: 0,
  updates: { major: 0, minor: 0, patch: 0, projects: 0 },
  security: { bySeverity: { critical: 0, high: 0, moderate: 0, low: 0 }, total: 0, failingAudit: 0 },
  ci: { failing: [], repos: [] },
  reviewRequests: 0,
  myPulls: 0,
  myPullsFailing: 0,
  botPulls: 0,
  deploys: { failing: [] },
  actions: { outdated: 0, repos: 0 },
  git: { dirty: 0, unpushed: 0, behind: 0 },
  health: [],
  releases: [],
  ...extra,
});

const release = (tag: string, publishedAt: string, major: boolean) => ({
  repo: "vercel/next.js",
  packageName: "next",
  tag,
  title: tag,
  body: "",
  publishedAt,
  major,
  usedBy: ["web"],
});

describe("homeTasks", () => {
  it("is empty when nothing needs the user", () => {
    expect(homeTasks(summary({ health: [health("web")] }), NOW)).toEqual([]);
  });

  it("puts advisories first, then failing CI, then major updates, then local work", () => {
    const tasks = homeTasks(
      summary({
        health: [
          health("docs", { changed: 3, branch: "main", score: 6 }),
          health("api", { updates: { major: 1, minor: 0, patch: 0 }, score: 4 }),
          health("web", { security: { critical: 1, high: 0, moderate: 0, low: 0, total: 1 }, score: 40 }),
        ],
        ci: { failing: [{ name: "site", repo: "acme/site", url: "https://x", title: "test" }], repos: [] },
      }),
      NOW,
    );
    expect(tasks.map((t) => t.kind)).toEqual(["advisory", "ci", "major", "uncommitted"]);
    expect(tasks[0]?.title).toEqual(["Critical advisory in ", "web", ""]);
    expect(tasks[0]?.target).toEqual({ kind: "security", projectId: "web" });
  });

  it("names a single project with major updates and groups several", () => {
    const one = homeTasks(summary({ health: [health("api", { updates: { major: 2, minor: 0, patch: 0 } })] }), NOW);
    expect(one[0]?.title).toEqual(["", "api", " has 2 major updates"]);
    const many = homeTasks(
      summary({
        health: [
          health("api", { updates: { major: 2, minor: 0, patch: 0 } }),
          health("web", { updates: { major: 1, minor: 0, patch: 0 } }),
        ],
      }),
      NOW,
    );
    expect(many).toHaveLength(1);
    expect(many[0]?.title).toEqual(["", "2 projects", " have major updates"]);
    expect(many[0]?.detail).toBe("api, web");
  });

  it("reports a failing audit without high advisories in its own words", () => {
    const tasks = homeTasks(summary({ health: [health("web", { failsAudit: true })] }), NOW);
    expect(tasks[0]?.title).toEqual(["", "web", " fails the security audit"]);
  });

  it("prefers uncommitted files over unpushed commits for the same project", () => {
    const tasks = homeTasks(summary({ health: [health("web", { changed: 2, ahead: 1 })] }), NOW);
    expect(tasks.map((t) => t.kind)).toEqual(["uncommitted"]);
  });

  it("lists only major releases from the last week", () => {
    const tasks = homeTasks(
      summary({
        releases: [
          release("v16.0.0", "2026-11-07T00:00:00Z", true),
          release("v15.6.0", "2026-11-07T00:00:00Z", false),
          release("v15.0.0", "2026-10-01T00:00:00Z", true),
        ],
      }),
      NOW,
    );
    expect(tasks.map((t) => t.title[2])).toEqual([" v16.0.0 released"]);
  });

  it("keeps minor-only projects last", () => {
    const tasks = homeTasks(
      summary({
        health: [health("cli", { updates: { major: 0, minor: 1, patch: 3 } })],
        reviewRequests: 2,
      }),
      NOW,
    );
    expect(tasks.map((t) => t.kind)).toEqual(["review", "minor"]);
    expect(tasks[1]?.title).toEqual(["", "cli", " has 4 updates"]);
  });
});
