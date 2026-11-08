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

/** The latest run on the default branch, else the latest run at all. */
export const latestRun = (entry: CiEntry) =>
  entry.runs.find((r) => r.head_branch === entry.defaultBranch) ?? entry.runs[0];
