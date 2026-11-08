import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { cn } from "cn";
import { ArrowUp, CircleX, GitPullRequest, Pencil, Rocket, Tag, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { useHome, useJobs } from "@/app/queries";
import { useServices } from "@/app/services";
import { GitHubLimit } from "@/modules/github-limit";
import type { HomeSummary } from "@/services/home";
import { homeTasks, type HomeTask, type TaskTarget } from "@/services/home-tasks";
import { Button } from "@/ui/button";
import { ErrorBoundary } from "@/ui/error-boundary";
import { openExternal } from "@/ui/external";
import { Empty, Page } from "@/ui/layout";
import { SegmentBar, type Segment } from "@/ui/meter";
import { StatusGlyph } from "@/ui/status-glyph";
import { TimeAgo } from "@/ui/time";
import { toastError } from "@/ui/toast";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const { data: home } = useHome();
  return (
    <Page
      title="Home"
      actions={
        <>
          <GitHubLimit className="mr-1 text-xs text-faint" />
          <LastChecked />
          <CheckAll />
        </>
      }
    >
      {home ? <Dashboard home={home} /> : <DashboardSkeleton />}
    </Page>
  );
}

function LastChecked() {
  const { data: jobs = [] } = useJobs();
  const last = Math.max(0, ...jobs.map((j) => j.lastRun ?? 0));
  if (last === 0) return null;
  return (
    <span className="mr-1 text-sm text-faint">
      Checked <TimeAgo value={last} />
    </span>
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
      Check all
    </Button>
  );
}

function Dashboard({ home }: { home: HomeSummary }) {
  if (home.projects === 0) {
    return (
      <Empty
        title="No projects"
        action={
          <Link to="/projects" className="text-accent-text hover:underline">
            Add projects
          </Link>
        }
      />
    );
  }
  const tasks = homeTasks(home);
  return (
    <div className="mx-auto flex max-w-[1080px] flex-col gap-8 px-7 py-6">
      <ErrorBoundary>
        <Summary home={home} />
      </ErrorBoundary>
      <ErrorBoundary>{tasks.length > 0 ? <Tasks tasks={tasks} /> : <AllClear />}</ErrorBoundary>
    </div>
  );
}

function Figure({
  to,
  label,
  value,
  tone,
  children,
}: {
  to: "/projects" | "/security" | "/repos" | "/inbox";
  label: string;
  value: number;
  tone?: "bad";
  children?: ReactNode;
}) {
  return (
    <Link
      to={to}
      className="flex flex-col gap-1.5 border-l border-line px-4 py-3.5 transition-colors duration-[80ms] first:border-l-0 hover:bg-hover"
    >
      <span className="text-sm text-muted">{label}</span>
      <span
        className={cn(
          "text-xl font-medium tracking-[-0.01em] tabular",
          value === 0 ? "text-ghost" : tone === "bad" ? "text-bad" : "text-fg",
        )}
      >
        {value}
      </span>
      <span className="h-1">{value > 0 ? children : null}</span>
    </Link>
  );
}

function Summary({ home }: { home: HomeSummary }) {
  const { major, minor, patch } = home.updates;
  const s = home.security.bySeverity;
  const updates: Segment[] = [
    { value: major, color: "bg-bad", label: "major" },
    { value: minor, color: "bg-warn", label: "minor" },
    { value: patch, color: "bg-ok", label: "patch" },
  ];
  const advisories: Segment[] = [
    { value: s.critical + s.high, color: "bg-bad", label: "high or critical" },
    { value: s.moderate, color: "bg-warn", label: "moderate" },
    { value: s.low, color: "bg-ghost", label: "low" },
  ];
  return (
    <div className="grid grid-cols-4 overflow-hidden rounded-lg border border-line bg-surface">
      <Figure to="/projects" label="Outdated" value={major + minor + patch}>
        <SegmentBar segments={updates} />
      </Figure>
      <Figure
        to="/security"
        label="Advisories"
        value={home.security.total}
        tone={s.critical + s.high > 0 ? "bad" : undefined}
      >
        <SegmentBar segments={advisories} />
      </Figure>
      <Figure to="/repos" label="CI failing" value={home.ci.failing.length} tone="bad" />
      <Figure to="/inbox" label="Review requests" value={home.reviewRequests} />
    </div>
  );
}

const ICON = "size-3.5 shrink-0";

function TaskIcon({ kind }: { kind: HomeTask["kind"] }) {
  if (kind === "advisory") return <StatusGlyph status="alert" />;
  if (kind === "major") return <StatusGlyph status="major" />;
  if (kind === "minor") return <StatusGlyph status="minor" />;
  if (kind === "ci" || kind === "pulls-failing") return <CircleX className={cn(ICON, "text-bad")} strokeWidth={1.75} />;
  if (kind === "deploy") return <Rocket className={cn(ICON, "text-bad")} strokeWidth={1.75} />;
  if (kind === "review") return <GitPullRequest className={cn(ICON, "text-accent-text")} strokeWidth={1.75} />;
  if (kind === "uncommitted") return <Pencil className={cn(ICON, "text-warn")} strokeWidth={1.75} />;
  if (kind === "unpushed") return <ArrowUp className={cn(ICON, "text-info")} strokeWidth={1.75} />;
  return <Tag className={cn(ICON, "text-muted")} strokeWidth={1.75} />;
}

function useOpenTarget() {
  const navigate = useNavigate();
  return (target: TaskTarget) => {
    if (target.kind === "url") openExternal(target.url);
    else if (target.kind === "security") void navigate({ to: "/security", search: { project: target.projectId } });
    else if (target.kind === "project")
      void navigate({
        to: "/projects/$projectId",
        params: { projectId: target.projectId },
        search: { tab: target.tab },
      });
    else if (target.kind === "projects") void navigate({ to: "/projects", search: { filter: target.filter } });
    else if (target.kind === "inbox") void navigate({ to: "/inbox" });
    else void navigate({ to: "/changelogs" });
  };
}

function Tasks({ tasks }: { tasks: HomeTask[] }) {
  const open = useOpenTarget();
  return (
    <section className="flex flex-col">
      <h2 className="flex items-center gap-2 pb-2 text-sm font-medium text-muted">
        Needs you <span className="font-normal text-faint tabular">{tasks.length}</span>
      </h2>
      <div className="border-t border-line">
        {tasks.map((task, index) => (
          <div
            key={task.key}
            className="group flex h-9 items-center gap-2.5 border-b border-line pr-1 pl-2 transition-colors duration-[80ms] hover:bg-hover"
          >
            <span className="flex size-4 items-center justify-center">
              <TaskIcon kind={task.kind} />
            </span>
            <span className="min-w-0 truncate">
              {task.title[0]}
              <span className="font-medium">{task.title[1]}</span>
              {task.title[2]}
            </span>
            {task.detail ? <span className="min-w-0 truncate text-sm text-faint">{task.detail}</span> : null}
            <Button
              size="sm"
              variant={index === 0 ? "primary" : "secondary"}
              className="ml-auto"
              onClick={() => open(task.target)}
            >
              {task.action}
            </Button>
          </div>
        ))}
      </div>
    </section>
  );
}

function AllClear() {
  return (
    <div className="flex h-24 items-center justify-center gap-2">
      <StatusGlyph status="ok" />
      All clear
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="mx-auto flex max-w-[1080px] appear-late flex-col gap-8 px-7 py-6">
      <div className="h-[92px] rounded-lg border border-line bg-surface" />
      <div className="flex flex-col">
        {[64, 48, 56, 40, 52].map((w) => (
          <div key={w} className="flex h-9 items-center gap-2.5 border-b border-line pl-2">
            <span className="size-3.5 rounded-full bg-selected" />
            <span className="h-2.5 rounded-sm bg-selected" style={{ width: `${w}%` }} />
          </div>
        ))}
      </div>
    </div>
  );
}
