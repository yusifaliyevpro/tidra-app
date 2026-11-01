import { RotateCcw, Square } from "lucide-react";
import { useSyncExternalStore } from "react";
import { useApp } from "@/app/services";
import { display } from "@/engine/pm";
import type { ManagedProcess } from "@/services/processes";
import { Button } from "@/ui/button";
import { Dialog } from "@/ui/dialog";
import { Log } from "@/ui/log";

export function useProcessList(): ManagedProcess[] {
  const { processes } = useApp();
  return useSyncExternalStore(
    (listener) => processes.subscribe(listener),
    () => processes.snapshot(),
  );
}

/** Live output of a started script, right where it was started. Closing keeps it running; Stop ends it. */
export function ProcessDialog({
  processId,
  onClose,
  onRestarted,
}: {
  processId: string | undefined;
  onClose: () => void;
  onRestarted: (id: string) => void;
}) {
  const list = useProcessList();
  const proc = list.find((p) => p.id === processId);
  return (
    <Dialog
      open={Boolean(processId)}
      onClose={onClose}
      title={proc?.label ?? "Script"}
      className="w-[860px]"
      footer={proc ? <ProcessActions proc={proc} onClose={onClose} onRestarted={onRestarted} /> : null}
    >
      <div className="flex flex-col gap-2">
        {proc ? <ProcessState proc={proc} /> : null}
        <Log text={proc?.output ?? ""} className="h-[55vh]" />
      </div>
    </Dialog>
  );
}

function ProcessState({ proc }: { proc: ManagedProcess }) {
  if (proc.running) return <span className="text-sm text-ok">Running</span>;
  if (proc.exitCode === 0) return <span className="text-sm text-muted">Finished</span>;
  return <span className="text-sm text-bad">Exited {proc.exitCode ?? "(stopped)"}</span>;
}

function ProcessActions({
  proc,
  onClose,
  onRestarted,
}: {
  proc: ManagedProcess;
  onClose: () => void;
  onRestarted: (id: string) => void;
}) {
  const { processes } = useApp();
  const restart = () =>
    onRestarted(
      processes.start({ label: proc.label, command: proc.command, cwd: proc.cwd, projectId: proc.projectId }),
    );
  return (
    <>
      <span className="mr-auto self-center font-mono text-xs text-faint">{display(proc.command)}</span>
      {proc.running ? (
        <Button icon={<Square className="size-3.5" />} onClick={() => processes.stop(proc.id)}>
          Stop
        </Button>
      ) : (
        <Button icon={<RotateCcw className="size-3.5" />} onClick={restart}>
          Run again
        </Button>
      )}
      <Button variant="primary" onClick={onClose}>
        {proc.running ? "Keep running" : "Close"}
      </Button>
    </>
  );
}
