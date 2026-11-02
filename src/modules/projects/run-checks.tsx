import { useMutation } from "@tanstack/react-query";
import { ListChecks } from "lucide-react";
import { useState } from "react";
import { useApp } from "@/app/services";
import { ProcessDialog } from "@/modules/process-dialog";
import { checkCommands } from "@/services/projects";
import { Button } from "@/ui/button";
import { toastError } from "@/ui/toast";

/** Runs the project's checks again (say, after fixing what an update broke), with live output in a dialog. */
export function RunChecksButton({ projectId }: { projectId: string }) {
  const { svc, processes } = useApp();
  const [shown, setShown] = useState<string>();
  const start = useMutation({
    mutationFn: async () => {
      const { cwd, commands } = await checkCommands(svc, projectId);
      const [first, ...rest] = commands;
      if (!first) throw new Error("This project has no checks. Add check commands in the project's settings.");
      return processes.start({ label: "Checks", command: first, next: rest, cwd, projectId });
    },
    onSuccess: setShown,
    onError: toastError,
  });
  return (
    <>
      <Button icon={<ListChecks className="size-4" />} loading={start.isPending} onClick={() => start.mutate()}>
        Run checks
      </Button>
      <ProcessDialog processId={shown} onClose={() => setShown(undefined)} onRestarted={setShown} />
    </>
  );
}
