import { useMutation } from "@tanstack/react-query";
import { Check, Circle, Code, ExternalLink as ExternalIcon, Minus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useServices } from "@/app/services";
import { UPDATE_STEPS, type UpdateResult, type UpdateStep } from "@/engine/apply";
import { revertRun, subscribeRun, type RunProgress } from "@/services/updates";
import { Button } from "@/ui/button";
import { Dialog } from "@/ui/dialog";
import { openExternal } from "@/ui/external";
import { ErrorNote } from "@/ui/layout";
import { Log } from "@/ui/log";
import { Spinner } from "@/ui/spinner";
import { toast, toastError } from "@/ui/toast";

const STEP_LABEL: Record<UpdateStep, string> = {
  preflight: "Check working tree",
  branch: "Create branch",
  write: "Write manifests",
  install: "Install",
  checks: "Run checks",
  commit: "Commit",
  push: "Push",
};

function StepIcon({ state }: { state: RunProgress["steps"][UpdateStep] }) {
  if (!state) return <Circle className="size-3.5 text-faint" />;
  if (state.state === "running") return <Spinner className="size-3.5 text-accent" />;
  if (state.state === "done") return <Check className="size-3.5 text-ok" />;
  if (state.state === "failed") return <X className="size-3.5 text-bad" />;
  return <Minus className="size-3.5 text-faint" />;
}

export function UpdateRunDialog({
  runId,
  projectId,
  path,
  onClose,
}: {
  runId: string | undefined;
  projectId: string;
  path?: string;
  onClose: () => void;
}) {
  const [progress, setProgress] = useState<RunProgress>();

  useEffect(() => (runId ? subscribeRun(runId, setProgress) : undefined), [runId]);

  const result = progress?.result;

  return (
    <Dialog
      open={Boolean(runId)}
      onClose={onClose}
      title={result ? (result.ok ? "Update finished" : "Update stopped") : "Updating…"}
      className="w-[760px]"
      footer={
        result ? (
          <RunActions
            result={result}
            pullRequestUrl={progress?.pullRequestUrl}
            projectId={projectId}
            path={path}
            onClose={onClose}
          />
        ) : (
          <Button variant="ghost" onClick={onClose}>
            Run in background
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-4">
        <ol className="grid grid-cols-4 gap-x-4 gap-y-2">
          {UPDATE_STEPS.map((step) => (
            <li key={step} className="flex items-center gap-2 text-sm">
              <StepIcon state={progress?.steps[step]} />
              <span className={progress?.steps[step]?.state === "skipped" ? "text-faint" : "text-fg"}>
                {STEP_LABEL[step]}
              </span>
            </li>
          ))}
        </ol>
        {result?.error ? <ErrorNote>{result.error}</ErrorNote> : null}
        {result?.ok && result.createdBranch ? (
          <p className="text-sm text-muted">
            Committed on <span className="font-mono text-fg">{result.createdBranch}</span>
            {result.commitSha ? <span className="font-mono"> ({result.commitSha.slice(0, 7)})</span> : null}.
          </p>
        ) : null}
        <Log text={progress?.log ?? ""} className="h-80" />
      </div>
    </Dialog>
  );
}

/** After a failed run: revert, open the editor, or keep the changes as they are. */
function RunActions({
  result,
  pullRequestUrl,
  projectId,
  path,
  onClose,
}: {
  result: UpdateResult;
  pullRequestUrl?: string;
  projectId: string;
  path?: string;
  onClose: () => void;
}) {
  const svc = useServices();
  const revert = useMutation({
    mutationFn: () => revertRun(svc, projectId, result),
    onSuccess: () => {
      toast("Changes reverted.");
      onClose();
    },
    onError: toastError,
  });
  const canRevert = !result.ok && !result.commitSha && result.failedStep !== "preflight";

  return (
    <>
      {canRevert ? (
        <Button variant="danger" loading={revert.isPending} onClick={() => revert.mutate()}>
          Revert changes
        </Button>
      ) : null}
      {!result.ok && path ? (
        <Button icon={<Code className="size-4" />} onClick={() => void svc.io.run("code", [path])}>
          Open in VS Code
        </Button>
      ) : null}
      {pullRequestUrl ? (
        <Button icon={<ExternalIcon className="size-4" />} onClick={() => openExternal(pullRequestUrl)}>
          Open pull request
        </Button>
      ) : null}
      <Button variant="primary" onClick={onClose}>
        {result.ok ? "Done" : "Keep changes"}
      </Button>
    </>
  );
}
