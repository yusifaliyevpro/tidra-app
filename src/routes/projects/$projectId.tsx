import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { openPath } from "@tauri-apps/plugin-opener";
import { ArrowLeft, Code, FolderOpen, Play, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useProject, useReport } from "@/app/queries";
import { useApp } from "@/app/services";
import { inTauri } from "@/core/native";
import { scriptCommand } from "@/engine/pm";
import { Dependencies } from "@/modules/projects/dependencies";
import { ProjectSettings } from "@/modules/projects/project-settings";
import { refreshProject } from "@/services/projects";
import { listRuns } from "@/services/updates";
import { Badge } from "@/ui/badge";
import { Button, IconButton } from "@/ui/button";
import { Card, Empty, ErrorNote, Page, Section } from "@/ui/layout";
import { Log } from "@/ui/log";
import { Mono, Tabs } from "@/ui/misc";
import { Spinner } from "@/ui/spinner";
import { TimeAgo } from "@/ui/time";
import { toast, toastError } from "@/ui/toast";

type Tab = "dependencies" | "git" | "scripts" | "runs" | "settings";

export const Route = createFileRoute("/projects/$projectId")({ component: ProjectPage });

type Project = NonNullable<ReturnType<typeof useProject>["data"]>;
type Report = NonNullable<ReturnType<typeof useReport>["data"]>;

function ProjectPage() {
  const { projectId } = Route.useParams();
  const { data: project, isPending } = useProject(projectId);
  const { data: report } = useReport(projectId);
  const [tab, setTab] = useState<Tab>("dependencies");

  if (isPending) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (!project) return <Empty title="Project not found" />;

  return (
    <Page
      title={
        <span className="flex items-center gap-2">
          <Link to="/projects" aria-label="Back to projects" className="text-muted hover:text-fg">
            <ArrowLeft className="size-4" />
          </Link>
          {project.name}
        </span>
      }
      subtitle={project.path}
      className="flex flex-col overflow-hidden"
      actions={<ProjectActions project={project} report={report} />}
    >
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
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
          <div className="p-5">
            <ErrorNote>{report.error}</ErrorNote>
          </div>
        ) : null}
        {report ? (
          <TabContent tab={tab} project={project} report={report} />
        ) : (
          <div className="flex justify-center p-10">
            <Spinner />
          </div>
        )}
      </div>
    </Page>
  );
}

function ProjectActions({ project, report }: { project: Project; report: Report | null | undefined }) {
  const { svc } = useApp();
  const refresh = useMutation({ mutationFn: () => refreshProject(svc, project.id), onError: toastError });
  const path = project.path;
  return (
    <>
      {report ? <span className="text-sm text-faint">{report.pm.name}</span> : null}
      {path && inTauri ? (
        <IconButton label="Open folder" icon={<FolderOpen className="size-4" />} onClick={() => void openPath(path)} />
      ) : null}
      {path ? (
        <IconButton
          label="Open in VS Code"
          icon={<Code className="size-4" />}
          onClick={() => void svc.io.run("code", [path])}
        />
      ) : null}
      <IconButton
        label="Check again"
        loading={refresh.isPending}
        icon={<RefreshCw className="size-4" />}
        onClick={() => refresh.mutate()}
      />
    </>
  );
}

function TabContent({ tab, project, report }: { tab: Tab; project: Project; report: Report }) {
  switch (tab) {
    case "dependencies":
      return <Dependencies key={report.updatedAt} projectId={project.id} path={project.path} report={report} />;
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
  const run = (name: string) => {
    processes.start({
      label: `${project.name}: ${name}`,
      command: scriptCommand(report.pm, name),
      cwd: project.path,
      projectId: project.id,
    });
    toast(`Started ${name}. See Scripts and ports.`);
  };
  return (
    <div className="flex flex-col p-5">
      {Object.entries(report.scripts).map(([name, command]) => (
        <div key={name} className="flex h-10 items-center gap-3 border-b border-line">
          <span className="w-40 shrink-0 font-medium">{name}</span>
          <Mono className="min-w-0 flex-1 truncate text-muted">{command}</Mono>
          <Button size="sm" icon={<Play className="size-3.5" />} onClick={() => run(name)}>
            Run
          </Button>
        </div>
      ))}
    </div>
  );
}

function GitTab({ report }: { report: Report }) {
  const git = report.git;
  if (!git) return <Empty title="Not a git repository" />;
  // Relative to when the report was taken, which keeps render pure.
  const staleCutoff = Date.parse(report.updatedAt) - 90 * 86_400_000;
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 p-5">
      <Card className="grid grid-cols-4 gap-4 p-4 text-sm">
        <div>
          <div className="text-faint">Branch</div>
          <div className="font-mono">{git.branch ?? "detached"}</div>
        </div>
        <div>
          <div className="text-faint">Upstream</div>
          <div className="font-mono">{git.upstream ?? "none"}</div>
        </div>
        <div>
          <div className="text-faint">Ahead / behind</div>
          <div className="tabular">
            {git.ahead} / {git.behind}
          </div>
        </div>
        <div>
          <div className="text-faint">Changed files</div>
          <div className="tabular">{git.changed + git.untracked}</div>
        </div>
      </Card>
      <Section title="Branches">
        <Card>
          {report.branches.map((branch) => (
            <div key={branch.name} className="flex h-9 items-center gap-2.5 border-b border-line px-4 last:border-b-0">
              <span className="font-mono text-sm">{branch.name}</span>
              {branch.upstreamGone ? <Badge tone="warn">upstream gone</Badge> : null}
              {branch.lastCommit.valueOf() < staleCutoff ? <Badge>stale</Badge> : null}
              {branch.ahead > 0 ? <Badge tone="info">{branch.ahead} unpushed</Badge> : null}
              <span className="ml-auto text-sm">
                <TimeAgo value={new Date(branch.lastCommit).toISOString()} />
              </span>
            </div>
          ))}
        </Card>
      </Section>
    </div>
  );
}

function RunHistory({ projectId }: { projectId: string }) {
  const { svc } = useApp();
  const { data: runs } = useQuery({ queryKey: ["runs", projectId], queryFn: () => listRuns(svc, projectId) });
  const [open, setOpen] = useState<string>();
  if (!runs?.length) return <Empty title="No updates yet" />;
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-2 p-5">
      {runs.map((run) => (
        <Card key={run.id}>
          <button
            type="button"
            className="flex h-10 w-full items-center gap-2.5 px-4 text-left"
            onClick={() => setOpen(open === run.id ? undefined : run.id)}
          >
            {run.ok === null ? (
              <Spinner className="size-3.5" />
            ) : (
              <Badge tone={run.ok ? "ok" : "bad"}>{run.ok ? "passed" : "failed"}</Badge>
            )}
            <span className="font-medium">{run.title}</span>
            <span className="ml-auto text-sm">
              <TimeAgo value={run.startedAt} />
            </span>
          </button>
          {open === run.id ? (
            <div className="border-t border-line p-3">
              <Log text={run.log} className="max-h-96" />
            </div>
          ) : null}
        </Card>
      ))}
    </div>
  );
}
