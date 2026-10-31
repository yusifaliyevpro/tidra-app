import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Activity, RotateCcw } from "lucide-react";
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
import { Card, Empty, ErrorNote, Page } from "@/ui/layout";
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

  const entries = data?.entries ?? [];
  return (
    <Page title="CI" subtitle="GitHub Actions" actions={<JobRefresh jobId="ci" />}>
      {entries.length === 0 ? (
        <Empty icon={<Activity />} title="No GitHub projects" />
      ) : (
        <div className="mx-auto flex max-w-5xl flex-col gap-4 p-5">
          {entries.map((entry) => (
            <Card key={entry.repo}>
              <div className="flex h-10 items-center gap-2.5 border-b border-line px-4">
                <span className="font-medium">{entry.name}</span>
                <span className="text-sm text-faint">{entry.repo}</span>
              </div>
              {entry.error ? (
                <div className="p-3">
                  <ErrorNote>{entry.error}</ErrorNote>
                </div>
              ) : null}
              {entry.runs.slice(0, 5).map((run) => {
                const status = runTone(run);
                return (
                  <div
                    key={run.id}
                    className="flex h-10 items-center gap-3 border-b border-line px-4 text-sm last:border-b-0 hover:bg-hover"
                  >
                    <Badge tone={status.tone}>{status.label}</Badge>
                    <button
                      type="button"
                      className="min-w-0 flex-1 truncate text-left"
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
                        <Button size="sm" onClick={() => setLogFor({ repo: entry.repo, run })}>
                          Log
                        </Button>
                        <Button
                          size="sm"
                          icon={<RotateCcw className="size-3.5" />}
                          loading={rerun.isPending && rerun.variables?.run.id === run.id}
                          onClick={() => rerun.mutate({ repo: entry.repo, run })}
                        >
                          Re-run
                        </Button>
                      </>
                    ) : null}
                  </div>
                );
              })}
            </Card>
          ))}
        </div>
      )}
      <FailedLogDialog target={logFor} onClose={() => setLogFor(undefined)} />
    </Page>
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
