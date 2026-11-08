import { useMutation } from "@tanstack/react-query";
import { ArrowDown } from "lucide-react";
import { useServices } from "@/app/services";
import type { ForkInfo, GitStatus } from "@/engine/git";
import { syncRepo } from "@/services/repos";
import { Button } from "@/ui/button";
import { toast, toastError } from "@/ui/toast";

/**
 * Takes commits waiting upstream (a fork's upstream, then origin), and pushes local ones on the way. Shown only when
 * something is coming in; commits that only go out are BranchActions' Push.
 */
export function SyncButton({
  projectId,
  git,
  fork,
  size = "sm",
}: {
  projectId: string;
  git: GitStatus | undefined;
  fork: ForkInfo | undefined;
  size?: "sm" | "md";
}) {
  const svc = useServices();
  const sync = useMutation({
    mutationFn: () => syncRepo(svc, projectId),
    onSuccess: (message) => toast(message),
    onError: toastError,
  });
  if (!git?.branch || !(git.upstream || fork)) return null;
  // Sync only takes upstream's commits on the branch they belong to; elsewhere this count could never clear.
  const upstream = fork?.ref?.replace(/^upstream\//, "") === git.branch ? (fork?.behind ?? 0) : 0;
  const incoming = git.behind + upstream;
  const outgoing = git.ahead;
  if (incoming === 0) return null;
  const title = [
    incoming > 0 ? `${incoming} to pull` : undefined,
    outgoing > 0 ? `${outgoing} to push` : undefined,
    upstream > 0 && fork ? `${upstream} new on ${fork.remote.replace(/^github\.com\//, "")}` : undefined,
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <Button
      size={size}
      title={`Sync: ${title}`}
      aria-label={`Sync, ${title}`}
      loading={sync.isPending}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        sync.mutate();
      }}
    >
      <ArrowDown className="size-3.5" />
      <span className="tabular">{incoming}</span>
      Sync
    </Button>
  );
}
