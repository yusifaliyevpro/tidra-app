import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useJobs } from "@/app/queries";
import { useServices } from "@/app/services";
import { IconButton } from "@/ui/button";
import { TimeAgo } from "@/ui/time";
import { toastError } from "@/ui/toast";

/** Refresh button for a background job, showing when it last ran and spinning while it runs. */
export function JobRefresh({ jobId, label = "Refresh" }: { jobId: string; label?: string }) {
  const svc = useServices();
  const queryClient = useQueryClient();
  const { data: jobs } = useJobs();
  const state = jobs?.find((j) => j.id === jobId);
  const run = useMutation({
    mutationFn: async () => {
      await svc.scheduler.runNow(jobId);
      await queryClient.invalidateQueries();
    },
    onError: toastError,
  });
  const running = run.isPending || state?.running;
  return (
    <div className="flex items-center gap-2 text-sm">
      {state?.lastError ? (
        <span className="max-w-64 truncate text-bad" title={state.lastError}>
          {state.lastError}
        </span>
      ) : state?.lastRun ? (
        <span className="text-faint">
          Updated <TimeAgo value={state.lastRun} />
        </span>
      ) : null}
      <IconButton
        label={label}
        loading={running}
        icon={<RefreshCw className="size-4" />}
        onClick={() => run.mutate()}
      />
    </div>
  );
}
