import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import * as z from "@zod/mini";
import { cn } from "cn";
import { ArrowDown, ArrowUp, FolderGit2, Plus, Search } from "lucide-react";
import { Fragment, useState } from "react";
import { useHome, useReports } from "@/app/queries";
import { useListKeys } from "@/app/shortcuts";
import { repoLabel } from "@/engine/discover";
import type { GitStatus } from "@/engine/git";
import { JobRefresh } from "@/modules/common";
import { projectLink } from "@/modules/links";
import { AddProjectsDialog } from "@/modules/projects/add-project";
import { BranchActions } from "@/modules/projects/branch-actions";
import { BranchMenu } from "@/modules/projects/branch-menu";
import { SyncButton } from "@/modules/projects/sync-button";
import { UpdateCells, UpdateHeader } from "@/modules/projects/update-cells";
import type { ProjectHealth } from "@/services/home";
import type { readAllReports } from "@/services/projects";
import { Button } from "@/ui/button";
import { ErrorBoundary } from "@/ui/error-boundary";
import { Empty, Page } from "@/ui/layout";
import { Spinner } from "@/ui/spinner";

const FILTERS = ["all", "updates", "advisories", "changes", "unpushed"] as const;
type Filter = (typeof FILTERS)[number];

export const Route = createFileRoute("/projects/")({
  validateSearch: z.object({ filter: z.optional(z.enum(FILTERS)), q: z.optional(z.string()) }),
  component: Projects,
});

type Row = Awaited<ReturnType<typeof readAllReports>>[number];

const FILTER_LABEL: Record<Filter, string> = {
  all: "All",
  updates: "Updates",
  advisories: "Advisories",
  changes: "Uncommitted",
  unpushed: "Unpushed",
};

const matches: Record<Filter, (h: ProjectHealth | undefined) => boolean> = {
  all: () => true,
  updates: (h) => Boolean(h && h.updates.major + h.updates.minor + h.updates.patch > 0),
  advisories: (h) => Boolean(h && h.security.total > 0),
  changes: (h) => Boolean(h && h.changed > 0),
  unpushed: (h) => Boolean(h && h.ahead > 0),
};

function Projects() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const setSearch = Route.useNavigate();
  const { data: rows, isPending } = useReports();
  const { data: home } = useHome();
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<string>();
  const filter = search.filter ?? "all";
  const query = (search.q ?? "").trim().toLowerCase();

  const health = new Map((home?.health ?? []).map((h) => [h.id, h]));
  const visible = (rows ?? []).filter(
    ({ project }) =>
      matches[filter](health.get(project.id)) &&
      (!query ||
        project.name.toLowerCase().includes(query) ||
        (project.remote ?? "").toLowerCase().includes(query) ||
        project.subdir.toLowerCase().includes(query)),
  );
  const groups = groupProjects(visible);
  const ids = groups.flatMap(([, members]) => members.map((r) => r.project.id));
  useListKeys({ ids, selected, onSelect: setSelected, onOpen: (id) => void navigate(projectLink(id)) });

  return (
    <Page
      title="Projects"
      subtitle={rows ? `${rows.length}` : undefined}
      actions={
        <>
          <JobRefresh jobId="projects" />
          <Button variant="primary" size="sm" icon={<Plus className="size-3.5" />} onClick={() => setAdding(true)}>
            Add projects
          </Button>
        </>
      }
      className="flex flex-col"
    >
      {isPending ? (
        <div className="flex justify-center p-10">
          <Spinner />
        </div>
      ) : rows?.length === 0 ? (
        <Empty
          icon={<FolderGit2 />}
          title="No projects yet"
          action={
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>
              Add projects
            </Button>
          }
        >
          Add a folder with a package.json, or a folder that holds several projects.
        </Empty>
      ) : (
        <>
          <Toolbar
            query={search.q ?? ""}
            onQuery={(q) => void setSearch({ search: { ...search, q: q || undefined }, replace: true })}
            filter={filter}
            onFilter={(f) =>
              void setSearch({ search: { ...search, filter: f === "all" ? undefined : f }, replace: true })
            }
            counts={Object.fromEntries(
              FILTERS.map((f) => [f, (rows ?? []).filter(({ project }) => matches[f](health.get(project.id))).length]),
            )}
          />
          {visible.length === 0 ? (
            <Empty title="No matching projects" />
          ) : (
            <ProjectTable groups={groups} health={health} selected={selected} />
          )}
        </>
      )}
      <AddProjectsDialog open={adding} onClose={() => setAdding(false)} />
    </Page>
  );
}

function Toolbar({
  query,
  onQuery,
  filter,
  onFilter,
  counts,
}: {
  query: string;
  onQuery: (q: string) => void;
  filter: Filter;
  onFilter: (f: Filter) => void;
  counts: Record<string, number>;
}) {
  return (
    <div className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-5">
      <label className="relative flex w-64 items-center">
        <Search className="pointer-events-none absolute left-2 size-3.5 text-faint" />
        <input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && onQuery("")}
          placeholder="Filter projects"
          aria-label="Filter projects"
          spellCheck={false}
          className="h-7 w-full rounded-md border border-line bg-white/[0.03] pr-2 pl-7 text-base placeholder:text-faint focus:border-accent/60 focus:outline-none"
        />
      </label>
      <div aria-label="Show" className="flex gap-1">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            onClick={() => onFilter(f)}
            className={cn(
              "flex h-7 items-center gap-1.5 rounded-md px-2.5 text-sm transition-colors",
              filter === f ? "bg-white/[0.08] text-fg" : "text-muted hover:bg-white/[0.04] hover:text-fg",
            )}
          >
            {FILTER_LABEL[f]}
            <span className="text-xs text-faint tabular">{counts[f] ?? 0}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ProjectTable({
  groups,
  health,
  selected,
}: {
  groups: [Group | undefined, Row[]][];
  health: Map<string, ProjectHealth>;
  selected: string | undefined;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <table className="w-full table-fixed text-left">
        <thead className="sticky top-0 z-10 bg-bg text-xs text-faint">
          <tr className="h-8 border-b border-line">
            <th className="pl-5 font-normal">Project</th>
            <th className="w-[220px] font-normal">Branch</th>
            <th className="w-[160px] font-normal">
              <UpdateHeader />
            </th>
            <th className="w-[96px] font-normal">Advisories</th>
            <th className="w-[200px] pr-5 font-normal">
              <span className="sr-only">Pull request</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {groups.map(([group, members]) => (
            <Fragment key={group?.label ?? ""}>
              {group ? <GroupRow group={group} first={members[0]} /> : null}
              {members.map((row) => (
                <ErrorBoundary key={row.project.id} fallback={() => null}>
                  <ProjectRow
                    row={row}
                    health={health.get(row.project.id)}
                    selected={selected === row.project.id}
                    grouped={Boolean(group)}
                  />
                </ErrorBoundary>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface Group {
  label: string;
}

/** Projects that live in a subfolder of a repo are listed under the repo; standalone ones come first. */
function groupProjects(rows: Row[]): [Group | undefined, Row[]][] {
  const groups = new Map<string | undefined, Row[]>();
  for (const row of rows) {
    const { remote, subdir, path } = row.project;
    const key = subdir ? repoLabel(remote, path ? path.slice(0, -(subdir.length + 1)) : undefined) : undefined;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups]
    .toSorted(([a], [b]) => (a === undefined ? -1 : b === undefined ? 1 : a.localeCompare(b)))
    .map(([label, members]) => [label === undefined ? undefined : { label }, members]);
}

function GroupRow({ group, first }: { group: Group; first: Row | undefined }) {
  return (
    <tr className="h-10 border-b border-line bg-white/[0.02]">
      <td className="pl-5">
        <span className="flex items-center gap-2 text-sm font-medium">
          <FolderGit2 className="size-3.5 text-faint" />
          {group.label}
        </span>
      </td>
      <td>{first ? <GitStatusCell projectId={first.project.id} git={first.report?.git} /> : null}</td>
      <td colSpan={2}>
        <span className="sr-only">Packages below</span>
      </td>
      <td className="pr-5">
        {first ? (
          <span className="flex justify-end gap-1.5">
            <BranchActions projectId={first.project.id} git={first.report?.git} size="sm" />
            <SyncButton projectId={first.project.id} git={first.report?.git} fork={first.report?.fork} />
          </span>
        ) : null}
      </td>
    </tr>
  );
}

const shortRemote = (remote: string | null) => remote?.replace(/^github\.com\//, "");
const folderName = (path: string | undefined) => path?.split(/[\\/]/).at(-1);

function ProjectRow({
  row: { project, report },
  health,
  selected,
  grouped,
}: {
  row: Row;
  health: ProjectHealth | undefined;
  selected: boolean;
  grouped: boolean;
}) {
  const secondary = grouped ? project.subdir : (shortRemote(project.remote) ?? folderName(project.path) ?? "No folder");
  return (
    <tr
      data-row-id={project.id}
      data-selected={selected || undefined}
      className="h-12 border-b border-line transition-colors hover:bg-hover data-selected:bg-raised"
    >
      <td className={grouped ? "pl-10" : "pl-5"}>
        <Link {...projectLink(project.id)} className="flex min-w-0 flex-col" title={project.path}>
          <span className="truncate font-medium">{project.name}</span>
          <span className="truncate text-xs text-faint">{secondary}</span>
        </Link>
      </td>
      <td>{grouped ? null : <GitStatusCell projectId={project.id} git={report?.git} />}</td>
      <td>
        {report?.error ? (
          <span className="text-sm text-bad" title={report.error}>
            Could not check
          </span>
        ) : !report ? (
          <span className="text-sm text-faint">Checking…</span>
        ) : health ? (
          <UpdateCells updates={health.updates} />
        ) : null}
      </td>
      <td>
        <AdvisoryCount health={health} />
      </td>
      <td className="pr-5">
        {grouped ? null : (
          <span className="flex justify-end gap-1.5">
            <BranchActions projectId={project.id} git={report?.git} size="sm" />
            <SyncButton projectId={project.id} git={report?.git} fork={report?.fork} />
          </span>
        )}
      </td>
    </tr>
  );
}

function AdvisoryCount({ health }: { health: ProjectHealth | undefined }) {
  const total = health?.security.total ?? 0;
  if (!health || total === 0) return <span className="text-sm text-white/15">0</span>;
  const urgent = health.security.critical + health.security.high;
  return (
    <Link
      to="/security"
      search={{ project: health.id }}
      title={`${health.security.critical} critical, ${health.security.high} high, ${health.security.moderate} moderate, ${health.security.low} low`}
      className={cn("text-sm tabular hover:underline", urgent > 0 ? "text-bad" : "text-warn")}
    >
      {total}
    </Link>
  );
}

function GitStatusCell({ projectId, git }: { projectId: string; git: GitStatus | undefined }) {
  const changed = git ? git.changed + git.untracked : 0;
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <BranchMenu projectId={projectId} git={git} />
      {changed > 0 ? (
        <span className="shrink-0 text-xs text-warn tabular" title={`${changed} uncommitted changes`}>
          {changed}✎
        </span>
      ) : null}
      {git && git.ahead > 0 ? (
        <span className="flex shrink-0 items-center text-xs text-info" title={`${git.ahead} commits to push`}>
          <ArrowUp className="size-3" />
          {git.ahead}
        </span>
      ) : null}
      {git && git.behind > 0 ? (
        <span className="flex shrink-0 items-center text-xs text-muted" title={`${git.behind} commits to pull`}>
          <ArrowDown className="size-3" />
          {git.behind}
        </span>
      ) : null}
    </span>
  );
}
