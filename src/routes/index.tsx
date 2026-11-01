import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { cn } from "cn";
import {
  ArrowDown,
  ArrowUp,
  CircleCheck,
  CircleX,
  FolderGit2,
  GitPullRequest,
  Play,
  RefreshCw,
  ShieldAlert,
  Activity as ActivityIcon,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { useHome, useJobs } from "@/app/queries";
import { useServices } from "@/app/services";
import { GitHubLimit } from "@/modules/github-limit";
import { projectLink } from "@/modules/links";
import { UpdateCells, UpdateHeader } from "@/modules/projects/update-cells";
import type { CiState, HomeSummary, ProjectHealth } from "@/services/home";
import { Button, IconButton } from "@/ui/button";
import { ErrorBoundary } from "@/ui/error-boundary";
import { openExternal } from "@/ui/external";
import { Page } from "@/ui/layout";
import { Legend, SegmentBar, type Segment } from "@/ui/meter";
import { Spinner } from "@/ui/spinner";
import { TimeAgo } from "@/ui/time";
import { toastError } from "@/ui/toast";

export const Route = createFileRoute("/")({ component: Home });

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function Home() {
  const { data: home } = useHome();
  return (
    <Page
      title="Overview"
      subtitle={home ? plural(home.projects, "project") : undefined}
      actions={
        <>
          <GitHubLimit className="mr-1 text-xs text-faint" />
          <CheckAll />
        </>
      }
    >
      {home ? <Dashboard home={home} /> : <DashboardSkeleton />}
    </Page>
  );
}

function CheckAll() {
  const svc = useServices();
  const queryClient = useQueryClient();
  const { data: jobs = [] } = useJobs();
  const run = useMutation({
    mutationFn: async () => {
      await svc.scheduler.runAll();
      await queryClient.invalidateQueries();
    },
    onError: toastError,
  });
  const busy = run.isPending || jobs.some((j) => j.running);
  return (
    <Button size="sm" icon={<RefreshCw className="size-3.5" />} loading={busy} onClick={() => run.mutate()}>
      Check everything
    </Button>
  );
}

function Dashboard({ home }: { home: HomeSummary }) {
  return (
    <div className="mx-auto flex max-w-[1180px] flex-col gap-5 p-6">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <ErrorBoundary>
          <UpdatesTile home={home} />
        </ErrorBoundary>
        <ErrorBoundary>
          <SecurityTile home={home} />
        </ErrorBoundary>
        <ErrorBoundary>
          <CiTile home={home} />
        </ErrorBoundary>
        <ErrorBoundary>
          <PullsTile home={home} />
        </ErrorBoundary>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_320px] items-start gap-5">
        <ErrorBoundary>
          <AttentionTable health={home.health} total={home.projects} />
        </ErrorBoundary>
        <div className="flex flex-col gap-5">
          <ErrorBoundary>
            <RecentRuns runs={home.runs} />
          </ErrorBoundary>
          <ErrorBoundary>
            <Releases releases={home.releases} />
          </ErrorBoundary>
          <ErrorBoundary>
            <BackgroundJobs />
          </ErrorBoundary>
        </div>
      </div>
    </div>
  );
}

function Tile({
  to,
  icon: Icon,
  label,
  value,
  tone,
  children,
}: {
  to: "/projects" | "/security" | "/ci" | "/inbox";
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  tone?: "bad" | "warn" | "ok";
  children: ReactNode;
}) {
  return (
    <Link
      to={to}
      className="flex min-h-[132px] flex-col gap-3 rounded-lg border border-line bg-surface p-4 transition-colors hover:border-line-strong hover:bg-raised"
    >
      <span className="flex items-center gap-2 text-sm text-muted">
        <Icon className="size-4 text-faint" strokeWidth={1.5} />
        {label}
      </span>
      <span
        className={cn(
          "text-2xl font-semibold tabular",
          tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : tone === "ok" ? "text-ok" : "text-fg",
        )}
      >
        {value}
      </span>
      <div className="mt-auto flex flex-col gap-2">{children}</div>
    </Link>
  );
}

function UpdatesTile({ home }: { home: HomeSummary }) {
  const { major, minor, patch, projects } = home.updates;
  const segments: Segment[] = [
    { value: major, color: "bg-bad", label: "major" },
    { value: minor, color: "bg-warn", label: "minor" },
    { value: patch, color: "bg-ok", label: "patch" },
  ];
  const total = major + minor + patch;
  return (
    <Tile
      to="/projects"
      icon={FolderGit2}
      label="Outdated packages"
      value={total}
      tone={total === 0 ? "ok" : undefined}
    >
      {total > 0 ? (
        <>
          <SegmentBar segments={segments} />
          <Legend segments={segments} />
        </>
      ) : (
        <span className="text-xs text-muted">Every project is up to date</span>
      )}
      {total > 0 ? <span className="sr-only">{plural(projects, "project")}</span> : null}
    </Tile>
  );
}

function SecurityTile({ home }: { home: HomeSummary }) {
  const s = home.security.bySeverity;
  const segments: Segment[] = [
    { value: s.critical + s.high, color: "bg-bad", label: "high" },
    { value: s.moderate, color: "bg-warn", label: "moderate" },
    { value: s.low, color: "bg-faint", label: "low" },
  ];
  return (
    <Tile
      to="/security"
      icon={ShieldAlert}
      label="Advisories"
      value={home.security.total}
      tone={s.critical + s.high > 0 ? "bad" : home.security.total === 0 ? "ok" : "warn"}
    >
      {home.security.total > 0 ? (
        <>
          <SegmentBar segments={segments} />
          <Legend segments={segments} />
        </>
      ) : (
        <span className="text-xs text-muted">No known advisories</span>
      )}
    </Tile>
  );
}

const CI_DOT: Record<CiState, string> = {
  success: "bg-ok",
  failure: "bg-bad",
  pending: "bg-warn",
  none: "bg-white/10",
};

function CiTile({ home }: { home: HomeSummary }) {
  const repos = home.ci.repos.filter((r) => r.state !== "none");
  const failing = repos.filter((r) => r.state === "failure").length;
  return (
    <Tile
      to="/ci"
      icon={ActivityIcon}
      label="CI on default branch"
      value={repos.length === 0 ? "—" : failing > 0 ? `${failing} failing` : "Passing"}
      tone={failing > 0 ? "bad" : repos.length > 0 ? "ok" : undefined}
    >
      <span className="flex flex-wrap gap-1">
        {repos.map((r) => (
          <span key={r.repo} title={`${r.name}: ${r.state}`} className={cn("size-2.5 rounded-sm", CI_DOT[r.state])} />
        ))}
      </span>
      <span className="truncate text-xs text-muted">
        {repos.length === 0
          ? "No GitHub Actions runs yet"
          : failing > 0
            ? repos
                .filter((r) => r.state === "failure")
                .map((r) => r.name)
                .join(", ")
            : `${repos.length} repos green`}
      </span>
    </Tile>
  );
}

function PullsTile({ home }: { home: HomeSummary }) {
  const rows = [
    { label: "Yours", value: home.myPulls, bad: home.myPullsFailing },
    { label: "Review requests", value: home.reviewRequests },
    { label: "Bot PRs", value: home.botPulls },
  ];
  return (
    <Tile to="/inbox" icon={GitPullRequest} label="Pull requests" value={home.myPulls + home.reviewRequests}>
      <span className="flex flex-col gap-1 text-xs">
        {rows.map((row) => (
          <span key={row.label} className="flex items-center justify-between text-muted">
            {row.label}
            <span className="tabular">
              {row.bad ? <span className="mr-2 text-bad">{row.bad} failing</span> : null}
              <span className="text-fg">{row.value}</span>
            </span>
          </span>
        ))}
      </span>
    </Tile>
  );
}

function Panel({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-line bg-surface">
      <header className="flex h-10 shrink-0 items-center justify-between border-b border-line px-4">
        <h2 className="text-sm font-medium">{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}

function AttentionTable({ health, total }: { health: ProjectHealth[]; total: number }) {
  const navigate = useNavigate();
  const rows = health.filter((h) => h.score > 0).slice(0, 12);
  return (
    <Panel
      title="Needs attention"
      action={
        <Link to="/projects" className="text-xs text-muted hover:text-fg">
          All {total} projects
        </Link>
      }
    >
      {rows.length === 0 ? (
        <div className="flex h-24 items-center justify-center gap-2 text-muted">
          <CircleCheck className="size-4 text-ok" />
          All clear
        </div>
      ) : (
        <table className="w-full table-fixed text-left">
          <thead className="text-xs text-faint">
            <tr className="h-8 border-b border-line">
              <th className="pl-4 font-normal">Project</th>
              <th className="w-[200px] font-normal">
                <UpdateHeader />
              </th>
              <th className="w-[96px] font-normal">Advisories</th>
              <th className="w-[150px] pr-4 font-normal">Git</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((h) => (
              <tr
                key={h.id}
                onClick={() => void navigate(projectLink(h.id))}
                className="h-11 border-b border-line last:border-b-0 hover:bg-hover"
              >
                <td className="pl-4">
                  <Link {...projectLink(h.id)} className="flex min-w-0 items-center gap-2">
                    {h.ci !== "none" ? (
                      <span title={`CI ${h.ci}`} className={cn("size-1.5 shrink-0 rounded-full", CI_DOT[h.ci])} />
                    ) : (
                      <span className="size-1.5 shrink-0" />
                    )}
                    <span className="truncate font-medium">{h.name}</span>
                    {h.repo ? <span className="truncate text-xs text-faint">{h.repo}</span> : null}
                  </Link>
                </td>
                <td>
                  <UpdateCells updates={h.updates} />
                </td>
                <td>
                  <SecurityCell health={h} />
                </td>
                <td className="pr-4">
                  <GitCell health={h} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

function SecurityCell({ health }: { health: ProjectHealth }) {
  const { security } = health;
  if (security.total === 0) return <span className="text-sm text-white/15">0</span>;
  const urgent = security.critical + security.high;
  return (
    <span
      className={cn("text-sm tabular", urgent > 0 ? "text-bad" : "text-warn")}
      title={`${security.critical} critical, ${security.high} high, ${security.moderate} moderate, ${security.low} low`}
    >
      {security.total}
    </span>
  );
}

function GitCell({ health }: { health: ProjectHealth }) {
  if (!health.branch) return <span className="text-sm text-faint">{health.error ? "Error" : "No git"}</span>;
  return (
    <span className="flex min-w-0 items-center gap-2 text-xs text-muted">
      <span className="truncate font-mono">{health.branch}</span>
      {health.changed > 0 ? <span className="shrink-0 text-warn">{health.changed}✎</span> : null}
      {health.ahead > 0 ? (
        <span className="flex shrink-0 items-center text-info">
          <ArrowUp className="size-3" />
          {health.ahead}
        </span>
      ) : null}
      {health.behind > 0 ? (
        <span className="flex shrink-0 items-center">
          <ArrowDown className="size-3" />
          {health.behind}
        </span>
      ) : null}
    </span>
  );
}

function RecentRuns({ runs }: { runs: HomeSummary["runs"] }) {
  return (
    <Panel title="Recent updates">
      {runs.length === 0 ? (
        <p className="px-4 py-4 text-sm text-muted">Updates you run show up here</p>
      ) : (
        runs.slice(0, 5).map((run) => (
          <Link
            key={run.id}
            {...projectLink(run.projectId)}
            className="flex h-11 items-center gap-2.5 border-b border-line px-4 last:border-b-0 hover:bg-hover"
          >
            {run.ok === null ? (
              <Spinner className="size-3.5" />
            ) : run.ok ? (
              <CircleCheck className="size-4 shrink-0 text-ok" />
            ) : (
              <CircleX className="size-4 shrink-0 text-bad" />
            )}
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm">{run.project}</span>
              <span className="truncate text-xs text-faint">{run.title}</span>
            </span>
            <span className="shrink-0 text-xs">
              <TimeAgo value={run.startedAt} />
            </span>
          </Link>
        ))
      )}
    </Panel>
  );
}

function Releases({ releases }: { releases: HomeSummary["releases"] }) {
  return (
    <Panel
      title="New releases"
      action={
        <Link to="/changelogs" className="text-xs text-muted hover:text-fg">
          Changelogs
        </Link>
      }
    >
      {releases.length === 0 ? (
        <p className="px-4 py-4 text-sm text-muted">Watch packages in Changelogs to follow their releases</p>
      ) : (
        releases.slice(0, 5).map((r) => (
          <button
            key={`${r.repo}@${r.tag}`}
            type="button"
            onClick={() => r.url && openExternal(r.url)}
            className="flex h-10 w-full items-center gap-2 border-b border-line px-4 text-left last:border-b-0 hover:bg-hover"
          >
            <span className="min-w-0 flex-1 truncate text-sm">{r.packageName ?? r.repo}</span>
            <span className={cn("shrink-0 font-mono text-xs", r.major ? "text-bad" : "text-muted")}>{r.tag}</span>
            <span className="w-16 shrink-0 text-right text-xs">
              <TimeAgo value={r.publishedAt} />
            </span>
          </button>
        ))
      )}
    </Panel>
  );
}

function BackgroundJobs() {
  const svc = useServices();
  const queryClient = useQueryClient();
  const { data: jobs = [] } = useJobs();
  const run = useMutation({
    mutationFn: async (id: string) => {
      await svc.scheduler.runNow(id);
      await queryClient.invalidateQueries();
    },
    onError: toastError,
  });
  return (
    <Panel title="Background checks">
      {jobs.map((job) => (
        <div key={job.id} className="flex h-9 items-center gap-2 border-b border-line pr-2 pl-4 last:border-b-0">
          <span className="min-w-0 flex-1 truncate text-sm text-muted" title={job.lastError ?? job.title}>
            {job.title}
          </span>
          {job.lastError ? (
            <span className="text-xs text-bad" title={job.lastError}>
              Failed
            </span>
          ) : job.lastRun ? (
            <span className="text-xs">
              <TimeAgo value={job.lastRun} />
            </span>
          ) : null}
          <IconButton
            size="sm"
            label={`Run ${job.title} now`}
            loading={job.running || (run.isPending && run.variables === job.id)}
            icon={<Play className="size-3" />}
            onClick={() => run.mutate(job.id)}
          />
        </div>
      ))}
    </Panel>
  );
}

function DashboardSkeleton() {
  return (
    <div className="mx-auto flex max-w-[1180px] appear-late flex-col gap-5 p-6">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {["a", "b", "c", "d"].map((k) => (
          <div key={k} className="h-[132px] rounded-lg border border-line bg-surface" />
        ))}
      </div>
      <div className="h-80 rounded-lg border border-line bg-surface" />
    </div>
  );
}
