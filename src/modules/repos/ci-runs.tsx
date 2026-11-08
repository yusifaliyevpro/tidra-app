import { useMutation, useQuery } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import { useState } from "react";
import { useServices } from "@/app/services";
import { runFailed, type WorkflowRun } from "@/integrations/github";
import { latestRun, runTone } from "@/services/ci-status";
import { failedLog, refreshCi, type CiEntry } from "@/services/github-feed";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { Dialog } from "@/ui/dialog";
import { openExternal } from "@/ui/external";
import { ErrorNote } from "@/ui/layout";
import { Log } from "@/ui/log";
import { Spinner } from "@/ui/spinner";
import { TimeAgo } from "@/ui/time";
import { toast, toastError } from "@/ui/toast";

/** The latest default-branch run as a badge and its age; "No runs" when the repo has none. */
export function CiCell({ entry }: { entry: CiEntry | undefined }) {
  if (!entry) return <span className="text-sm text-ghost">—</span>;
  if (entry.error)
    return (
      <span className="text-sm text-bad" title={entry.error}>
        Could not check
      </span>
    );
  const run = latestRun(entry);
  if (!run) return <span className="text-sm text-faint">No runs</span>;
  const { tone, label } = runTone(run);
  return (
    <span className="flex items-center gap-2" title={run.display_title ?? run.name ?? undefined}>
      <Badge tone={tone}>{label}</Badge>
      <span className="text-sm text-faint">
        <TimeAgo value={run.created_at} />
      </span>
    </span>
  );
}

/** Recent runs with the failed log and a re-run for failures. */
export function CiRuns({ entry }: { entry: CiEntry }) {
  const svc = useServices();
  const [logFor, setLogFor] = useState<WorkflowRun>();
  const rerun = useMutation({
    mutationFn: async (run: WorkflowRun) => {
      await (await svc.github()).rerunFailed(entry.repo, run.id);
      await refreshCi(svc);
    },
    onSuccess: () => toast("Re-running failed jobs."),
    onError: toastError,
  });
  return (
    <div className="flex flex-col">
      {entry.error ? (
        <div className="py-2">
          <ErrorNote>{entry.error}</ErrorNote>
        </div>
      ) : null}
      {entry.runs.length === 0 && !entry.error ? <p className="py-2 text-sm text-faint">No runs</p> : null}
      {entry.runs.slice(0, 6).map((run) => {
        const tone = runTone(run);
        return (
          <div key={run.id} className="flex h-9 items-center gap-3 border-b border-line text-sm last:border-b-0">
            <Badge tone={tone.tone}>{tone.label}</Badge>
            <button
              type="button"
              className="min-w-0 flex-1 truncate text-left hover:underline"
              onClick={() => openExternal(run.html_url)}
            >
              {run.display_title ?? run.name}
            </button>
            <span className="truncate text-faint">{run.name}</span>
            <span className="font-mono text-xs text-faint">{run.head_branch}</span>
            <span className="w-16 text-right text-faint">
              <TimeAgo value={run.created_at} />
            </span>
            {runFailed(run) ? (
              <>
                <Button size="sm" onClick={() => setLogFor(run)}>
                  Log
                </Button>
                <Button
                  size="sm"
                  icon={<RotateCcw className="size-3.5" />}
                  loading={rerun.isPending && rerun.variables.id === run.id}
                  onClick={() => rerun.mutate(run)}
                >
                  Re-run
                </Button>
              </>
            ) : null}
          </div>
        );
      })}
      <FailedLogDialog repo={entry.repo} run={logFor} onClose={() => setLogFor(undefined)} />
    </div>
  );
}

function FailedLogDialog({ repo, run, onClose }: { repo: string; run?: WorkflowRun; onClose: () => void }) {
  const svc = useServices();
  const log = useQuery({
    queryKey: ["ci-log", repo, run?.id],
    enabled: Boolean(run),
    queryFn: () => (run ? failedLog(svc, repo, run.id) : undefined),
  });
  return (
    <Dialog
      open={Boolean(run)}
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
