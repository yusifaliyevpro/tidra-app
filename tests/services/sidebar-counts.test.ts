import { describe, expect, it } from "vitest";
import type { HomeSummary } from "@/services/home";
import { countFor } from "@/services/sidebar-counts";

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

describe("countFor", () => {
  const urgent = summary({
    security: { bySeverity: { critical: 35, high: 100, moderate: 3, low: 0 }, total: 138, failingAudit: 4 },
    ci: { failing: [{ name: "web", repo: "acme/web", url: "", title: "CI" }], repos: [] },
  });

  it("shows high and critical advisories on Security only, not again on Home", () => {
    expect(countFor("security", urgent)).toEqual({ value: 135, tone: "bad", title: "High and critical advisories" });
    expect(countFor("home", urgent)).toBeUndefined();
  });

  it("shows failing CI on Repos", () => {
    expect(countFor("repos", urgent)).toMatchObject({ value: 1, tone: "bad" });
  });

  it("hides zero counts", () => {
    expect(countFor("security", summary({}))).toBeUndefined();
  });
});
