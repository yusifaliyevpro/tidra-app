import { useMutation } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import * as z from "@zod/mini";
import { ArrowDown, ArrowUp, Download, FolderOpen, GitFork } from "lucide-react";
import type { MouseEvent } from "react";
import { useFreshGit, useRepos } from "@/app/queries";
import { useServices } from "@/app/services";
import { inTauri } from "@/core/native";
import type { GitStatus } from "@/engine/git";
import { createLimit } from "@/engine/limit";
import { BranchMenu } from "@/modules/projects/branch-menu";
import { BranchesDialog } from "@/modules/projects/branches-dialog";
import { runRepoAction, type RepoAction, type RepoGroup } from "@/services/repos";
import { Button, IconButton } from "@/ui/button";
import { openExternal, openFolder, openInVsCode } from "@/ui/external";
import { Empty, Page } from "@/ui/layout";
import { toast, toastError } from "@/ui/toast";
import { VsCodeIcon } from "@/ui/vscode-icon";

export const Route = createFileRoute("/git")({
  validateSearch: z.object({ repo: z.optional(z.string()) }),
  component: GitOverview,
});

function GitOverview() {
  const svc = useServices();
  useFreshGit();
  const { data: groups } = useRepos();
  const repos = (groups ?? []).filter((repo) => repo.report?.git);
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const openRepo = (key: string | undefined) => void navigate({ search: { repo: key }, replace: true });
  const opened = repos.find((repo) => repo.key === search.repo);
  const fetchAll = useMutation({
    mutationFn: async () => {
      const limit = createLimit(4);
      await Promise.all(repos.map((repo) => limit(() => runRepoAction(svc, repo, "fetch").catch(() => undefined))));
    },
    onSuccess: () => toast(`Fetched ${repos.length} ${repos.length === 1 ? "repository" : "repositories"}.`),
    onError: toastError,
  });

  return (
    <Page
      title="Git overview"
      actions={
        <Button icon={<Download className="size-4" />} loading={fetchAll.isPending} onClick={() => fetchAll.mutate()}>
          Fetch all
        </Button>
      }
    >
      {repos.length === 0 ? (
        <Empty title="No git repositories" />
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-bg text-xs text-faint">
            <tr className="h-8 border-b border-line">
              <th className="pl-5 font-normal">Repository</th>
              <th className="font-normal">Branch</th>
              <th className="font-normal">Local changes</th>
              <th className="font-normal">Origin</th>
              <th className="font-normal">Upstream</th>
              <th className="font-normal">Branches</th>
              <th className="pr-5">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {repos.map((repo) => (
              <RepoRow key={repo.key} repo={repo} onOpen={() => openRepo(repo.key)} />
            ))}
          </tbody>
        </table>
      )}
      <BranchesDialog
        projectId={opened?.projects[0]?.id}
        label={opened?.label ?? ""}
        onClose={() => openRepo(undefined)}
      />
    </Page>
  );
}

/** Clicks on the row's own controls, and on menus they portal elsewhere, shouldn't also open the branches. */
function isRowClick(event: MouseEvent<HTMLElement>) {
  const { target, currentTarget } = event;
  return target instanceof Element && currentTarget.contains(target) && !target.closest("button, a, input");
}

function RepoRow({ repo, onOpen }: { repo: RepoGroup; onOpen: () => void }) {
  const svc = useServices();
  const action = useMutation({
    mutationFn: (kind: RepoAction) => runRepoAction(svc, repo, kind),
    onSuccess: (message) => toast(message),
    onError: toastError,
  });
  const busy = (kind: RepoAction) => action.isPending && action.variables === kind;
  const report = repo.report;
  const git = report?.git;
  if (!git) return null;
  const gone = report.branches.filter((b) => b.upstreamGone && b.name !== git.branch);
  const fork = report.fork;
  const root = repo.root;

  return (
    <tr
      className="h-12 border-b border-line hover:bg-hover"
      onClick={(event) => {
        if (isRowClick(event)) onOpen();
      }}
    >
      <td className="pl-5">
        <button type="button" className="flex flex-col text-left" onClick={onOpen}>
          <span className="font-medium">{repo.label}</span>
          {repo.projects.length > 1 ? (
            <span className="text-xs text-faint">{repo.projects.map((p) => p.subdir || p.name).join(", ")}</span>
          ) : null}
        </button>
      </td>
      <td>{repo.projects[0] ? <BranchMenu projectId={repo.projects[0].id} git={git} /> : null}</td>
      <td>
        <LocalChanges git={git} />
      </td>
      <td>
        <OriginCell git={git} busy={busy} onAction={(kind) => action.mutate(kind)} />
      </td>
      <td>
        {fork ? (
          <button
            type="button"
            title={`Compare with ${fork.remote}`}
            onClick={() => openExternal(`https://${fork.remote}`)}
            className="flex items-center gap-1.5 text-muted hover:text-fg"
          >
            <GitFork className="size-3.5" />
            <span className="max-w-48 truncate">{fork.remote.replace(/^github\.com\//, "")}</span>
            {fork.behind ? <span className="text-xs text-info">{fork.behind} behind</span> : null}
          </button>
        ) : null}
      </td>
      <td>
        <span className="flex gap-2 text-sm text-muted">
          <span className="tabular">{report.branches.length}</span>
          {gone.length > 0 ? (
            <span className="text-faint" title={gone.map((b) => b.name).join(", ")}>
              {gone.length} remote deleted
            </span>
          ) : null}
        </span>
      </td>
      <td className="pr-5">
        <span className="flex justify-end gap-0.5">
          <IconButton
            size="sm"
            label="Fetch"
            loading={busy("fetch")}
            icon={<Download className="size-3.5" />}
            onClick={() => action.mutate("fetch")}
          />
          {root && inTauri ? (
            <IconButton
              size="sm"
              label="Open folder"
              icon={<FolderOpen className="size-3.5" />}
              onClick={() => openFolder(root)}
            />
          ) : null}
          {root ? (
            <IconButton
              size="sm"
              label="Open in VS Code"
              icon={<VsCodeIcon className="size-3" />}
              onClick={() => openInVsCode(svc.io, root)}
            />
          ) : null}
        </span>
      </td>
    </tr>
  );
}

function LocalChanges({ git }: { git: GitStatus }) {
  if (git.changed + git.untracked + git.conflicted === 0) return null;
  return (
    <span className="flex gap-3 text-sm">
      {git.changed ? <span className="text-warn">{git.changed} modified</span> : null}
      {git.untracked ? <span className="text-muted">{git.untracked} new</span> : null}
      {git.conflicted ? <span className="text-bad">{git.conflicted} conflicts</span> : null}
    </span>
  );
}

function OriginCell({
  git,
  busy,
  onAction,
}: {
  git: GitStatus;
  busy: (kind: RepoAction) => boolean;
  onAction: (kind: RepoAction) => void;
}) {
  if (!git.upstream) return <span className="text-sm text-faint">Not pushed</span>;
  return (
    <span className="flex items-center gap-2 text-sm text-muted">
      {git.ahead > 0 ? (
        <span className="flex items-center text-info">
          <ArrowUp className="size-3" />
          {git.ahead}
        </span>
      ) : null}
      {git.behind > 0 ? (
        <span className="flex items-center">
          <ArrowDown className="size-3" />
          {git.behind}
        </span>
      ) : null}
      {git.behind > 0 ? (
        <Button size="sm" loading={busy("pull")} onClick={() => onAction("pull")}>
          Pull
        </Button>
      ) : null}
      {git.ahead > 0 ? (
        <Button size="sm" loading={busy("push")} onClick={() => onAction("push")}>
          Push
        </Button>
      ) : null}
    </span>
  );
}
