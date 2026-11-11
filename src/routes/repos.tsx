import { useMutation } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import * as z from "@zod/mini";
import { cn } from "cn";
import { ArrowDown, ArrowUp, ChevronRight, GitFork, MoreHorizontal, RefreshCw } from "lucide-react";
import { Fragment, useState } from "react";
import { useActions, useCi, useFreshGit, useRepos } from "@/app/queries";
import { useServices } from "@/app/services";
import { inTauri } from "@/core/native";
import type { GitStatus } from "@/engine/git";
import { runFailed } from "@/integrations/github";
import { BranchActions } from "@/modules/projects/branch-actions";
import { BranchMenu } from "@/modules/projects/branch-menu";
import { BranchesDialog } from "@/modules/projects/branches-dialog";
import { SyncButton } from "@/modules/projects/sync-button";
import { ActionsList } from "@/modules/repos/actions-list";
import { CiCell, CiRuns } from "@/modules/repos/ci-runs";
import type { ActionsReport } from "@/services/actions";
import { latestRun } from "@/services/ci-status";
import type { CiEntry } from "@/services/github-feed";
import { refreshRepos } from "@/services/repo-refresh";
import { runRepoAction, type RepoGroup } from "@/services/repos";
import { Button } from "@/ui/button";
import { ErrorBoundary } from "@/ui/error-boundary";
import { openExternal, openFolder, openInVsCode } from "@/ui/external";
import { Chip, Empty, Page } from "@/ui/layout";
import { MenuItem, MenuSeparator, Popover } from "@/ui/popover";
import { tableColumns } from "@/ui/table-columns";
import { toastError } from "@/ui/toast";

const FILTERS = ["all", "changes", "unpushed", "behind", "ci", "actions"] as const;
type Filter = (typeof FILTERS)[number];

export const Route = createFileRoute("/repos")({
  validateSearch: z.object({ filter: z.optional(z.enum(FILTERS)), open: z.optional(z.string()) }),
  component: Repos,
});

const FILTER_LABEL: Record<Filter, string> = {
  all: "All",
  changes: "Uncommitted",
  unpushed: "Unpushed",
  behind: "Behind",
  ci: "Failing CI",
  actions: "Outdated actions",
};

interface RepoRowData {
  repo: RepoGroup;
  git: GitStatus;
  ci?: CiEntry;
  actions?: ActionsReport;
  outdatedActions: number;
  failing: boolean;
}

const matches: Record<Filter, (r: RepoRowData) => boolean> = {
  all: () => true,
  changes: (r) => r.git.changed + r.git.untracked + r.git.conflicted > 0,
  unpushed: (r) => r.git.ahead > 0,
  behind: (r) => r.git.behind > 0,
  ci: (r) => r.failing,
  actions: (r) => r.outdatedActions > 0,
};

function Repos() {
  const svc = useServices();
  useFreshGit();
  const { data: groups } = useRepos();
  const { data: ci } = useCi();
  const { data: actions } = useActions();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [branchesFor, setBranchesFor] = useState<RepoGroup>();
  const filter = search.filter ?? "all";

  const ciByRepo = new Map((ci?.entries ?? []).map((e) => [e.repo, e]));
  const actionsByKey = new Map((actions ?? []).map((a) => [a.repo.key, a.report]));
  const rows: RepoRowData[] = (groups ?? []).flatMap((repo) => {
    const git = repo.report?.git;
    if (!git) return [];
    const entry = repo.github ? ciByRepo.get(repo.github) : undefined;
    const run = entry ? latestRun(entry) : undefined;
    const report = actionsByKey.get(repo.key);
    return [
      {
        repo,
        git,
        ci: entry,
        actions: report,
        outdatedActions: report?.items.filter((i) => i.next).length ?? 0,
        failing: Boolean(entry?.error || (run && runFailed(run))),
      },
    ];
  });
  const visible = rows.filter(matches[filter]);
  const refreshAll = useMutation({
    mutationFn: () =>
      refreshRepos(
        svc,
        rows.map((r) => r.repo),
      ),
    onError: toastError,
  });
  const set = (patch: Partial<typeof search>) => void navigate({ search: { ...search, ...patch }, replace: true });

  return (
    <Page
      title="Repos"
      actions={
        <Button
          size="sm"
          icon={<RefreshCw className="size-3.5" />}
          loading={refreshAll.isPending}
          onClick={() => refreshAll.mutate()}
        >
          Refresh all
        </Button>
      }
      toolbar={
        rows.length > 0
          ? FILTERS.map((f) => {
              const count = rows.filter(matches[f]).length;
              if (f !== "all" && f !== filter && count === 0) return null;
              return (
                <Chip
                  key={f}
                  active={filter === f}
                  count={count}
                  onClick={() => set({ filter: f === "all" ? undefined : f })}
                >
                  {FILTER_LABEL[f]}
                </Chip>
              );
            })
          : undefined
      }
    >
      {rows.length === 0 ? (
        <Empty title="No git repositories" />
      ) : visible.length === 0 ? (
        <Empty
          title="No matches"
          action={
            <Button size="sm" onClick={() => set({ filter: undefined })}>
              Clear filter
            </Button>
          }
        />
      ) : (
        <div className="pb-6">
          <div
            className={cn(COLS, "sticky top-0 z-10 h-[30px] border-b border-line bg-canvas px-5 text-sm text-muted")}
            style={COLUMNS}
          >
            <span />
            <span>Repository</span>
            <span>Branch</span>
            <span>Local</span>
            <span>Origin</span>
            <span>CI</span>
            <span>Actions</span>
            <span />
          </div>
          {visible.map((row) => {
            const open = search.open === row.repo.key;
            return (
              <Fragment key={row.repo.key}>
                <ErrorBoundary fallback={() => null}>
                  <RepoRow
                    row={row}
                    open={open}
                    onToggle={() => set({ open: open ? undefined : row.repo.key })}
                    onBranches={() => setBranchesFor(row.repo)}
                  />
                </ErrorBoundary>
                {open ? (
                  <ErrorBoundary>
                    <RepoDetail row={row} />
                  </ErrorBoundary>
                ) : null}
              </Fragment>
            );
          })}
        </div>
      )}
      <BranchesDialog
        projectId={branchesFor?.projects[0]?.id}
        label={branchesFor?.label ?? ""}
        onClose={() => setBranchesFor(undefined)}
      />
    </Page>
  );
}

const COLS = "grid items-center gap-x-3";
const COLUMNS = tableColumns(["16px", "1fr", "200px", "140px", "150px", "150px", "90px", "150px"], 160);

function RepoRow({
  row,
  open,
  onToggle,
  onBranches,
}: {
  row: RepoRowData;
  open: boolean;
  onToggle: () => void;
  onBranches: () => void;
}) {
  const svc = useServices();
  const { repo, git } = row;
  const first = repo.projects[0];
  const pull = useMutation({
    mutationFn: (kind: "pull" | "push") => runRepoAction(svc, repo, kind),
    onError: toastError,
  });
  const refresh = useMutation({ mutationFn: () => refreshRepos(svc, [repo]), onError: toastError });
  return (
    <div
      className={cn(
        COLS,
        "group h-10 border-b border-line px-5 transition-colors duration-[80ms] hover:bg-hover",
        open && "bg-selected",
      )}
      style={COLUMNS}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-label={open ? `Hide ${repo.label} details` : `Show ${repo.label} details`}
        onClick={onToggle}
        className="flex text-faint hover:text-fg"
      >
        <ChevronRight className={cn("size-4 transition-transform", open && "rotate-90")} />
      </button>
      <button type="button" onClick={onToggle} className="flex min-w-0 items-baseline gap-2 text-left">
        <span className="truncate font-medium">{repo.label}</span>
        {repo.projects.length > 1 ? (
          <span className="truncate text-sm text-faint">{repo.projects.length} packages</span>
        ) : null}
      </button>
      <span className="min-w-0">{first ? <BranchMenu projectId={first.id} git={git} /> : null}</span>
      <LocalChanges git={git} />
      <span className="flex items-center gap-2 text-sm">
        {!git.upstream ? (
          <span className="text-faint">Not pushed</span>
        ) : (
          <>
            {git.ahead > 0 ? (
              <span className="flex items-center text-info" title={`${git.ahead} to push`}>
                <ArrowUp className="size-3" />
                {git.ahead}
              </span>
            ) : null}
            {git.behind > 0 ? (
              <span className="flex items-center text-muted" title={`${git.behind} to pull`}>
                <ArrowDown className="size-3" />
                {git.behind}
              </span>
            ) : null}
            {git.ahead + git.behind === 0 ? <span className="text-ghost">In sync</span> : null}
          </>
        )}
      </span>
      <CiCell entry={row.ci} />
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          "text-left text-sm tabular",
          row.outdatedActions > 0 ? "text-warn hover:underline" : "text-ghost",
        )}
      >
        {row.outdatedActions > 0 ? `${row.outdatedActions} outdated` : "—"}
      </button>
      <span className="flex items-center justify-end gap-1">
        {first ? (
          <>
            <BranchActions projectId={first.id} git={git} size="sm" />
            <SyncButton projectId={first.id} git={git} fork={repo.report?.fork} />
          </>
        ) : null}
        <Popover
          align="end"
          className="w-56 p-1"
          renderTrigger={({ toggle }) => (
            <button
              type="button"
              aria-label={`More for ${repo.label}`}
              onClick={toggle}
              className="flex size-6 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg"
            >
              <MoreHorizontal className="size-4" />
            </button>
          )}
        >
          {(close) => {
            const act = (fn: () => void) => () => {
              close();
              fn();
            };
            return (
              <>
                <MenuItem onSelect={act(onBranches)}>Branches…</MenuItem>
                <MenuItem onSelect={act(() => refresh.mutate())}>Refresh</MenuItem>
                {git.behind > 0 ? <MenuItem onSelect={act(() => pull.mutate("pull"))}>Pull</MenuItem> : null}
                {repo.report?.fork ? (
                  <MenuItem onSelect={act(() => openExternal(`https://${repo.report?.fork?.remote}`))}>
                    <GitFork className="size-4" />
                    Open upstream
                  </MenuItem>
                ) : null}
                {repo.root ? (
                  <>
                    <MenuSeparator />
                    <MenuItem onSelect={act(() => openInVsCode(svc.io, repo.root ?? ""))}>Open in VS Code</MenuItem>
                    {inTauri ? (
                      <MenuItem onSelect={act(() => openFolder(repo.root ?? ""))}>Open folder</MenuItem>
                    ) : null}
                  </>
                ) : null}
              </>
            );
          }}
        </Popover>
      </span>
    </div>
  );
}

function LocalChanges({ git }: { git: GitStatus }) {
  if (git.changed + git.untracked + git.conflicted === 0) return <span className="text-sm text-ghost">Clean</span>;
  return (
    <span className="flex gap-2 text-sm">
      {git.conflicted ? <span className="text-bad">{git.conflicted} conflicts</span> : null}
      {git.changed ? <span className="text-warn">{git.changed} modified</span> : null}
      {git.untracked ? <span className="text-muted">{git.untracked} new</span> : null}
    </span>
  );
}

function RepoDetail({ row }: { row: RepoRowData }) {
  return (
    <div
      className="grid grid-cols-2 gap-8 border-b border-line bg-hover px-12 py-4"
      style={{ minWidth: COLUMNS.minWidth }}
    >
      <section className="flex min-w-0 flex-col gap-1">
        <h3 className="text-sm font-medium text-muted">CI</h3>
        {row.ci ? <CiRuns entry={row.ci} /> : <p className="py-2 text-sm text-faint">Not on GitHub</p>}
      </section>
      <section className="flex min-w-0 flex-col gap-1">
        <h3 className="text-sm font-medium text-muted">Workflow actions</h3>
        <ActionsList repo={row.repo} report={row.actions} />
      </section>
    </div>
  );
}
