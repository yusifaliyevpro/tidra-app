import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "cn";
import { ArrowUpFromLine, ChevronDown, ExternalLink, GitCommitHorizontal, GitPullRequestArrow } from "lucide-react";
import { useServices } from "@/app/services";
import type { GitStatus } from "@/engine/git";
import {
  branchPull,
  commitAndPushProject,
  commitProject,
  hasUnpushed,
  isTidraBranch,
  openPullRequest,
  pushProject,
} from "@/services/pull-requests";
import { Button } from "@/ui/button";
import { openExternal } from "@/ui/external";
import { MenuItem, Popover } from "@/ui/popover";
import { Spinner } from "@/ui/spinner";
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
function branchState(git: GitStatus | undefined, allowCommit: boolean | undefined) {
  const branch = git?.branch;
  const updateBranch = isTidraBranch(branch);
  return {
    branch,
    updateBranch,
    featureBranch: Boolean(branch && git?.upstream && !["main", "master", "develop"].includes(branch)),
    // A tracked branch is pushed by Sync; Push is only for publishing a branch the first time.
    unpushed: hasUnpushed(git) && !git?.upstream,
    // An update stopped by its checks leaves its changes uncommitted; pushing alone would send nothing.
    canCommit: (git ? git.changed + git.untracked : 0) > 0 && (updateBranch || Boolean(allowCommit)),
  };
}

export function BranchActions({
  projectId,
  git,
  size,
  allowCommit,
}: {
  projectId: string;
  git: GitStatus | undefined;
  size?: Size;
  /** Offer Commit for uncommitted changes on any branch, not only Tidra's own (used right after a stopped update). */
  allowCommit?: boolean;
}) {
  const svc = useServices();
  const { branch, updateBranch, featureBranch, unpushed, canCommit } = branchState(git, allowCommit);
  const { data: pull } = useQuery({
    queryKey: ["branch-pull", projectId, branch],
    enabled: (updateBranch || featureBranch) && !svc.preview,
    staleTime: 60_000,
    queryFn: () => (branch ? branchPull(svc, projectId, branch) : { state: "none" as const }),
  });
  const open = pull?.state === "open" ? pull : undefined;
  if (!canCommit && !unpushed && !open && !(updateBranch && pull)) return null;
  return (
    <span className="flex gap-1.5">
      <LocalWork projectId={projectId} size={size} canCommit={canCommit} unpushed={unpushed} hasPull={Boolean(open)} />
      {open?.url ? (
        <PullLink url={open.url} number={open.number} title={open.title} size={size} />
      ) : updateBranch && pull ? (
        <OpenPullRequestButton projectId={projectId} size={size} />
      ) : null}
    </span>
  );
}

function LocalWork({
  projectId,
  size,
  canCommit,
  unpushed,
  hasPull,
}: {
  projectId: string;
  size: Size;
  canCommit: boolean;
  unpushed: boolean;
  hasPull: boolean;
}) {
  if (canCommit) return <CommitPushButton projectId={projectId} size={size} />;
  return unpushed ? <PushButton projectId={projectId} size={size} primary={hasPull} /> : null;
}

function PullLink({ url, number, title, size }: { url: string; number?: number; title?: string; size: Size }) {
  return (
    <Button
      size={size}
      variant="ghost"
      icon={<ExternalLink className={iconClass(size)} />}
      title={title}
      onClick={only(() => openExternal(url))}
    >
      #{number}
    </Button>
  );
}

type CommitAction = "commit-push" | "commit" | "push";

/** "Commit & Push" with a menu for doing just one of the two. */
function CommitPushButton({ projectId, size }: { projectId: string; size: Size }) {
  const svc = useServices();
  const queryClient = useQueryClient();
  const action = useMutation({
    mutationFn: async (kind: CommitAction) => {
      if (kind === "commit") return `Committed "${await commitProject(svc, projectId)}".`;
      if (kind === "push") return `Pushed ${await pushProject(svc, projectId)}.`;
      return commitAndPushProject(svc, projectId);
    },
    onSuccess: async (message) => {
      toast(message);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["branch-pull"] }),
        queryClient.invalidateQueries({ queryKey: ["runs", projectId] }),
      ]);
    },
    onError: toastError,
  });
  return (
    <span className="flex">
      <Button
        size={size}
        variant="primary"
        className="rounded-r-none"
        icon={<GitCommitHorizontal className={iconClass(size)} />}
        loading={action.isPending && action.variables === "commit-push"}
        disabled={action.isPending}
        onClick={only(() => action.mutate("commit-push"))}
      >
        Commit & Push
      </Button>
      <Popover
        align="end"
        className="w-40 p-1"
        renderTrigger={({ open, toggle }) => (
          <Button
            size={size}
            variant="primary"
            aria-label="More commit options"
            aria-expanded={open}
            disabled={action.isPending}
            className={cn("rounded-l-none border-l border-black/25 px-1.5", open && "brightness-110")}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              toggle(event);
            }}
          >
            {action.isPending && action.variables !== "commit-push" ? (
              <Spinner className="size-3.5" />
            ) : (
              <ChevronDown className={iconClass(size)} />
            )}
          </Button>
        )}
      >
        {(close) => (
          <>
            <MenuItem
              onSelect={() => {
                close();
                action.mutate("commit");
              }}
            >
              <GitCommitHorizontal className="size-3.5" />
              Commit
            </MenuItem>
            <MenuItem
              onSelect={() => {
                close();
                action.mutate("push");
              }}
            >
              <ArrowUpFromLine className="size-3.5" />
              Push
            </MenuItem>
          </>
        )}
      </Popover>
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
