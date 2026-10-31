import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useSecurity } from "@/app/queries";
import { useServices } from "@/app/services";
import { dismissals } from "@/core/db/schema";
import { severityRank, wouldFailCi, type Finding } from "@/engine/advisories";
import { JobRefresh } from "@/modules/common";
import { projectLink } from "@/modules/links";
import { UpdateRunDialog } from "@/modules/projects/update-run";
import { fixDirect, fixWithOverride } from "@/modules/security/fix";
import { Badge, SeverityBadge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { Dialog } from "@/ui/dialog";
import { Field, Input } from "@/ui/field";
import { Card, Empty, ErrorNote, Page } from "@/ui/layout";
import { ExternalLink } from "@/ui/markdown";
import { Mono } from "@/ui/misc";
import { Spinner } from "@/ui/spinner";
import { toast, toastError } from "@/ui/toast";

export const Route = createFileRoute("/security")({ component: Security });

function Security() {
  const svc = useServices();
  const queryClient = useQueryClient();
  const { data, isPending } = useSecurity();
  const [run, setRun] = useState<{ runId: string; projectId: string }>();
  const [dismissing, setDismissing] = useState<Finding>();
  const [reason, setReason] = useState("");

  const fix = useMutation({
    mutationFn: async ({ projectId, finding }: { projectId: string; finding: Finding }) => {
      if (finding.direct) return { projectId, runId: await fixDirect(svc, projectId, finding) };
      await fixWithOverride(svc, projectId, finding);
      return { projectId, runId: undefined };
    },
    onSuccess: async (result) => {
      if (result.runId) setRun({ runId: result.runId, projectId: result.projectId });
      else toast("Override added and committed.");
      await queryClient.invalidateQueries({ queryKey: ["security"] });
    },
    onError: toastError,
  });

  const dismiss = useMutation({
    mutationFn: async (finding: Finding) => {
      await svc.store.db
        .insert(dismissals)
        .values({ id: finding.id, target: finding.id, reason, hlc: svc.clock.tick(), deviceId: svc.clock.deviceId })
        .onConflictDoUpdate({
          target: dismissals.id,
          set: { deleted: false, reason, hlc: svc.clock.tick(), deviceId: svc.clock.deviceId },
        });
    },
    onSuccess: async () => {
      setDismissing(undefined);
      setReason("");
      await queryClient.invalidateQueries({ queryKey: ["security"] });
      await queryClient.invalidateQueries({ queryKey: ["home"] });
    },
  });

  const threshold = data?.threshold;
  const reports = (data?.reports ?? []).map(({ project, report }) => ({
    project,
    report,
    findings: (report?.findings ?? [])
      .filter((f) => !data?.dismissed.has(f.id))
      .toSorted((a, b) => severityRank(b.severity) - severityRank(a.severity) || Number(a.dev) - Number(b.dev)),
  }));
  const total = reports.reduce((sum, r) => sum + r.findings.length, 0);

  return (
    <Page
      title="Security"
      subtitle={
        threshold ? `CI fails at ${threshold.level}${threshold.prodOnly ? ", production only" : ""}` : undefined
      }
      actions={<JobRefresh jobId="security" label="Scan again" />}
    >
      {isPending ? (
        <div className="flex justify-center p-10">
          <Spinner />
        </div>
      ) : total === 0 ? (
        <Empty icon={<ShieldCheck />} title="No known advisories" />
      ) : (
        <div className="mx-auto flex max-w-5xl flex-col gap-5 p-5">
          {reports
            .filter((r) => r.findings.length > 0 || r.report?.error)
            .map(({ project, report, findings }) => {
              const failing = threshold ? wouldFailCi(findings, threshold) : false;
              return (
                <Card key={project.id}>
                  <div className="flex h-11 items-center gap-2.5 border-b border-line px-4">
                    <Link {...projectLink(project.id)} className="font-medium hover:underline">
                      {project.name}
                    </Link>
                    <span className="text-sm text-muted">
                      {findings.length} advisories in {report?.scanned ?? 0} packages
                    </span>
                    {failing ? <Badge tone="bad">would fail CI</Badge> : <Badge tone="ok">passes CI</Badge>}
                  </div>
                  {report?.error ? (
                    <div className="p-3">
                      <ErrorNote>{report.error}</ErrorNote>
                    </div>
                  ) : null}
                  {findings.map((finding) => (
                    <div
                      key={`${finding.id}:${finding.name}@${finding.version}`}
                      className="flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-b-0"
                    >
                      <SeverityBadge severity={finding.severity} />
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate">{finding.summary}</span>
                        <span className="flex items-center gap-2 text-xs text-faint">
                          <Mono className="text-xs text-muted">
                            {finding.name}@{finding.version}
                          </Mono>
                          {finding.dev ? <span>dev only</span> : null}
                          {finding.direct ? <span>direct</span> : <span>transitive</span>}
                          <ExternalLink href={finding.url} className="hover:text-fg">
                            {finding.aliases.find((a) => a.startsWith("CVE")) ?? finding.id}
                          </ExternalLink>
                        </span>
                      </div>
                      {finding.fixedIn ? (
                        <Button
                          size="sm"
                          loading={fix.isPending && fix.variables?.finding === finding}
                          onClick={() => fix.mutate({ projectId: project.id, finding })}
                        >
                          {finding.direct ? `Update to ${finding.fixedIn}` : `Override to ${finding.fixedIn}`}
                        </Button>
                      ) : (
                        <span className="text-xs text-faint">No fix yet</span>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => setDismissing(finding)}>
                        Dismiss
                      </Button>
                    </div>
                  ))}
                </Card>
              );
            })}
        </div>
      )}
      <Dialog
        open={Boolean(dismissing)}
        onClose={() => setDismissing(undefined)}
        title="Dismiss advisory"
        footer={
          <Button
            variant="primary"
            loading={dismiss.isPending}
            onClick={() => dismissing && dismiss.mutate(dismissing)}
          >
            Dismiss everywhere
          </Button>
        }
      >
        <Field label="Reason" hint="Stops counting toward the CI badge.">
          {(id) => (
            <Input
              id={id}
              value={reason}
              placeholder="Not reachable in our code path"
              onChange={(e) => setReason(e.target.value)}
            />
          )}
        </Field>
      </Dialog>
      {run ? <UpdateRunDialog runId={run.runId} projectId={run.projectId} onClose={() => setRun(undefined)} /> : null}
    </Page>
  );
}
