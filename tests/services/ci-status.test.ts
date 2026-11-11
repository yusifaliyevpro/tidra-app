import { describe, expect, it } from "vitest";
import type { WorkflowRun } from "@/integrations/github";
import { latestRun } from "@/services/ci-status";

const run = (extra: Partial<WorkflowRun>): WorkflowRun => ({
  id: 1,
  name: "CI",
  head_branch: "main",
  status: "completed",
  conclusion: "success",
  event: "push",
  html_url: "u",
  created_at: "2026-11-01T00:00:00Z",
  run_number: 1,
  ...extra,
});

const entry = (runs: WorkflowRun[]) => ({ name: "app", repo: "me/app", defaultBranch: "main", runs });

describe("latestRun", () => {
  it("picks a failing workflow over a newer passing one on the default branch", () => {
    const failing = run({ id: 2, name: "CI", conclusion: "failure" });
    expect(latestRun(entry([run({ id: 3, name: "Deploy" }), failing]))).toBe(failing);
  });

  it("ignores failures on other branches", () => {
    const passing = run({ id: 3 });
    expect(latestRun(entry([run({ id: 4, head_branch: "feature", conclusion: "failure" }), passing]))).toBe(passing);
  });

  it("falls back to the newest run when the default branch has none", () => {
    const other = run({ id: 4, head_branch: "feature" });
    expect(latestRun(entry([other]))).toBe(other);
  });
});
