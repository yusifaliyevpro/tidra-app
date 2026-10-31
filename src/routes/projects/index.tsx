import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, FolderGit2, GitBranch, PackageCheck, Plus } from "lucide-react";
import { Fragment, useState } from "react";
import { useReports, useSecurity } from "@/app/queries";
import { useListKeys } from "@/app/shortcuts";
import { wouldFailCi } from "@/engine/advisories";
import { repoLabel } from "@/engine/discover";
import type { GitStatus } from "@/engine/git";
import { JobRefresh } from "@/modules/common";
import { projectLink } from "@/modules/links";
import { AddProjectsDialog } from "@/modules/projects/add-project";
import { BatchUpdateDialog } from "@/modules/projects/batch-update";
import type { readAllReports } from "@/services/projects";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { Empty, Page } from "@/ui/layout";
import { Spinner } from "@/ui/spinner";
import { TimeAgo } from "@/ui/time";

export const Route = createFileRoute("/projects/")({ component: Projects });

function Projects() {
  const navigate = useNavigate();
  const { data: rows, isPending } = useReports();
  const { data: security } = useSecurity();
  const [adding, setAdding] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [selected, setSelected] = useState<string>();

  const groups = groupProjects(rows ?? []);
  const ids = groups.flatMap(([, members]) => members.map((r) => r.project.id));
  useListKeys({
    ids,
    selected,
    onSelect: setSelected,
    onOpen: (id) => void navigate(projectLink(id)),
  });

  const failingCi = new Set(
    (security?.reports ?? [])
      .filter(({ report }) =>
        wouldFailCi(
          (report?.findings ?? []).filter((f) => !security?.dismissed.has(f.id)),
          security?.threshold ?? { level: "high", prodOnly: true },
        ),
      )
      .map(({ project }) => project.id),
  );

  return (
    <Page
      title="Projects"
      subtitle={rows ? `${rows.length}` : undefined}
      actions={
        <>
          <JobRefresh jobId="projects" />
          <Button
            icon={<PackageCheck className="size-4" />}
            disabled={!rows?.some(({ report }) => (report?.outdated.length ?? 0) > 0)}
            onClick={() => setUpdating(true)}
          >
            Update all
          </Button>
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>
            Add projects
          </Button>
        </>
      }
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
        <table className="w-full text-left">
          <thead className="sticky top-0 bg-bg text-xs text-faint">
            <tr className="h-8 border-b border-line">
              <th className="pl-5 font-normal">Project</th>
              <th className="font-normal">Branch</th>
              <th className="font-normal">Updates</th>
              <th className="font-normal">Security</th>
              <th className="pr-5 text-right font-normal">Checked</th>
            </tr>
          </thead>
          <tbody>
            {groups.map(([group, members]) => (
              <Fragment key={group ?? ""}>
                {group ? (
                  <tr className="h-8 border-b border-line bg-surface">
                    <td colSpan={5} className="pl-5 text-xs font-medium text-muted">
                      {group}
                    </td>
                  </tr>
                ) : null}
                {members.map(({ project, report }) => (
                  <ProjectRow
                    key={project.id}
                    project={project}
                    report={report}
                    selected={selected === project.id}
                    failingCi={failingCi.has(project.id)}
                  />
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
      <AddProjectsDialog open={adding} onClose={() => setAdding(false)} />
      <BatchUpdateDialog open={updating} rows={rows ?? []} onClose={() => setUpdating(false)} />
    </Page>
  );
}

type Row = Awaited<ReturnType<typeof readAllReports>>[number];

/** Projects that live in a subfolder of a repo are listed under the repo; standalone ones come first. */
function groupProjects(rows: Row[]): [string | undefined, Row[]][] {
  const groups = new Map<string | undefined, Row[]>();
  for (const row of rows) {
    const { remote, subdir, path } = row.project;
    const key = subdir ? repoLabel(remote, path ? path.slice(0, -(subdir.length + 1)) : undefined) : undefined;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups].toSorted(([a], [b]) => (a === undefined ? -1 : b === undefined ? 1 : a.localeCompare(b)));
}

function ProjectRow({ project, report, selected, failingCi }: Row & { selected: boolean; failingCi: boolean }) {
  return (
    <tr
      data-row-id={project.id}
      data-selected={selected || undefined}
      className="h-11 border-b border-line transition-colors hover:bg-hover data-selected:bg-raised"
    >
      <td className="pl-5">
        <Link {...projectLink(project.id)} className="flex flex-col">
          <span className="font-medium">{project.name}</span>
          <span className="truncate text-xs text-faint">
            {project.subdir || (project.remote ?? project.path ?? "No folder on this device")}
          </span>
        </Link>
      </td>
      <td>{report?.git ? <GitSummary git={report.git} /> : null}</td>
      <td>
        <UpdateCounts report={report} />
      </td>
      <td>{failingCi ? <Badge tone="bad">would fail CI</Badge> : null}</td>
      <td className="pr-5 text-right text-sm">
        <TimeAgo value={report?.updatedAt} />
      </td>
    </tr>
  );
}

function GitSummary({ git }: { git: GitStatus }) {
  const changed = git.changed + git.untracked;
  return (
    <span className="flex items-center gap-1.5 text-sm text-muted">
      <GitBranch className="size-3.5" />
      {git.branch ?? "detached"}
      {changed > 0 ? <Badge tone="warn">{changed} changed</Badge> : null}
      {git.ahead > 0 ? (
        <span className="flex items-center text-xs">
          <ArrowUp className="size-3" />
          {git.ahead}
        </span>
      ) : null}
      {git.behind > 0 ? (
        <span className="flex items-center text-xs">
          <ArrowDown className="size-3" />
          {git.behind}
        </span>
      ) : null}
    </span>
  );
}

function UpdateCounts({ report }: { report: Row["report"] }) {
  if (report?.error) {
    return (
      <Badge tone="bad" title={report.error}>
        error
      </Badge>
    );
  }
  if (!report) return <span className="text-sm text-faint">checking…</span>;
  const count = (bump: string) => report.outdated.filter((e) => e.bump === bump).length;
  const major = count("major");
  const minor = count("minor");
  const patch = report.outdated.length - major - minor;
  if (report.outdated.length === 0) return <span className="text-sm text-faint">up to date</span>;
  return (
    <span className="flex gap-1">
      {major ? <Badge tone="bad">{major} major</Badge> : null}
      {minor ? <Badge tone="warn">{minor} minor</Badge> : null}
      {patch ? <Badge tone="ok">{patch} patch</Badge> : null}
    </span>
  );
}
