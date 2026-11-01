import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { cn } from "cn";
import { Activity, ChevronRight, RotateCcw } from "lucide-react";
import { useState } from "react";
import { useCi } from "@/app/queries";
import { useServices } from "@/app/services";
import type { WorkflowRun } from "@/integrations/github";
import { JobRefresh } from "@/modules/common";
import { failedLog, refreshCi } from "@/services/github-feed";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { Dialog } from "@/ui/dialog";
import { openExternal } from "@/ui/external";
import { Empty, ErrorNote, Page } from "@/ui/layout";
import { Log } from "@/ui/log";
import { Spinner } from "@/ui/spinner";
import { TimeAgo } from "@/ui/time";
import { toast, toastError } from "@/ui/toast";
import type { Tone } from "@/ui/tone";

export const Route = createFileRoute("/ci")({ component: Ci });

function runTone(run: WorkflowRun): { tone: Tone; label: string } {
  if (run.status !== "completed") return { tone: "warn", label: run.status ?? "queued" };
  if (run.conclusion === "success") return { tone: "ok", label: "passed" };
  if (run.conclusion === "failure") return { tone: "bad", label: "failed" };
  return { tone: "neutral", label: run.conclusion ?? "done" };
}

function Ci() {
  const svc = useServices();
  const { data } = useCi();
  const [logFor, setLogFor] = useState<{ repo: string; run: WorkflowRun }>();
  const rerun = useMutation({
    mutationFn: async ({ repo, run }: { repo: string; run: WorkflowRun }) => {
      await (await svc.github()).rerunFailed(repo, run.id);
      await refreshCi(svc);
    },
    onSuccess: () => toast("Re-running failed jobs."),
    onError: toastError,
  });

  const entries = (data?.entries ?? []).toSorted((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  const active = entries.filter((e) => e.runs.length > 0 || e.error);
  const idle = entries.filter((e) => e.runs.length === 0 && !e.error);
  return (
    <Page title="CI" subtitle="GitHub Actions" actions={<JobRefresh jobId="ci" />}>
      {entries.length === 0 ? (
        <Empty icon={<Activity />} title="No GitHub projects" />
      ) : (
        <div className="mx-auto flex max-w-5xl flex-col gap-3 p-5">
          <div className="overflow-hidden rounded-lg border border-line bg-surface">
            {active.map((entry) => (
              <RepoRuns
                key={entry.repo}
                entry={entry}
                onLog={(run) => setLogFor({ repo: entry.repo, run })}
                onRerun={(run) => rerun.mutate({ repo: entry.repo, run })}
                rerunning={rerun.isPending ? rerun.variables.run.id : undefined}
              />
            ))}
          </div>
          {idle.length > 0 ? (
            <p className="px-1 text-xs text-faint">No runs yet: {idle.map((e) => e.name).join(", ")}</p>
          ) : null}
        </div>
      )}
      <FailedLogDialog target={logFor} onClose={() => setLogFor(undefined)} />
    </Page>
  );
}

type Entry = NonNullable<ReturnType<typeof useCi>["data"]>["entries"][number];

const latestOf = (entry: Entry) => entry.runs.find((r) => r.head_branch === entry.defaultBranch) ?? entry.runs[0];
/** Failing first, then running, then the rest. */
function rank(entry: Entry) {
  const run = latestOf(entry);
  if (entry.error || run?.conclusion === "failure") return 0;
  if (run && run.status !== "completed") return 1;
  return run ? 2 : 3;
}

function RepoRuns({
  entry,
  onLog,
  onRerun,
  rerunning,
}: {
  entry: Entry;
  onLog: (run: WorkflowRun) => void;
  onRerun: (run: WorkflowRun) => void;
  rerunning: number | undefined;
}) {
  const [open, setOpen] = useState(false);
  const latest = latestOf(entry);
  const status = latest ? runTone(latest) : undefined;
  return (
    <div className="border-b border-line last:border-b-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex h-12 w-full items-center gap-3 px-3 text-left hover:bg-hover"
      >
        <ChevronRight className={cn("size-4 shrink-0 text-faint transition-transform", open && "rotate-90")} />
        {status ? <Badge tone={status.tone}>{status.label}</Badge> : null}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-medium">{entry.name}</span>
          <span className="truncate text-xs text-faint">
            {entry.error ?? (latest ? `${latest.name ?? "Workflow"} · ${latest.display_title ?? ""}` : entry.repo)}
          </span>
        </span>
        <span className="shrink-0 font-mono text-xs text-faint">{latest?.head_branch}</span>
        <span className="w-20 shrink-0 text-right text-xs">
          <TimeAgo value={latest?.created_at} />
        </span>
      </button>
      {open ? (
        <div className="border-t border-line bg-bg/40">
          {entry.error ? (
            <div className="p-3">
              <ErrorNote>{entry.error}</ErrorNote>
            </div>
          ) : null}
          {entry.runs.slice(0, 8).map((run) => {
            const tone = runTone(run);
            return (
              <div
                key={run.id}
                className="flex h-10 items-center gap-3 border-b border-line pr-4 pl-10 text-sm last:border-b-0"
              >
                <Badge tone={tone.tone}>{tone.label}</Badge>
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left hover:underline"
                  onClick={() => openExternal(run.html_url)}
                >
                  {run.display_title ?? run.name}
                </button>
                <span className="text-faint">{run.name}</span>
                <span className="font-mono text-xs text-faint">{run.head_branch}</span>
                <span className="w-20 text-right text-xs">
                  <TimeAgo value={run.created_at} />
                </span>
                {run.conclusion === "failure" ? (
                  <>
                    <Button size="sm" onClick={() => onLog(run)}>
                      Log
                    </Button>
                    <Button
                      size="sm"
                      icon={<RotateCcw className="size-3.5" />}
                      loading={rerunning === run.id}
                      onClick={() => onRerun(run)}
                    >
                      Re-run
                    </Button>
                  </>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function FailedLogDialog({ target, onClose }: { target?: { repo: string; run: WorkflowRun }; onClose: () => void }) {
  const svc = useServices();
  const log = useQuery({
    queryKey: ["ci-log", target?.repo, target?.run.id],
    enabled: Boolean(target),
    queryFn: () => (target ? failedLog(svc, target.repo, target.run.id) : undefined),
  });
  return (
    <Dialog
      open={Boolean(target)}
      onClose={onClose}
      title={log.data ? `Failed job: ${log.data.job}` : "Failed job"}
      className="w-[880px]"
    >
      {log.isPending ? (
        <div className="flex justify-center p-8">
          <Spinner />
        </div>
      ) : log.error ? (
        <ErrorNote>{log.error.message}</ErrorNote>
      ) : (
        <Log text={log.data?.log ?? ""} className="h-[60vh]" />
      )}
    </Dialog>
  );
}
