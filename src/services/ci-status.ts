import { runFailed, type WorkflowRun } from "@/integrations/github";
import type { Tone } from "@/ui/tone";
import type { CiEntry } from "./github-feed";

export function runTone(run: WorkflowRun): { tone: Tone; label: string } {
  if (run.status !== "completed") return { tone: "warn", label: run.status ?? "queued" };
  if (run.conclusion === "success") return { tone: "ok", label: "passed" };
  if (runFailed(run))
    return { tone: "bad", label: run.conclusion === "failure" ? "failed" : (run.conclusion ?? "failed") };
  return { tone: "neutral", label: run.conclusion ?? "done" };
}

/**
 * The run that speaks for the default branch: each workflow's latest run counts, so one failing workflow fails the
 * repo even when another ran after it. Then one still running, then the newest.
 */
export function defaultBranchRun(entry: CiEntry): WorkflowRun | undefined {
  const runs = entry.runs.filter((r) => r.head_branch === entry.defaultBranch);
  return (
    runs.find((r) => r.status === "completed" && runFailed(r)) ?? runs.find((r) => r.status !== "completed") ?? runs[0]
  );
}

/** The default branch's run, else the latest run at all. */
export const latestRun = (entry: CiEntry) => defaultBranchRun(entry) ?? entry.runs[0];
