import { useMutation } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import * as z from "@zod/mini";
import { cn } from "cn";
import { ArrowDown, ArrowUp, ChevronDown, Clock, Pencil, Plus, Search, X } from "lucide-react";
import { Fragment, useEffect, useRef, useState, type MouseEvent, type RefObject } from "react";
import { useFreshGit, useHome, useJobs, useReports, useSetting } from "@/app/queries";
import { useServices } from "@/app/services";
import { useListKeys } from "@/app/shortcuts";
import { repoLabel } from "@/engine/discover";
import type { GitStatus } from "@/engine/git";
import { JobRefresh } from "@/modules/common";
import { projectLink } from "@/modules/links";
import { AddProjectsDialog } from "@/modules/projects/add-project";
import { BranchActions } from "@/modules/projects/branch-actions";
import { BranchMenu } from "@/modules/projects/branch-menu";
import { SyncButton } from "@/modules/projects/sync-button";
import { UpdateRunDialog } from "@/modules/projects/update-run";
import type { ProjectHealth } from "@/services/home";
import { PINNED_SETTING, pinnedSchema, setPinned } from "@/services/pins";
import type { readAllReports } from "@/services/projects";
import { syncRepo } from "@/services/repos";
import { projectStatus } from "@/services/status";
import { startBatch, startUpdate, subscribeBatch, type BatchProgress } from "@/services/updates";
import { Button } from "@/ui/button";
import { ErrorBoundary } from "@/ui/error-boundary";
import { openFolder, openInVsCode } from "@/ui/external";
import { Checkbox } from "@/ui/field";
import { Chip, Empty, Page } from "@/ui/layout";
import { Mono } from "@/ui/misc";
import { ContextMenu, MenuItem, MenuSeparator } from "@/ui/popover";
import { StatusGlyph } from "@/ui/status-glyph";
import { tableColumns } from "@/ui/table-columns";
import { ReleaseAge } from "@/ui/time";
import { toast, toastError } from "@/ui/toast";

const FILTERS = ["all", "updates", "advisories", "changes", "unpushed"] as const;
type Filter = (typeof FILTERS)[number];

export const Route = createFileRoute("/projects/")({
  validateSearch: z.object({
    filter: z.optional(z.enum(FILTERS)),
    q: z.optional(z.string()),
    sel: z.optional(z.string()),
    peek: z.optional(z.boolean()),
  }),
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

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);

function visibleRows(rows: Row[], health: Map<string, ProjectHealth>, filter: Filter, query: string) {
  return rows.filter(
    ({ project }) =>
      matches[filter](health.get(project.id)) &&
      (!query ||
        project.name.toLowerCase().includes(query) ||
        (project.remote ?? "").toLowerCase().includes(query) ||
        project.subdir.toLowerCase().includes(query)),
  );
}

/** Ctrl+F focuses the filter, x checks the selected row, Esc clears checks and then closes the peek. */
function useProjectKeys(options: {
  filterInput: RefObject<HTMLInputElement | null>;
  selected: string | undefined;
  checkedCount: number;
  onCheck: (id: string) => void;
  onClearChecks: () => void;
  peek: boolean;
  onClosePeek: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        options.filterInput.current?.focus();
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey || isTyping(event.target)) return;
      if (event.key === "x" && options.selected) options.onCheck(options.selected);
      if (event.key === "Escape") {
        if (options.checkedCount > 0) options.onClearChecks();
        else if (options.peek) options.onClosePeek();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
}

function FilterBar({
  inputRef,
  query,
  onQuery,
  filter,
  onFilter,
  counts,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  query: string;
  onQuery: (q: string | undefined) => void;
  filter: Filter;
  onFilter: (f: Filter) => void;
  counts: Record<string, number>;
}) {
  return (
    <>
      <label className="relative mr-2 flex w-56 items-center">
        <Search className="pointer-events-none absolute left-2 size-3.5 text-faint" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => onQuery(e.target.value || undefined)}
          onKeyDown={(e) => {
            if (e.key !== "Escape") return;
            if (e.currentTarget.value) onQuery(undefined);
            else e.currentTarget.blur();
          }}
          placeholder="Filter"
          aria-label="Filter projects"
          spellCheck={false}
          className="h-7 w-full rounded-md border border-line-strong bg-surface pr-2 pl-7 text-base placeholder:text-faint focus:border-focus focus:outline-none"
        />
      </label>
      {FILTERS.filter((f) => f === "all" || f === filter || (counts[f] ?? 0) > 0).map((f) => (
        <Chip key={f} active={filter === f} count={counts[f] ?? 0} onClick={() => onFilter(f)}>
          {FILTER_LABEL[f]}
        </Chip>
      ))}
    </>
  );
}

function Projects() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const setSearch = Route.useNavigate();
  useFreshGit();
  const { data: rows, isPending } = useReports();
  const { data: home } = useHome();
  const [adding, setAdding] = useState(false);
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const filterInput = useRef<HTMLInputElement>(null);
  const filter = search.filter ?? "all";
  const query = (search.q ?? "").trim().toLowerCase();
  const update = (patch: Partial<typeof search>) => void setSearch({ search: { ...search, ...patch }, replace: true });

  const health = new Map((home?.health ?? []).map((h) => [h.id, h]));
  const visible = visibleRows(rows ?? [], health, filter, query);
  const groups = groupProjects(visible);
  const ids = groups.flatMap(([, members]) => members.map((r) => r.project.id));
  const selected = search.sel && ids.includes(search.sel) ? search.sel : undefined;
  const toggleChecked = (id: string) =>
    setChecked((previous) => {
      const next = new Set(previous);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  useListKeys({
    ids,
    selected,
    onSelect: (id) => update({ sel: id }),
    onOpen: (id) => void navigate(projectLink(id)),
    onToggle: () => update({ peek: search.peek ? undefined : true }),
  });
  useProjectKeys({
    filterInput,
    selected,
    checkedCount: checked.size,
    onCheck: toggleChecked,
    onClearChecks: () => setChecked(new Set()),
    peek: Boolean(search.peek),
    onClosePeek: () => update({ peek: undefined }),
  });

  const counts = Object.fromEntries(
    FILTERS.map((f) => [f, (rows ?? []).filter(({ project }) => matches[f](health.get(project.id))).length]),
  );
  const peeked = search.peek && selected ? visible.find((r) => r.project.id === selected) : undefined;

  return (
    <Page
      title="Projects"
      actions={
        <>
          <JobRefresh jobId="projects" label="Check again" />
          <Button variant="primary" size="sm" icon={<Plus className="size-3.5" />} onClick={() => setAdding(true)}>
            Add projects
          </Button>
        </>
      }
      toolbar={
        rows?.length ? (
          <FilterBar
            inputRef={filterInput}
            query={search.q ?? ""}
            onQuery={(q) => update({ q })}
            filter={filter}
            onFilter={(f) => update({ filter: f === "all" ? undefined : f })}
            counts={counts}
          />
        ) : undefined
      }
      className="flex"
    >
      {isPending ? null : rows?.length === 0 ? (
        <div className="flex-1">
          <Empty
            title="No projects"
            action={
              <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>
                Add projects
              </Button>
            }
          />
        </div>
      ) : (
        <ProjectsBody
          groups={groups}
          health={health}
          selected={selected}
          checked={checked}
          checkedRows={(rows ?? []).filter((r) => checked.has(r.project.id))}
          peeked={peeked}
          onSelect={(id) => update({ sel: id })}
          onCheck={toggleChecked}
          onClearChecks={() => setChecked(new Set())}
          onPeek={(id) => update({ sel: id, peek: true })}
          onClosePeek={() => update({ peek: undefined })}
          onClearFilter={() => update({ q: undefined, filter: undefined })}
        />
      )}
      <AddProjectsDialog open={adding} onClose={() => setAdding(false)} />
    </Page>
  );
}

function ProjectsBody({
  groups,
  health,
  selected,
  checked,
  checkedRows,
  peeked,
  onSelect,
  onCheck,
  onClearChecks,
  onPeek,
  onClosePeek,
  onClearFilter,
}: {
  groups: [Group | undefined, Row[]][];
  health: Map<string, ProjectHealth>;
  selected: string | undefined;
  checked: ReadonlySet<string>;
  checkedRows: Row[];
  peeked: Row | undefined;
  onSelect: (id: string) => void;
  onCheck: (id: string) => void;
  onClearChecks: () => void;
  onPeek: (id: string) => void;
  onClosePeek: () => void;
  onClearFilter: () => void;
}) {
  return (
    <>
      <div className="relative flex min-w-0 flex-1 flex-col">
        {groups.length === 0 ? (
          <Empty
            title="No matches"
            action={
              <Button size="sm" onClick={onClearFilter}>
                Clear filter
              </Button>
            }
          />
        ) : (
          <ProjectList
            groups={groups}
            health={health}
            selected={selected}
            checked={checked}
            onSelect={onSelect}
            onCheck={onCheck}
            onPeek={onPeek}
          />
        )}
        {checkedRows.length > 0 ? <BulkBar rows={checkedRows} onClear={onClearChecks} /> : null}
      </div>
      {peeked ? (
        <ErrorBoundary key={peeked.project.id}>
          <Peek row={peeked} health={health.get(peeked.project.id)} onClose={onClosePeek} />
        </ErrorBoundary>
      ) : null}
    </>
  );
}

const COLS = "grid items-center gap-x-3";
const COLUMNS = tableColumns(["20px", "16px", "1fr", "220px", "36px", "36px", "36px", "80px", "160px"], 160);

function ProjectList({
  groups,
  health,
  selected,
  checked,
  onSelect,
  onCheck,
  onPeek,
}: {
  groups: [Group | undefined, Row[]][];
  health: Map<string, ProjectHealth>;
  selected: string | undefined;
  checked: ReadonlySet<string>;
  onSelect: (id: string) => void;
  onCheck: (id: string) => void;
  onPeek: (id: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [menu, setMenu] = useState<{ x: number; y: number; row: Row }>();
  const { data: jobs = [] } = useJobs();
  const checking = jobs.some((j) => j.id === "projects" && j.running);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto pb-16">
      <div
        className={cn(COLS, "sticky top-0 z-10 h-[30px] border-b border-line bg-canvas px-5 text-sm text-muted")}
        style={COLUMNS}
      >
        <span />
        <span />
        <span>Project</span>
        <span>Branch</span>
        <span className="text-right" title="Major updates">
          Maj
        </span>
        <span className="text-right" title="Minor updates">
          Min
        </span>
        <span className="text-right" title="Patch updates">
          Pat
        </span>
        <span className="text-right">Advisories</span>
        <span />
      </div>
      {groups.map(([group, members]) => {
        const open = !group || !collapsed.has(group.label);
        return (
          <Fragment key={group?.label ?? ""}>
            {group ? (
              <GroupRow
                group={group}
                count={members.length}
                first={members[0]}
                open={open}
                onToggle={() =>
                  setCollapsed((previous) => {
                    const next = new Set(previous);
                    if (!next.delete(group.label)) next.add(group.label);
                    return next;
                  })
                }
              />
            ) : null}
            {open
              ? members.map((row) => (
                  <ErrorBoundary key={row.project.id} fallback={() => null}>
                    <ProjectRow
                      row={row}
                      health={health.get(row.project.id)}
                      checking={checking}
                      selected={selected === row.project.id}
                      checked={checked.has(row.project.id)}
                      anyChecked={checked.size > 0}
                      grouped={Boolean(group)}
                      onSelect={() => onSelect(row.project.id)}
                      onCheck={() => onCheck(row.project.id)}
                      onMenu={(event) => {
                        event.preventDefault();
                        onSelect(row.project.id);
                        setMenu({ x: event.clientX, y: event.clientY, row });
                      }}
                    />
                  </ErrorBoundary>
                ))
              : null}
          </Fragment>
        );
      })}
      <RowMenu menu={menu} onClose={() => setMenu(undefined)} onPeek={onPeek} />
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

function GroupRow({
  group,
  count,
  first,
  open,
  onToggle,
}: {
  group: Group;
  count: number;
  first: Row | undefined;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className={cn(COLS, "h-9 border-b border-line bg-hover px-5")} style={COLUMNS}>
      <button
        type="button"
        aria-expanded={open}
        aria-label={open ? `Collapse ${group.label}` : `Expand ${group.label}`}
        onClick={onToggle}
        className="col-span-3 flex min-w-0 items-center gap-2 text-left text-sm font-medium"
      >
        <ChevronDown className={cn("size-3.5 shrink-0 text-faint transition-transform", !open && "-rotate-90")} />
        <span className="truncate">{group.label}</span>
        <span className="font-normal text-faint tabular">{count}</span>
      </button>
      <span>{first ? <GitStatusCell projectId={first.project.id} git={first.report?.git} /> : null}</span>
      <span className="col-span-4" />
      <span className="flex justify-end gap-1.5">
        {first ? (
          <>
            <BranchActions projectId={first.project.id} git={first.report?.git} size="sm" />
            <SyncButton projectId={first.project.id} git={first.report?.git} fork={first.report?.fork} />
          </>
        ) : null}
      </span>
    </div>
  );
}

const shortRemote = (remote: string | null) => remote?.replace(/^github\.com\//, "");
const folderName = (path: string | undefined) => path?.split(/[\\/]/).at(-1);

function Count({ value, tone, label }: { value: number; tone: string; label: string }) {
  return (
    <span title={`${value} ${label}`} className={cn("text-right text-sm tabular", value > 0 ? tone : "text-ghost")}>
      {value}
    </span>
  );
}

function ProjectRow({
  row: { project, report },
  health,
  checking,
  selected,
  checked,
  anyChecked,
  grouped,
  onSelect,
  onCheck,
  onMenu,
}: {
  row: Row;
  health: ProjectHealth | undefined;
  checking: boolean;
  selected: boolean;
  checked: boolean;
  anyChecked: boolean;
  grouped: boolean;
  onSelect: () => void;
  onCheck: () => void;
  onMenu: (event: MouseEvent) => void;
}) {
  const secondary = grouped ? project.subdir : (shortRemote(project.remote) ?? folderName(project.path) ?? "No folder");
  return (
    <div
      data-row-id={project.id}
      aria-current={selected || undefined}
      className={cn(
        COLS,
        // The overlay button takes clicks on empty space; links, buttons and fields stay clickable above it.
        "group relative h-9 border-b border-line px-5 transition-colors duration-[80ms] [&_a]:pointer-events-auto [&_button]:pointer-events-auto [&_input]:pointer-events-auto [&>*]:pointer-events-none [&>*]:relative [&>*]:z-[1]",
        checked ? "bg-accent-bg" : selected ? "bg-selected" : "hover:bg-hover",
      )}
      style={COLUMNS}
    >
      <button
        type="button"
        tabIndex={-1}
        aria-label={`Select ${project.name}`}
        onClick={onSelect}
        onContextMenu={onMenu}
        className="pointer-events-auto! absolute! inset-0 z-0! cursor-default"
      />
      <span
        className={cn("flex", !checked && !anyChecked && "opacity-0 group-hover:opacity-100 focus-within:opacity-100")}
      >
        <Checkbox label={`Select ${project.name}`} checked={checked} onChange={onCheck} />
      </span>
      <StatusGlyph status={report?.error ? "off" : projectStatus(health, checking && !report)} />
      <Link
        {...projectLink(project.id)}
        className="flex min-w-0 items-baseline gap-2"
        title={project.path}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="truncate font-medium">{project.name}</span>
        <span className="truncate text-sm text-faint">{secondary}</span>
      </Link>
      <span className="min-w-0">{grouped ? null : <GitStatusCell projectId={project.id} git={report?.git} />}</span>
      <RowCounts projectId={project.id} health={health} error={report?.error} />
      <span className="flex justify-end gap-1.5">
        {grouped ? null : (
          <>
            <BranchActions projectId={project.id} git={report?.git} size="sm" />
            <SyncButton projectId={project.id} git={report?.git} fork={report?.fork} />
          </>
        )}
      </span>
    </div>
  );
}

/** Major, minor, patch and advisories in fixed columns; one error note across them when the check failed. */
function RowCounts({
  projectId,
  health,
  error,
}: {
  projectId: string;
  health: ProjectHealth | undefined;
  error: string | undefined;
}) {
  if (error) {
    return (
      <span className="col-span-4 truncate text-right text-sm text-bad" title={error}>
        Could not check
      </span>
    );
  }
  const urgent = health ? health.security.critical + health.security.high : 0;
  const advisories = health?.security.total ?? 0;
  return (
    <>
      <Count value={health?.updates.major ?? 0} tone="text-bad" label="major" />
      <Count value={health?.updates.minor ?? 0} tone="text-warn" label="minor" />
      <Count value={health?.updates.patch ?? 0} tone="text-ok" label="patch" />
      {advisories > 0 ? (
        <Link
          to="/security"
          search={{ project: projectId }}
          onClick={(e) => e.stopPropagation()}
          className={cn("text-right text-sm tabular hover:underline", urgent > 0 ? "text-bad" : "text-warn")}
        >
          {advisories}
        </Link>
      ) : (
        <span className="text-right text-sm text-ghost tabular">0</span>
      )}
    </>
  );
}

function RowMenu({
  menu,
  onClose,
  onPeek,
}: {
  menu: { x: number; y: number; row: Row } | undefined;
  onClose: () => void;
  onPeek: (id: string) => void;
}) {
  const svc = useServices();
  const navigate = useNavigate();
  const { data: pinned = [] } = useSetting(PINNED_SETTING, pinnedSchema, []);
  const project = menu?.row.project;
  const isPinned = project ? pinned.includes(project.id) : false;
  const act = (fn: () => void) => () => {
    onClose();
    fn();
  };
  return (
    <ContextMenu at={menu} onClose={onClose}>
      {project ? (
        <>
          <MenuItem onSelect={act(() => void navigate(projectLink(project.id)))}>Open</MenuItem>
          <MenuItem onSelect={act(() => onPeek(project.id))}>Peek</MenuItem>
          <MenuSeparator />
          {project.path ? (
            <>
              <MenuItem onSelect={act(() => openInVsCode(svc.io, project.path ?? ""))}>Open in VS Code</MenuItem>
              <MenuItem onSelect={act(() => openFolder(project.path ?? ""))}>Open folder</MenuItem>
            </>
          ) : null}
          <MenuItem onSelect={act(() => syncRepo(svc, project.id).then(toast, toastError))}>Sync</MenuItem>
          <MenuItem onSelect={act(() => void setPinned(svc, project.id, !isPinned).catch(toastError))}>
            {isPinned ? "Unpin from sidebar" : "Pin to sidebar"}
          </MenuItem>
          {project.path ? (
            <>
              <MenuSeparator />
              <MenuItem
                onSelect={act(() => {
                  navigator.clipboard.writeText(project.path ?? "").catch(toastError);
                })}
              >
                Copy path
              </MenuItem>
            </>
          ) : null}
        </>
      ) : null}
    </ContextMenu>
  );
}

function GitStatusCell({ projectId, git }: { projectId: string; git: GitStatus | undefined }) {
  const changed = git ? git.changed + git.untracked : 0;
  return (
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- keeps the branch menu's clicks from also selecting the row
    <span className="flex min-w-0 items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
      <BranchMenu projectId={projectId} git={git} />
      {changed > 0 ? (
        <span
          className="flex shrink-0 items-center gap-0.5 text-xs text-warn tabular"
          title={`${changed} uncommitted changes`}
        >
          {changed}
          <Pencil className="size-3" strokeWidth={1.5} />
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

const BUMP_TEXT = {
  major: "text-bad",
  minor: "text-warn",
  patch: "text-ok",
  prerelease: "text-info",
  none: "text-muted",
};

/** The selected project's outdated packages beside the list, so the list stays in view while deciding. */
function Peek({ row, health, onClose }: { row: Row; health: ProjectHealth | undefined; onClose: () => void }) {
  const svc = useServices();
  const [runId, setRunId] = useState<string>();
  const outdated = (row.report?.outdated ?? []).toSorted(
    (a, b) =>
      ["major", "minor", "patch", "prerelease"].indexOf(a.bump) -
      ["major", "minor", "patch", "prerelease"].indexOf(b.bump),
  );
  const update = useMutation({
    mutationFn: () =>
      startUpdate(
        svc,
        row.project.id,
        outdated.map((entry) => ({ entry, version: entry.latest })),
      ),
    onSuccess: setRunId,
    onError: toastError,
  });
  return (
    <aside
      className="flex w-[400px] shrink-0 animate-pop-in flex-col border-l border-line"
      aria-label={`${row.project.name} updates`}
    >
      <div className="flex h-[52px] shrink-0 items-center gap-2 border-b border-line pr-2 pl-4">
        <StatusGlyph status={projectStatus(health)} />
        <Link {...projectLink(row.project.id)} className="truncate text-lg font-medium hover:underline">
          {row.project.name}
        </Link>
        {row.report?.git?.branch ? <Mono className="truncate text-faint">{row.report.git.branch}</Mono> : null}
        <button
          type="button"
          aria-label="Close peek"
          onClick={onClose}
          className="ml-auto flex size-6 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg"
        >
          <X className="size-3.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {outdated.length === 0 ? (
          <Empty title="Up to date" />
        ) : (
          outdated.map((entry) => (
            <div key={`${entry.name}:${entry.range}`} className="flex h-9 items-center gap-2 border-b border-line px-4">
              <Mono className="min-w-0 flex-1 truncate text-fg">{entry.name}</Mono>
              {entry.heldBackByAge ? (
                <span title="A newer version is younger than this project's minimumReleaseAge" className="flex">
                  <Clock
                    className="size-3.5 text-faint"
                    aria-label="A newer version is younger than this project's minimumReleaseAge"
                  />
                </span>
              ) : null}
              <Mono className="text-faint">{entry.current ?? entry.range}</Mono>
              <span className="text-faint">→</span>
              <Mono className={BUMP_TEXT[entry.bump]}>{entry.latest}</Mono>
              <ReleaseAge value={entry.publishedAt} />
            </div>
          ))
        )}
      </div>
      {outdated.length > 0 ? (
        <div className="flex h-12 shrink-0 items-center gap-2 border-t border-line px-4">
          <span className="truncate text-sm text-faint">
            {health && health.security.total > 0 ? `${health.security.total} advisories` : null}
          </span>
          <Button
            size="sm"
            variant="primary"
            className="ml-auto"
            loading={update.isPending}
            onClick={() => update.mutate()}
          >
            {outdated.length === 1 ? "Update 1 package" : `Update ${outdated.length} packages`}
          </Button>
        </div>
      ) : null}
      <UpdateRunDialog
        runId={runId}
        projectId={row.project.id}
        path={row.project.path}
        name={row.project.name}
        onClose={() => setRunId(undefined)}
      />
    </aside>
  );
}

function useBatch(id: string | undefined) {
  const [progress, setProgress] = useState<BatchProgress>();
  useEffect(() => (id ? subscribeBatch(id, setProgress) : undefined), [id]);
  return progress;
}

/** Floats over the list while rows are checked; acts on all of them at once. */
function BulkBar({ rows, onClear }: { rows: Row[]; onClear: () => void }) {
  const svc = useServices();
  const [batchId, setBatchId] = useState<string>();
  const progress = useBatch(batchId);
  const plans = rows.flatMap(({ project, report }) =>
    report?.outdated.length
      ? [
          {
            projectId: project.id,
            name: project.name,
            picks: report.outdated.map((entry) => ({ entry, version: entry.latest })),
          },
        ]
      : [],
  );
  const sync = useMutation({
    mutationFn: async () => {
      const results = await Promise.allSettled(rows.map((r) => syncRepo(svc, r.project.id)));
      const failed = results.filter((r) => r.status === "rejected").length;
      if (failed > 0) throw new Error(`${failed} of ${rows.length} could not sync.`);
    },
    onError: toastError,
  });
  const done = progress?.items.filter((i) => i.state === "ok" || i.state === "failed").length ?? 0;
  const failed = progress?.items.filter((i) => i.state === "failed") ?? [];
  return (
    <div className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 animate-rise-in items-center gap-1 rounded-lg border border-line-strong bg-raised py-1 pr-1 pl-3 shadow-pop">
      <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent-bg px-1.5 text-xs font-medium text-accent-text tabular">
        {rows.length}
      </span>
      <span className="mr-2 text-sm">selected</span>
      {progress ? (
        <span className="mr-2 text-sm text-muted" title={failed.map((f) => `${f.name}: ${f.detail}`).join("\n")}>
          {progress.done
            ? failed.length > 0
              ? `${done - failed.length} updated, ${failed.length} failed`
              : `${done} updated`
            : `Updating ${done + 1} of ${progress.items.length}`}
        </span>
      ) : (
        <Button
          size="sm"
          variant="primary"
          disabled={plans.length === 0}
          title={plans.length === 0 ? "Nothing to update in the selected projects" : undefined}
          onClick={() => setBatchId(startBatch(svc, plans))}
        >
          {plans.length === 1 ? "Update 1 project" : `Update ${plans.length} projects`}
        </Button>
      )}
      <Button size="sm" loading={sync.isPending} onClick={() => sync.mutate()}>
        Sync
      </Button>
      <button
        type="button"
        aria-label="Clear selection"
        title="Clear selection (Esc)"
        onClick={onClear}
        className="flex size-6 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
