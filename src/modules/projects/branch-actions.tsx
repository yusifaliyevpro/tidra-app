import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpFromLine, ExternalLink, GitPullRequestArrow } from "lucide-react";
import { useServices } from "@/app/services";
import type { GitStatus } from "@/engine/git";
import { branchPull, hasUnpushed, isUpdateBranch, openPullRequest, pushProject } from "@/services/pull-requests";
import { Button } from "@/ui/button";
import { openExternal } from "@/ui/external";
import { toast, toastError } from "@/ui/toast";

type Size = "sm" | undefined;

const iconClass = (size: Size) => (size === "sm" ? "size-3.5" : "size-4");

/** Stops a click inside a row link from also opening the row. */
const only = (action: () => void) => (event: { preventDefault(): void; stopPropagation(): void }) => {
  event.preventDefault();
  event.stopPropagation();
  action();
};

/**
 * What can be done with the current branch, without leaving Tidra: push unpushed commits, open its pull request,
 * and once one is open, link to it.
 */
export function BranchActions({
  projectId,
  git,
  size,
}: {
  projectId: string;
  git: GitStatus | undefined;
  size?: Size;
}) {
  const svc = useServices();
  const branch = git?.branch;
  const updateBranch = isUpdateBranch(branch);
  const featureBranch = Boolean(branch && git?.upstream && !["main", "master", "develop"].includes(branch));
  const { data: pull } = useQuery({
    queryKey: ["branch-pull", projectId, branch],
    enabled: (updateBranch || featureBranch) && !svc.preview,
    staleTime: 60_000,
    queryFn: () => (branch ? branchPull(svc, projectId, branch) : { state: "none" as const }),
  });
  // A tracked branch is pushed by Sync; Push is only for publishing a branch the first time.
  const unpushed = hasUnpushed(git) && !git?.upstream;
  const open = pull?.state === "open" ? pull : undefined;
  if (!unpushed && !open && !(updateBranch && pull)) return null;
  return (
    <span className="flex gap-1.5">
      {unpushed ? <PushButton projectId={projectId} size={size} primary={Boolean(open)} /> : null}
      {open?.url ? (
        <>
          <Button
            size={size}
            variant="ghost"
            icon={<ExternalLink className={iconClass(size)} />}
            title={open.title}
            onClick={only(() => open.url && openExternal(open.url))}
          >
            #{open.number}
          </Button>
        </>
      ) : updateBranch && pull ? (
        <OpenPullRequestButton projectId={projectId} size={size} />
      ) : null}
    </span>
  );
}

/** Pushes the branch and creates its pull request (or refreshes the open one's description). */
function OpenPullRequestButton({ projectId, size }: { projectId: string; size: Size }) {
  const svc = useServices();
  const queryClient = useQueryClient();
  const open = useMutation({
    mutationFn: () => openPullRequest(svc, projectId),
    onSuccess: async ({ created }) => {
      toast(created ? "Pull request opened." : "Pull request updated.");
      await queryClient.invalidateQueries({ queryKey: ["branch-pull"] });
    },
    onError: toastError,
  });
  return (
    <Button
      size={size}
      variant="primary"
      icon={<GitPullRequestArrow className={iconClass(size)} />}
      loading={open.isPending}
      onClick={only(() => open.mutate())}
    >
      Open PR
    </Button>
  );
}

/** Pushes the current branch, whatever the project's push setting says; an open PR picks the commits up. */
function PushButton({ projectId, size, primary }: { projectId: string; size: Size; primary: boolean }) {
  const svc = useServices();
  const queryClient = useQueryClient();
  const push = useMutation({
    mutationFn: () => pushProject(svc, projectId),
    onSuccess: async (branch) => {
      toast(`Pushed ${branch}.`);
      await queryClient.invalidateQueries({ queryKey: ["branch-pull"] });
    },
    onError: toastError,
  });
  return (
    <Button
      size={size}
      variant={primary ? "primary" : undefined}
      icon={<ArrowUpFromLine className={iconClass(size)} />}
      loading={push.isPending}
      onClick={only(() => push.mutate())}
    >
      Push
    </Button>
  );
}
