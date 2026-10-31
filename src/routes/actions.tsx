import { useMutation } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Workflow } from "lucide-react";
import { useActions } from "@/app/queries";
import { useServices } from "@/app/services";
import { JobRefresh } from "@/modules/common";
import { projectLink } from "@/modules/links";
import { applyActionUpdatesToProject, type ActionItem } from "@/services/actions";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { Card, Empty, ErrorNote, Page } from "@/ui/layout";
import { Mono } from "@/ui/misc";
import { Spinner } from "@/ui/spinner";
import { toast, toastError } from "@/ui/toast";

export const Route = createFileRoute("/actions")({ component: Actions });

const shortRef = (ref: string) => (/^[0-9a-f]{40}$/.test(ref) ? ref.slice(0, 7) : ref);

function Actions() {
  const svc = useServices();
  const { data: rows, isPending } = useActions();
  const apply = useMutation({
    mutationFn: ({ projectId, items }: { projectId: string; items: ActionItem[] }) =>
      applyActionUpdatesToProject(svc, projectId, items),
    onSuccess: () => toast("Workflows updated and committed."),
    onError: toastError,
  });

  const withItems = (rows ?? []).filter(({ report }) => (report?.items.length ?? 0) > 0 || report?.error);

  return (
    <Page title="Actions versions" subtitle=".github/workflows" actions={<JobRefresh jobId="actions" />}>
      {isPending ? (
        <div className="flex justify-center p-10">
          <Spinner />
        </div>
      ) : withItems.length === 0 ? (
        <Empty icon={<Workflow />} title="No workflows" />
      ) : (
        <div className="mx-auto flex max-w-5xl flex-col gap-5 p-5">
          {withItems.map(({ project, report }) => {
            const outdated = (report?.items ?? []).filter((i) => i.next);
            return (
              <Card key={project.id}>
                <div className="flex h-11 items-center gap-2.5 border-b border-line px-4">
                  <Link {...projectLink(project.id)} className="font-medium hover:underline">
                    {project.name}
                  </Link>
                  {outdated.length > 0 ? (
                    <Badge tone="warn">{outdated.length} outdated</Badge>
                  ) : (
                    <Badge tone="ok">up to date</Badge>
                  )}
                  {outdated.length > 0 ? (
                    <Button
                      size="sm"
                      variant="primary"
                      className="ml-auto"
                      loading={apply.isPending && apply.variables?.projectId === project.id}
                      onClick={() => apply.mutate({ projectId: project.id, items: outdated })}
                    >
                      Update and commit
                    </Button>
                  ) : null}
                </div>
                {report?.error ? (
                  <div className="p-3">
                    <ErrorNote>{report.error}</ErrorNote>
                  </div>
                ) : null}
                {(report?.items ?? []).map((item) => (
                  <div
                    key={`${item.file}:${item.line}`}
                    className="flex h-9 items-center gap-3 border-b border-line px-4 text-sm last:border-b-0"
                  >
                    <span className="w-72 truncate font-medium">{item.action}</span>
                    <span className="w-40 truncate text-faint">{item.file.replace(".github/workflows/", "")}</span>
                    <Mono className="text-muted">
                      {shortRef(item.ref)}
                      {item.style === "sha" && item.comment ? ` # ${item.comment}` : ""}
                    </Mono>
                    {item.next ? (
                      <>
                        <ArrowRight className="size-3 text-faint" />
                        <Mono className="text-warn">
                          {shortRef(item.next.ref)}
                          {item.next.comment ? ` # ${item.next.comment}` : ""}
                        </Mono>
                      </>
                    ) : item.style === "branch" ? (
                      <span className="text-xs text-faint">tracks a branch</span>
                    ) : null}
                  </div>
                ))}
              </Card>
            );
          })}
        </div>
      )}
    </Page>
  );
}
