import { useMutation } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, Download } from "lucide-react";
import { useReports } from "@/app/queries";
import { useServices } from "@/app/services";
import { createGit } from "@/engine/git";
import { createLimit } from "@/engine/limit";
import { projectLink } from "@/modules/links";
import { refreshProject } from "@/services/projects";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { Empty, Page } from "@/ui/layout";
import { Mono } from "@/ui/misc";
import { toast, toastError } from "@/ui/toast";

export const Route = createFileRoute("/git")({ component: GitOverview });

const STALE_DAYS = 90;

function GitOverview() {
  const svc = useServices();
  const { data: rows } = useReports();
  const fetchAll = useMutation({
    mutationFn: async () => {
      const limit = createLimit(4);
      await Promise.all(
        (rows ?? []).map(({ project }) =>
          limit(async () => {
            if (!project.path) return;
            await createGit(svc.io, project.path)
              .fetch()
              .catch(() => undefined);
            await refreshProject(svc, project.id);
          }),
        ),
      );
    },
    onSuccess: () => toast("Fetched every remote."),
    onError: toastError,
  });

  const repos = (rows ?? []).filter(({ report }) => report?.git);
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
              <th className="pl-5 font-normal">Project</th>
              <th className="font-normal">Branch</th>
              <th className="font-normal">Local changes</th>
              <th className="font-normal">Remote</th>
              <th className="pr-5 font-normal">Branches to clean up</th>
            </tr>
          </thead>
          <tbody>
            {repos.map(({ project, report }) => {
              const git = report?.git;
              if (!git) return null;
              const staleCutoff = Date.parse(report?.updatedAt ?? "") - STALE_DAYS * 86_400_000;
              const stale = (report?.branches ?? []).filter(
                (b) => b.upstreamGone || new Date(b.lastCommit).valueOf() < staleCutoff,
              );
              const unpushed = (report?.branches ?? []).filter((b) => b.ahead > 0);
              return (
                <tr key={project.id} className="h-11 border-b border-line hover:bg-hover">
                  <td className="pl-5">
                    <Link {...projectLink(project.id)} className="font-medium">
                      {project.name}
                    </Link>
                  </td>
                  <td>
                    <Mono>{git.branch ?? "detached"}</Mono>
                  </td>
                  <td>
                    {git.changed + git.untracked + git.conflicted > 0 ? (
                      <span className="flex gap-1">
                        {git.changed ? <Badge tone="warn">{git.changed} modified</Badge> : null}
                        {git.untracked ? <Badge>{git.untracked} untracked</Badge> : null}
                        {git.conflicted ? <Badge tone="bad">{git.conflicted} conflicts</Badge> : null}
                      </span>
                    ) : (
                      <span className="text-faint">clean</span>
                    )}
                  </td>
                  <td>
                    {git.upstream ? (
                      <span className="flex items-center gap-2 text-muted">
                        <span className="flex items-center">
                          <ArrowUp className="size-3" />
                          {git.ahead}
                        </span>
                        <span className="flex items-center">
                          <ArrowDown className="size-3" />
                          {git.behind}
                        </span>
                        {unpushed.length > 0 ? <Badge tone="info">{unpushed.length} branches unpushed</Badge> : null}
                      </span>
                    ) : (
                      <span className="text-faint">no upstream</span>
                    )}
                  </td>
                  <td className="pr-5">
                    {stale.length > 0 ? (
                      <span className="truncate text-muted" title={stale.map((b) => b.name).join(", ")}>
                        {stale
                          .slice(0, 3)
                          .map((b) => b.name)
                          .join(", ")}
                        {stale.length > 3 ? ` +${stale.length - 3}` : ""}
                      </span>
                    ) : (
                      <span className="text-faint">none</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Page>
  );
}
