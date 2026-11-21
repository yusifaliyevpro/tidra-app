import { CircleCheck, CircleX, X } from "lucide-react";
import { lazy, Suspense, useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { dismissedWork, type DismissedWork } from "@/services/dismissed";
import { subscribeRun } from "@/services/updates";
import { Spinner } from "@/ui/spinner";
import { useProcessList } from "./queries";

// The dialogs load when one is reopened, not with the header.
const UpdateRunDialog = lazy(() =>
  import("@/modules/projects/update-run").then((m) => ({ default: m.UpdateRunDialog })),
);
const ProcessDialog = lazy(() => import("@/modules/process-dialog").then((m) => ({ default: m.ProcessDialog })));

type State = "running" | "ok" | "failed";

function useRunState(id: string, enabled: boolean): State {
  const [state, setState] = useState<State>("running");
  useEffect(
    () =>
      enabled ? subscribeRun(id, (p) => setState(p.result ? (p.result.ok ? "ok" : "failed") : "running")) : undefined,
    [id, enabled],
  );
  return state;
}

/** A finished chip stays this long (paused while hovered), then leaves; a failed one stays until closed. */
export const DONE_CHIP_MS = 6000;

export function chipLabel(work: DismissedWork, state: State): string {
  if (work.kind === "process") return work.label;
  const name = work.name ? ` ${work.name}` : "";
  if (state === "running") return `Updating${name}`;
  return state === "ok" ? `Updated${name}` : `Update failed${name ? `:${name}` : ""}`;
}

function useForgetWhenDone(id: string, done: boolean, paused: boolean) {
  useEffect(() => {
    if (!done || paused) return undefined;
    const timer = setTimeout(() => dismissedWork.remove(id), DONE_CHIP_MS);
    return () => clearTimeout(timer);
  }, [id, done, paused]);
}

function WorkChip({ work, onOpen }: { work: DismissedWork; onOpen: () => void }) {
  const processes = useProcessList();
  const runState = useRunState(work.id, work.kind === "run");
  const [hovered, setHovered] = useState(false);
  const proc = work.kind === "process" ? processes.find((p) => p.id === work.id) : undefined;
  const state: State =
    work.kind === "run" ? runState : proc?.running ? "running" : proc?.exitCode === 0 ? "ok" : "failed";
  useForgetWhenDone(work.id, state === "ok", hovered);
  const label = chipLabel(work, state);
  return (
    <span
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      className="pointer-events-auto flex h-6 min-w-0 shrink animate-pop-in items-center rounded-full bg-selected text-sm text-muted"
    >
      <button
        type="button"
        title="Show output"
        onClick={onOpen}
        className="flex h-full min-w-0 items-center gap-2 rounded-l-full pr-1 pl-2.5 hover:text-fg"
      >
        {state === "running" ? (
          <Spinner className="size-3 shrink-0" />
        ) : state === "ok" ? (
          <CircleCheck className="size-3.5 shrink-0 text-ok" />
        ) : (
          <CircleX className="size-3.5 shrink-0 text-bad" />
        )}
        <span className="truncate">{label}</span>
      </button>
      <button
        type="button"
        aria-label={`Forget ${label}`}
        onClick={() => dismissedWork.remove(work.id)}
        className="flex size-6 shrink-0 items-center justify-center rounded-r-full hover:text-fg"
      >
        <X className="size-3" />
      </button>
    </span>
  );
}

/** Output dialogs closed while their work ran, as chips that bring them back from any screen. */
export function DismissedWorkChips() {
  const items = useSyncExternalStore(dismissedWork.subscribe, dismissedWork.snapshot);
  const [open, setOpen] = useState<DismissedWork>();
  return (
    <>
      {items.map((work) => (
        <WorkChip key={work.id} work={work} onOpen={() => setOpen(work)} />
      ))}
      {createPortal(<ReopenedDialog open={open} setOpen={setOpen} />, document.body)}
    </>
  );
}

/** Portaled out of the header, whose pointer-events: none would otherwise let every click in the dialog through. */
function ReopenedDialog({
  open,
  setOpen,
}: {
  open: DismissedWork | undefined;
  setOpen: (work?: DismissedWork) => void;
}) {
  return (
    <Suspense fallback={null}>
      {open?.kind === "run" ? (
        <UpdateRunDialog
          runId={open.id}
          projectId={open.projectId}
          path={open.path}
          name={open.name}
          onClose={() => setOpen(undefined)}
        />
      ) : null}
      {open?.kind === "process" ? (
        <ProcessDialog
          processId={open.id}
          onClose={() => setOpen(undefined)}
          onRestarted={(id) => setOpen({ kind: "process", id, label: open.label })}
        />
      ) : null}
    </Suspense>
  );
}
