import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "cn";
import {
  ArrowUpFromLine,
  ChevronDown,
  ExternalLink,
  GitBranchPlus,
  GitCommitHorizontal,
  GitPullRequestArrow,
} from "lucide-react";
import { useState } from "react";
import { useServices } from "@/app/services";
import type { GitStatus } from "@/engine/git";
import {
  branchPull,
  commitAndPushProject,
  commitProject,
  commitToNewBranch,
  hasUnpushed,
  isTidraBranch,
  openPullRequest,
  pushProject,
} from "@/services/pull-requests";
import { branchName } from "@/services/updates";
import { Button } from "@/ui/button";
import { Dialog } from "@/ui/dialog";
import { openExternal } from "@/ui/external";
import { Field, Input } from "@/ui/field";
import { MenuItem, MenuSeparator, Popover } from "@/ui/popover";
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

const DEFAULT_BRANCHES = ["main", "master", "develop"];

/**
 * What can be done with the current branch, without leaving Tidra: commit and push, push unpushed commits, open a pull
 * request from any branch other than the default one, and once one is open, link to it.
 */
function branchState(git: GitStatus | undefined, allowCommit: boolean | undefined) {
  const branch = git?.branch;
  const updateBranch = isTidraBranch(branch);
  return {
    branch,
    updateBranch,
    featureBranch: Boolean(branch && !DEFAULT_BRANCHES.includes(branch)),
    // With commits coming in too, Sync pulls first and then pushes.
    unpushed: hasUnpushed(git) && (git?.behind ?? 0) === 0,
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
  const { branch, featureBranch, unpushed, canCommit } = branchState(git, allowCommit);
  const { data: pull } = useQuery({
    queryKey: ["branch-pull", projectId, branch],
    enabled: featureBranch && !svc.preview,
    staleTime: 60_000,
    queryFn: () => (branch ? branchPull(svc, projectId, branch) : { state: "none" as const }),
  });
  const open = pull?.state === "open" ? pull : undefined;
  // Open PR only off the default branch, with commits to propose, once its pull request is known not to exist yet.
  const canOpenPull = featureBranch && pull?.state === "none" && (pull.commits ?? 0) > 0;
  if (!canCommit && !unpushed && !open && !canOpenPull) return null;
  return (
    <span className="flex gap-1.5">
      <LocalWork projectId={projectId} size={size} canCommit={canCommit} unpushed={unpushed} hasPull={Boolean(open)} />
      {open?.url ? (
        <PullLink url={open.url} number={open.number} title={open.title} size={size} />
      ) : canOpenPull ? (
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

/** "Commit & Push" with a menu for doing just one of the two, or for taking the work to a new branch first. */
function CommitPushButton({ projectId, size }: { projectId: string; size: Size }) {
  const svc = useServices();
  const queryClient = useQueryClient();
  const [branching, setBranching] = useState(false);
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
        className="w-56 p-1"
        renderTrigger={({ open, toggle }) => (
          <Button
            size={size}
            variant="primary"
            aria-label="More commit options"
            aria-expanded={open}
            disabled={action.isPending}
            className={cn("ml-px rounded-l-none px-1.5", open && "bg-accent-hover")}
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
            <MenuSeparator />
            <MenuItem
              onSelect={() => {
                close();
                setBranching(true);
              }}
            >
              <GitBranchPlus className="size-3.5" />
              Commit to new branch…
            </MenuItem>
          </>
        )}
      </Popover>
      {branching ? <NewBranchDialog projectId={projectId} onClose={() => setBranching(false)} /> : null}
    </span>
  );
}

/** Names the branch the uncommitted work moves to; committing and pushing it there makes Open PR the next step. */
function NewBranchDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const svc = useServices();
  const queryClient = useQueryClient();
  const [name, setName] = useState(() => branchName());
  const commit = useMutation({
    mutationFn: () => commitToNewBranch(svc, projectId, name),
    onSuccess: async (message) => {
      toast(message);
      onClose();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["branch-pull"] }),
        queryClient.invalidateQueries({ queryKey: ["runs", projectId] }),
      ]);
    },
    onError: toastError,
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title="Commit to a new branch"
      className="w-[440px]"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={commit.isPending} disabled={!name.trim()} onClick={() => commit.mutate()}>
            Commit & Push
          </Button>
        </>
      }
    >
      <Field label="Branch">
        {(id) => (
          <Input
            id={id}
            value={name}
            // oxlint-disable-next-line jsx-a11y/no-autofocus -- a modal's first focus; otherwise Enter lands on Close
            autoFocus
            className="font-mono"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && name.trim() && commit.mutate()}
          />
        )}
      </Field>
    </Dialog>
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
