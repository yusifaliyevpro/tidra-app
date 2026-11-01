import { useMutation } from "@tanstack/react-query";
import { cn } from "cn";
import { Check, ChevronRight, CircleCheck, CircleX, ExternalLink as ExternalIcon, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useReport } from "@/app/queries";
import { useServices } from "@/app/services";
import { UPDATE_STEPS, type UpdateResult, type UpdateStep } from "@/engine/apply";
import { revertRun, subscribeRun, type RunProgress } from "@/services/updates";
import { Button } from "@/ui/button";
import { Dialog } from "@/ui/dialog";
import { openExternal, openInVsCode } from "@/ui/external";
import { Log } from "@/ui/log";
import { Spinner } from "@/ui/spinner";
import { toast, toastError } from "@/ui/toast";
import { VsCodeIcon } from "@/ui/vscode-icon";
import { BranchActions } from "./branch-actions";

const STEP_LABEL: Record<UpdateStep, string> = {
  preflight: "Check tree",
  branch: "Branch",
  write: "Edit",
  install: "Install",
  checks: "Checks",
  commit: "Commit",
  push: "Push",
};

type StepState = RunProgress["steps"][UpdateStep];

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
      title="Update"
      className="w-[820px]"
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
      <div className="flex flex-col gap-5">
        <StatusHeader progress={progress} />
        <Stepper steps={progress?.steps ?? {}} />
        {result && !result.ok ? <Failure result={result} /> : null}
        <Output log={progress?.log ?? ""} defaultOpen={!result?.ok} key={result ? "done" : "running"} />
      </div>
    </Dialog>
  );
}

function StatusHeader({ progress }: { progress: RunProgress | undefined }) {
  const result = progress?.result;
  const branch = result?.createdBranch ?? result?.previousBranch;
  if (!result) {
    const running = UPDATE_STEPS.find((step) => progress?.steps[step]?.state === "running");
    return (
      <div className="flex items-center gap-3">
        <Spinner className="size-5 text-accent" />
        <div className="flex flex-col">
          <span className="text-lg font-medium">Updating</span>
          <span className="text-sm text-muted">{running ? STEP_LABEL[running] : "Starting"}…</span>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3">
      {result.ok ? <CircleCheck className="size-6 text-ok" /> : <CircleX className="size-6 text-bad" />}
      <div className="flex min-w-0 flex-col">
        <span className="text-lg font-medium">
          {result.ok ? "Updated" : `Stopped at ${STEP_LABEL[result.failedStep ?? "preflight"].toLowerCase()}`}
        </span>
        <span className="truncate text-sm text-muted">
          {result.ok
            ? `Committed${result.pushed ? " and pushed" : ""} on `
            : result.failedStep === "preflight"
              ? "Nothing was changed. "
              : "Changes are left in "}
          {branch && result.failedStep !== "preflight" ? <span className="font-mono text-fg">{branch}</span> : null}
          {result.commitSha ? <span className="font-mono"> · {result.commitSha.slice(0, 7)}</span> : null}
        </span>
      </div>
    </div>
  );
}

/** The seven steps on one line, joined so progress reads left to right. */
function Stepper({ steps }: { steps: RunProgress["steps"] }) {
  return (
    <ol className="flex items-start">
      {UPDATE_STEPS.map((step, index) => {
        const state = steps[step];
        return (
          <li key={step} className="flex flex-1 flex-col items-center gap-1.5">
            <div className="flex w-full items-center">
              <span
                className={cn(
                  "h-px flex-1",
                  index === 0 ? "bg-transparent" : lineColor(steps[UPDATE_STEPS[index - 1] ?? step]),
                )}
              />
              <StepDot state={state} />
              <span
                className={cn("h-px flex-1", index === UPDATE_STEPS.length - 1 ? "bg-transparent" : lineColor(state))}
              />
            </div>
            <span
              title={state?.detail}
              className={cn(
                "text-xs",
                state?.state === "failed"
                  ? "text-bad"
                  : state?.state === "skipped" || !state
                    ? "text-faint"
                    : "text-fg",
              )}
            >
              {STEP_LABEL[step]}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

const lineColor = (state: StepState) => (state?.state === "done" ? "bg-ok/50" : "bg-line-strong");

function StepDot({ state }: { state: StepState }) {
  const base = "flex size-6 shrink-0 items-center justify-center rounded-full border";
  if (state?.state === "running")
    return (
      <span className={cn(base, "border-accent/60 bg-accent/10")}>
        <Spinner className="size-3 text-accent" />
      </span>
    );
  if (state?.state === "done")
    return (
      <span className={cn(base, "border-ok/40 bg-ok/10 text-ok")}>
        <Check className="size-3.5" />
      </span>
    );
  if (state?.state === "failed")
    return (
      <span className={cn(base, "border-bad/50 bg-bad/10 text-bad")}>
        <X className="size-3.5" />
      </span>
    );
  return <span className={cn(base, "border-line-strong", state?.state === "skipped" && "border-dashed")} />;
}

const NEXT_STEP: Partial<Record<UpdateStep, string>> = {
  checks: "Fix what failed in your editor, then Commit & Push. Or revert to undo the update.",
  install: "The package manager could not install the new versions. Revert, or fix it and Commit & Push.",
  preflight: "Commit or stash your local changes, then run the update again.",
  push: "The commit is saved locally. Push again once the remote accepts it.",
};

function Failure({ result }: { result: UpdateResult }) {
  const next = result.failedStep ? NEXT_STEP[result.failedStep] : undefined;
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-bad/25 bg-bad/5 px-3 py-2.5">
      {result.error ? (
        <p className="line-clamp-3 font-mono text-sm text-bad" data-selectable>
          {result.error}
        </p>
      ) : null}
      {next ? <p className="text-sm text-muted">{next}</p> : null}
    </div>
  );
}

function Output({ log, defaultOpen }: { log: string; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 self-start text-sm text-muted hover:text-fg"
      >
        <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
        Output
      </button>
      {open ? <Log text={log} className="h-72" /> : null}
    </div>
  );
}

/** After a run: revert or fix and commit when it stopped, push and open a PR when it finished. */
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
  const { data: report } = useReport(projectId);
  const canRevert = !result.ok && !result.commitSha && result.failedStep !== "preflight";

  return (
    <>
      {canRevert ? (
        <Button variant="danger" className="mr-auto" loading={revert.isPending} onClick={() => revert.mutate()}>
          Revert changes
        </Button>
      ) : null}
      {!result.ok && path ? (
        <Button icon={<VsCodeIcon className="size-3.5" />} onClick={() => openInVsCode(svc.io, path)}>
          Open in VS Code
        </Button>
      ) : null}
      {pullRequestUrl ? (
        <Button icon={<ExternalIcon className="size-4" />} onClick={() => openExternal(pullRequestUrl)}>
          View PR
        </Button>
      ) : (
        <BranchActions projectId={projectId} git={report?.git} allowCommit={canRevert} />
      )}
      <Button variant={result.ok ? "primary" : "secondary"} onClick={onClose}>
        {result.ok ? "Done" : "Close"}
      </Button>
    </>
  );
}
