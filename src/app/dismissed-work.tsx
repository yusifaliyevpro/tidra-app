import { cn } from "cn";
import { CircleCheck, CircleX, X } from "lucide-react";
import { lazy, Suspense, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
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

function WorkChip({ work, paused, onOpen }: { work: DismissedWork; paused: boolean; onOpen: () => void }) {
  const processes = useProcessList();
  const runState = useRunState(work.id, work.kind === "run");
  const proc = work.kind === "process" ? processes.find((p) => p.id === work.id) : undefined;
  const state: State =
    work.kind === "run" ? runState : proc?.running ? "running" : proc?.exitCode === 0 ? "ok" : "failed";
  useForgetWhenDone(work.id, state === "ok", paused);
  const label = chipLabel(work, state);
  return (
    <span className="pointer-events-auto flex h-6 max-w-full min-w-0 animate-pop-in items-center rounded-full bg-selected text-sm text-muted">
      <button
        type="button"
        title="Show output"
        onClick={onOpen}
        className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-l-full pr-1 pl-2.5 hover:text-fg"
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

/**
 * Dismissed output dialogs and the running job, as one centered pill: the newest shows, hovering expands the rest
 * below it. One at a time keeps the header symmetric whatever comes and goes.
 */
export function ActivityStack({ job }: { job?: ReactNode }) {
  const items = useSyncExternalStore(dismissedWork.subscribe, dismissedWork.snapshot);
  const [open, setOpen] = useState<DismissedWork>();
  const [hovered, setHovered] = useState(false);
  const entries = [
    ...items.toReversed().map((work) => ({
      key: work.id,
      node: <WorkChip work={work} paused={hovered} onOpen={() => setOpen(work)} />,
    })),
    ...(job ? [{ key: "job", node: job }] : []),
  ];
  const [first, ...rest] = entries;
  return (
    <>
      {first ? (
        <div
          onPointerEnter={() => setHovered(true)}
          onPointerLeave={() => setHovered(false)}
          className="group pointer-events-auto relative flex max-w-full min-w-0 justify-center"
        >
          <div key={first.key} className="relative flex max-w-full min-w-0 justify-center">
            {first.node}
            {rest.length > 0 ? (
              <span
                aria-label={`${rest.length} more`}
                className="absolute -top-1.5 -right-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full border border-line-strong bg-raised px-1 text-[10px] leading-none font-medium text-muted tabular"
              >
                {rest.length}
              </span>
            ) : null}
          </div>
          {rest.length > 0 ? <MoreActivity entries={rest} /> : null}
        </div>
      ) : null}
      {createPortal(<ReopenedDialog open={open} setOpen={setOpen} />, document.body)}
    </>
  );
}

/** The rest of the stack, unfolding below the pill on hover or keyboard focus; its top padding bridges the gap. */
function MoreActivity({ entries }: { entries: { key: string; node: ReactNode }[] }) {
  return (
    <div
      className={cn(
        "absolute top-full left-1/2 w-max max-w-[min(360px,80vw)] -translate-x-1/2 pt-1.5",
        "invisible origin-top -translate-y-1 scale-95 opacity-0 transition-[opacity,transform,visibility] duration-140 ease-out",
        "group-focus-within:visible group-focus-within:translate-y-0 group-focus-within:scale-100 group-focus-within:opacity-100",
        "group-hover:visible group-hover:translate-y-0 group-hover:scale-100 group-hover:opacity-100",
        "motion-reduce:transform-none",
      )}
    >
      <div className="flex flex-col gap-1 rounded-xl border border-line-strong bg-raised p-1 shadow-pop">
        {entries.map((entry) => (
          <div key={entry.key} className="flex min-w-0 *:w-full">
            {entry.node}
          </div>
        ))}
      </div>
    </div>
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
