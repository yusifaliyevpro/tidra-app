import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import * as z from "@zod/mini";
import { cn } from "cn";
import { ArrowDown, ArrowUp, FolderOpen, Play, RefreshCw } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useHome, useJobs, useProject, useReport } from "@/app/queries";
import { useProcessList } from "@/app/queries";
import { useApp, useServices } from "@/app/services";
import { inTauri } from "@/core/native";
import { scriptCommand } from "@/engine/pm";
import { ProcessDialog } from "@/modules/process-dialog";
import { BranchActions } from "@/modules/projects/branch-actions";
import { BranchMenu } from "@/modules/projects/branch-menu";
import { Dependencies } from "@/modules/projects/dependencies";
import { ProjectSettings } from "@/modules/projects/project-settings";
import { RunChecksButton } from "@/modules/projects/run-checks";
import { SyncButton } from "@/modules/projects/sync-button";
import { UpdateRunDialog } from "@/modules/projects/update-run";
import { fetchProject, refreshProject } from "@/services/projects";
import { hasUncommittedUpdate } from "@/services/pull-requests";
import { projectStatus } from "@/services/status";
import { listRuns, subscribeRun } from "@/services/updates";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { openExternal, openFolder, openInVsCode } from "@/ui/external";
import { Breadcrumb, Empty, ErrorNote, Page } from "@/ui/layout";
import { Log } from "@/ui/log";
import { Mono, Tabs } from "@/ui/misc";
import { Spinner } from "@/ui/spinner";
import { StatusGlyph } from "@/ui/status-glyph";
import { TimeAgo } from "@/ui/time";
import { toastError } from "@/ui/toast";
import { VsCodeIcon } from "@/ui/vscode-icon";

type Tab = (typeof TABS)[number];

const TABS = ["dependencies", "git", "scripts", "runs", "settings"] as const;

export const Route = createFileRoute("/projects/$projectId")({
  validateSearch: z.object({ tab: z.optional(z.enum(TABS)) }),
  component: ProjectPage,
});

type Project = NonNullable<ReturnType<typeof useProject>["data"]>;
type Report = NonNullable<ReturnType<typeof useReport>["data"]>;

/** Esc with nothing open goes back to the list, with this project still selected. */
function useEscapeToList(projectId: string) {
  const navigate = useNavigate();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const target = event.target;
      if (target instanceof HTMLElement && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (document.querySelector("dialog[open], [role=menu]")) return;
      void navigate({ to: "/projects", search: { sel: projectId } });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, projectId]);
}

function ProjectPage() {
  const { projectId } = Route.useParams();
  const { data: project, isPending } = useProject(projectId);
  const { data: report } = useReport(projectId);
  const { data: home } = useHome();
  const { data: jobs = [] } = useJobs();
  const svc = useServices();
  // Opening a project, or coming back to it, fetches its repo in the background so Sync counts are current.
  useQuery({
    queryKey: ["fetch", projectId],
    queryFn: () => fetchProject(svc, projectId),
    enabled: !svc.preview,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
  useEscapeToList(projectId);
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  // The tab lives in the URL, so leaving and coming back (or the sidebar) restores it.
  const tab = search.tab ?? "dependencies";
  const setTab = (next: Tab) =>
    void navigate({ search: { tab: next === "dependencies" ? undefined : next }, replace: true });
  const [runId, setRunId] = useState<string>();

  if (isPending) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (!project) return <Empty title="Project not found" />;
  const health = home?.health.find((h) => h.id === project.id);
  const checking = !report && jobs.some((j) => j.id === "projects" && j.running);

  return (
    <Page
      title={
        <Breadcrumb
          parent={
            <Link to="/projects" search={{ sel: project.id }} className="hover:text-fg">
              Projects
            </Link>
          }
        >
          {project.name}
        </Breadcrumb>
      }
      className="flex overflow-hidden"
      actions={<HeaderActions project={project} report={report} />}
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          leading={
            <span className="flex min-w-0 items-center gap-2.5">
              <StatusGlyph status={report?.error ? "off" : projectStatus(health, checking)} className="size-4" />
              <span className="truncate text-2xl font-semibold tracking-[-0.02em]" title={project.path}>
                {project.name}
              </span>
            </span>
          }
          items={[
            { id: "dependencies", label: "Dependencies", count: report?.outdated.length },
            { id: "git", label: "Git" },
            { id: "scripts", label: "Scripts", count: Object.keys(report?.scripts ?? {}).length },
            { id: "runs", label: "History" },
            { id: "settings", label: "Settings" },
          ]}
        />
        <div className="min-h-0 flex-1 overflow-y-auto">
          {report?.error ? (
            <div className="px-5 pt-3">
              <ErrorNote>{report.error}</ErrorNote>
            </div>
          ) : null}
          {report ? (
            <TabContent tab={tab} project={project} report={report} onUpdateStarted={setRunId} />
          ) : (
            <div className="flex justify-center p-10">
              <Spinner />
            </div>
          )}
        </div>
      </div>
      <Properties project={project} report={report} ci={health?.ci} />
      <UpdateRunDialog
        runId={runId}
        projectId={project.id}
        path={project.path}
        name={project.name}
        onClose={() => setRunId(undefined)}
      />
    </Page>
  );
}

function HeaderActions({ project, report }: { project: Project; report: Report | null | undefined }) {
  const { svc } = useApp();
  const refresh = useMutation({
    mutationFn: () => refreshProject(svc, project.id, { force: true }),
    onError: toastError,
  });
  // Keyed under "runs" so a finished update refreshes it along with the run list.
  const { data: uncommitted } = useQuery({
    queryKey: ["runs", project.id, "uncommitted"],
    queryFn: () => hasUncommittedUpdate(svc, project.id),
  });
  return (
    <>
      <Button
        size="sm"
        icon={<RefreshCw className="size-3.5" />}
        loading={refresh.isPending}
        onClick={() => refresh.mutate()}
      >
        Check again
      </Button>
      <SyncButton projectId={project.id} git={report?.git} fork={report?.fork} />
      <BranchActions projectId={project.id} git={report?.git} allowCommit={uncommitted} size="sm" />
    </>
  );
}

function Property({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-[30px] items-center gap-2 text-sm">
      <span className="w-28 shrink-0 text-muted">{label}</span>
      <span className="flex min-w-0 items-center gap-1.5">{children}</span>
    </div>
  );
}

const CI_LABEL = { success: "Passing", failure: "Failing", pending: "Running", none: "No runs" } as const;
const CI_TONE = { success: "ok", failure: "bad", pending: "warn" } as const;

function BranchProperties({ projectId, git }: { projectId: string; git: Report["git"] }) {
  const changed = git ? git.changed + git.untracked : 0;
  return (
    <>
      <Property label="Branch">
        <BranchMenu projectId={projectId} git={git} />
        {git && git.ahead > 0 ? (
          <span className="flex items-center text-sm text-info" title={`${git.ahead} to push`}>
            <ArrowUp className="size-3" />
            {git.ahead}
          </span>
        ) : null}
        {git && git.behind > 0 ? (
          <span className="flex items-center text-sm text-muted" title={`${git.behind} to pull`}>
            <ArrowDown className="size-3" />
            {git.behind}
          </span>
        ) : null}
      </Property>
      <Property label="Changes">
        {changed > 0 ? (
          <span className="text-warn">{changed} uncommitted</span>
        ) : (
          <span className="text-ghost">None</span>
        )}
      </Property>
    </>
  );
}

function ExternalProperty({ label, remote, children }: { label: string; remote: string; children?: ReactNode }) {
  return (
    <Property label={label}>
      <button
        type="button"
        onClick={() => openExternal(`https://${remote}`)}
        className="truncate text-left hover:underline"
        title={remote}
      >
        {remote.replace(/^github\.com\//, "")}
      </button>
      {children}
    </Property>
  );
}

function ProjectTools({ project, report }: { project: Project; report: Report | null | undefined }) {
  const { svc } = useApp();
  const path = project.path;
  return (
    <div className="flex flex-col items-stretch gap-1 [&>*]:justify-start">
      {path ? (
        <Button
          size="sm"
          variant="ghost"
          icon={<VsCodeIcon className="size-3.5" />}
          onClick={() => openInVsCode(svc.io, path)}
        >
          Open in VS Code
        </Button>
      ) : null}
      {path && inTauri ? (
        <Button size="sm" variant="ghost" icon={<FolderOpen className="size-3.5" />} onClick={() => openFolder(path)}>
          Open folder
        </Button>
      ) : null}
      {path && (report?.checks.length ?? 0) > 0 ? <RunChecksButton projectId={project.id} /> : null}
    </div>
  );
}

/** The project's facts and tools, kept in one column so the header holds only the main actions. */
function Properties({
  project,
  report,
  ci,
}: {
  project: Project;
  report: Report | null | undefined;
  ci: keyof typeof CI_LABEL | undefined;
}) {
  const ciState = ci ?? "none";
  return (
    <aside className="flex w-[288px] shrink-0 flex-col gap-0.5 overflow-y-auto border-l border-line p-4">
      <BranchProperties projectId={project.id} git={report?.git} />
      <Property label="CI">
        {ciState === "none" ? (
          <span className="text-ghost">{CI_LABEL.none}</span>
        ) : (
          <Badge tone={CI_TONE[ciState]}>{CI_LABEL[ciState]}</Badge>
        )}
      </Property>
      {report ? (
        <>
          <Property label="Package manager">
            <Mono>{report.pm.version ? `${report.pm.name} ${report.pm.version}` : report.pm.name}</Mono>
          </Property>
          <Property label="Checked">
            <TimeAgo value={report.checkedAt ?? report.updatedAt} />
          </Property>
        </>
      ) : null}
      {project.remote ? <ExternalProperty label="Remote" remote={project.remote} /> : null}
      {report?.fork ? (
        <ExternalProperty label="Forked from" remote={report.fork.remote}>
          {report.fork.behind ? <span className="shrink-0 text-info">{report.fork.behind} behind</span> : null}
        </ExternalProperty>
      ) : null}
      <div className="-mx-4 my-3 h-px bg-line" />
      <ProjectTools project={project} report={report} />
    </aside>
  );
}

function TabContent({
  tab,
  project,
  report,
  onUpdateStarted,
}: {
  tab: Tab;
  project: Project;
  report: Report;
  onUpdateStarted: (runId: string) => void;
}) {
  switch (tab) {
    case "dependencies":
      return <Dependencies projectId={project.id} report={report} onStarted={onUpdateStarted} />;
    case "git":
      return <GitTab report={report} />;
    case "scripts":
      return <ScriptsTab project={project} report={report} />;
    case "runs":
      return <RunHistory projectId={project.id} />;
    default:
      return <ProjectSettings project={project} detectedChecks={report.checks} />;
  }
}

function ScriptsTab({ project, report }: { project: Project; report: Report }) {
  const { processes } = useApp();
  const list = useProcessList();
  const [shown, setShown] = useState<string>();
  const labelOf = (name: string) => `${project.name}: ${name}`;
  const run = (name: string) =>
    setShown(
      processes.start({
        label: labelOf(name),
        command: scriptCommand(report.pm, name),
        cwd: project.path,
        projectId: project.id,
      }),
    );
  const scripts = Object.entries(report.scripts);
  if (scripts.length === 0) return <Empty title="No scripts" />;
  return (
    <div className="flex flex-col">
      {scripts.map(([name, command]) => {
        const running = list.find((p) => p.running && p.projectId === project.id && p.label === labelOf(name));
        return (
          <div key={name} className="flex h-9 items-center gap-3 border-b border-line px-5 hover:bg-hover">
            <span className="w-40 shrink-0 font-medium">{name}</span>
            <Mono className="min-w-0 flex-1 truncate text-faint">{command}</Mono>
            {running ? (
              <Button
                size="sm"
                icon={<span className="size-2 rounded-full bg-ok" />}
                onClick={() => setShown(running.id)}
              >
                Running
              </Button>
            ) : (
              <Button size="sm" icon={<Play className="size-3.5" />} onClick={() => run(name)}>
                Run
              </Button>
            )}
          </div>
        );
      })}
      <ProcessDialog processId={shown} onClose={() => setShown(undefined)} onRestarted={setShown} />
    </div>
  );
}

function GitTab({ report }: { report: Report }) {
  const git = report.git;
  if (!git) return <Empty title="Not a git repository" />;
  // Relative to when the report was taken, which keeps render pure.
  const staleCutoff = Date.parse(report.updatedAt) - 90 * 86_400_000;
  return (
    <div className="flex flex-col">
      <div className="flex h-[30px] items-center border-b border-line px-5 text-sm text-muted">
        Branches <span className="ml-2 text-faint tabular">{report.branches.length}</span>
        <span className="ml-auto">
          Tracking {git.upstream ? <Mono className="text-fg">{git.upstream}</Mono> : "none"}
        </span>
      </div>
      {report.branches.map((branch) => (
        <div
          key={branch.name}
          className={cn(
            "flex h-9 items-center gap-2.5 border-b border-line px-5",
            branch.name === git.branch && "bg-selected",
          )}
        >
          <Mono className="text-fg">{branch.name}</Mono>
          {branch.upstreamGone ? <Badge tone="warn">upstream gone</Badge> : null}
          {branch.lastCommit.valueOf() < staleCutoff ? <Badge>stale</Badge> : null}
          {branch.ahead > 0 ? <Badge tone="info">{branch.ahead} unpushed</Badge> : null}
          <span className="ml-auto text-sm text-faint">
            <TimeAgo value={new Date(branch.lastCommit).toISOString()} />
          </span>
        </div>
      ))}
    </div>
  );
}

/** A run started in this session streams its output; older ones show what was saved when they finished. */
function RunLog({ runId, saved }: { runId: string; saved: string }) {
  const [live, setLive] = useState<string>();
  useEffect(() => subscribeRun(runId, (progress) => setLive(progress.log)), [runId]);
  const text = live && live.length >= saved.length ? live : saved;
  return <Log text={text} className="max-h-96" />;
}

function RunHistory({ projectId }: { projectId: string }) {
  const { svc } = useApp();
  const { data: runs } = useQuery({ queryKey: ["runs", projectId], queryFn: () => listRuns(svc, projectId) });
  const [open, setOpen] = useState<string>();
  if (!runs?.length) return <Empty title="No updates yet" />;
  return (
    <div className="flex flex-col">
      {runs.map((run) => (
        <div key={run.id} className="border-b border-line">
          <button
            type="button"
            aria-expanded={open === run.id}
            className="flex h-9 w-full items-center gap-2.5 px-5 text-left hover:bg-hover"
            onClick={() => setOpen(open === run.id ? undefined : run.id)}
          >
            {run.ok === null ? (
              <Spinner className="size-3.5" />
            ) : (
              <Badge tone={run.ok ? "ok" : "bad"}>{run.ok ? "passed" : "failed"}</Badge>
            )}
            <span className="truncate font-medium">{run.title}</span>
            <span className="ml-auto shrink-0 text-sm text-faint">
              <TimeAgo value={run.startedAt} />
            </span>
          </button>
          {open === run.id ? (
            <div className="px-5 pb-3">
              <RunLog runId={run.id} saved={run.log} />
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
