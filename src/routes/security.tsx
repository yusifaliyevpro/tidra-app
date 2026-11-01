import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import * as z from "@zod/mini";
import { cn } from "cn";
import { ChevronRight, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useSecurity } from "@/app/queries";
import { useServices } from "@/app/services";
import { useListKeys } from "@/app/shortcuts";
import { dismissals } from "@/core/db/schema";
import { groupFindings, severityRank, wouldFailCi, type Finding, type FindingGroup } from "@/engine/advisories";
import { JobRefresh } from "@/modules/common";
import { projectLink } from "@/modules/links";
import { UpdateRunDialog } from "@/modules/projects/update-run";
import { fixDirect, fixWithOverride } from "@/modules/security/fix";
import { SeverityBadge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { Dialog } from "@/ui/dialog";
import { ErrorBoundary } from "@/ui/error-boundary";
import { Field, Input } from "@/ui/field";
import { Empty, ErrorNote, Page, Split } from "@/ui/layout";
import { ExternalLink } from "@/ui/markdown";
import { SegmentBar } from "@/ui/meter";
import { Mono } from "@/ui/misc";
import { Spinner } from "@/ui/spinner";
import { toast, toastError } from "@/ui/toast";

export const Route = createFileRoute("/security")({
  validateSearch: z.object({ project: z.optional(z.string()) }),
  component: Security,
});

type Data = NonNullable<ReturnType<typeof useSecurity>["data"]>;
type ProjectFindings = {
  project: Data["reports"][number]["project"];
  report: Data["reports"][number]["report"];
  findings: Finding[];
};

const count = (findings: Finding[], ...levels: Finding["severity"][]) => {
  const wanted = new Set(levels);
  return findings.filter((f) => wanted.has(f.severity)).length;
};

function Security() {
  const { data, isPending } = useSecurity();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  const rows: ProjectFindings[] = (data?.reports ?? [])
    .map(({ project, report }) => ({
      project,
      report,
      findings: (report?.findings ?? []).filter((f) => !data?.dismissed.has(f.id)),
    }))
    .filter((r) => r.findings.length > 0 || r.report?.error)
    .toSorted(
      (a, b) =>
        count(b.findings, "critical", "high") - count(a.findings, "critical", "high") ||
        b.findings.length - a.findings.length,
    );
  const selected = rows.find((r) => r.project.id === search.project) ?? rows[0];
  const select = (id: string) => void navigate({ search: { project: id }, replace: true });
  useListKeys({ ids: rows.map((r) => r.project.id), selected: selected?.project.id, onSelect: select });

  const threshold = data?.threshold;
  return (
    <Page
      title="Security"
      subtitle={
        threshold ? `Audit fails at ${threshold.level}${threshold.prodOnly ? ", production only" : ""}` : undefined
      }
      actions={<JobRefresh jobId="security" label="Scan again" />}
      className="overflow-hidden"
    >
      {isPending ? (
        <div className="flex justify-center p-10">
          <Spinner />
        </div>
      ) : rows.length === 0 ? (
        <Empty icon={<ShieldCheck />} title="No known advisories" />
      ) : (
        <Split
          listWidth={300}
          list={
            <div className="min-h-0 flex-1 overflow-y-auto">
              {rows.map((row) => (
                <ProjectItem
                  key={row.project.id}
                  row={row}
                  selected={row.project.id === selected?.project.id}
                  failsAudit={threshold ? wouldFailCi(row.findings, threshold) : false}
                  onSelect={() => select(row.project.id)}
                />
              ))}
            </div>
          }
          detail={
            selected ? (
              <ErrorBoundary key={selected.project.id}>
                <ProjectAdvisories row={selected} />
              </ErrorBoundary>
            ) : null
          }
        />
      )}
    </Page>
  );
}

function ProjectItem({
  row,
  selected,
  failsAudit,
  onSelect,
}: {
  row: ProjectFindings;
  selected: boolean;
  failsAudit: boolean;
  onSelect: () => void;
}) {
  const { findings } = row;
  const urgent = count(findings, "critical", "high");
  return (
    <button
      type="button"
      data-row-id={row.project.id}
      onClick={onSelect}
      className={cn(
        "flex w-full flex-col gap-2 border-b border-line px-4 py-3 text-left transition-colors hover:bg-hover",
        selected && "bg-raised",
      )}
    >
      <span className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-medium">{row.project.name}</span>
        <span className={cn("text-sm tabular", urgent > 0 ? "text-bad" : "text-warn")}>{findings.length}</span>
      </span>
      <SegmentBar
        segments={[
          { value: urgent, color: "bg-bad", label: "high or critical" },
          { value: count(findings, "moderate"), color: "bg-warn", label: "moderate" },
          { value: count(findings, "low"), color: "bg-faint", label: "low" },
        ]}
      />
      <span className="text-xs text-faint">
        {row.report?.error ? "Scan failed" : failsAudit ? "Fails the audit" : "Passes the audit"}
      </span>
    </button>
  );
}

function ProjectAdvisories({ row }: { row: ProjectFindings }) {
  const svc = useServices();
  const queryClient = useQueryClient();
  const [run, setRun] = useState<string>();
  const [dismissing, setDismissing] = useState<Finding[]>();
  const groups = groupFindings(row.findings);
  const projectId = row.project.id;

  const fix = useMutation({
    mutationFn: async (group: FindingGroup) => {
      const [first] = group.findings;
      if (!first) throw new Error("Nothing to fix.");
      const finding = { ...first, fixedIn: group.fixedIn };
      if (group.direct) return fixDirect(svc, projectId, finding);
      await fixWithOverride(svc, projectId, finding);
      return undefined;
    },
    onSuccess: async (runId) => {
      if (runId) setRun(runId);
      else toast("Override added, installed and committed.");
      await queryClient.invalidateQueries({ queryKey: ["security"] });
      svc.invalidate(["home"]);
    },
    onError: toastError,
  });

  return (
    <div className="flex flex-col">
      <div className="flex h-12 items-center gap-3 border-b border-line px-5">
        <Link {...projectLink(projectId)} className="font-medium hover:underline">
          {row.project.name}
        </Link>
        <span className="text-sm text-muted">
          {groups.length} {groups.length === 1 ? "package" : "packages"} · {row.findings.length} advisories ·{" "}
          {row.report?.scanned ?? 0} scanned
        </span>
      </div>
      {row.report?.error ? (
        <div className="p-4">
          <ErrorNote>{row.report.error}</ErrorNote>
        </div>
      ) : null}
      {groups.map((group) => (
        <GroupRow
          key={group.key}
          group={group}
          fixing={fix.isPending && fix.variables?.key === group.key}
          fixDisabled={fix.isPending}
          onFix={() => fix.mutate(group)}
          onDismiss={setDismissing}
        />
      ))}
      <DismissDialog findings={dismissing} onClose={() => setDismissing(undefined)} />
      {run ? <UpdateRunDialog runId={run} projectId={projectId} onClose={() => setRun(undefined)} /> : null}
    </div>
  );
}

function GroupRow({
  group,
  fixing,
  fixDisabled,
  onFix,
  onDismiss,
}: {
  group: FindingGroup;
  fixing: boolean;
  fixDisabled: boolean;
  onFix: () => void;
  onDismiss: (findings: Finding[]) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-line">
      <div className="flex min-h-12 items-center gap-3 px-5 py-2">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <ChevronRight className={cn("size-3.5 shrink-0 text-faint transition-transform", open && "rotate-90")} />
          <SeverityBadge severity={group.severity} />
          <span className="flex min-w-0 flex-col">
            <span className="truncate">
              <Mono className="text-base">{group.name}</Mono>
              <span className="ml-2 font-mono text-xs text-faint">{group.versions.join(", ")}</span>
            </span>
            <span className="truncate text-xs text-faint">
              {group.findings.length === 1 ? group.findings[0]?.summary : `${group.findings.length} advisories`}
              {" · "}
              {group.direct ? "direct" : "transitive"}
              {group.dev ? " · dev only" : ""}
            </span>
          </span>
        </button>
        {group.fixedIn ? (
          <Button size="sm" loading={fixing} disabled={fixDisabled} onClick={onFix}>
            {group.direct ? `Update to ${group.fixedIn}` : `Override to ${group.fixedIn}`}
          </Button>
        ) : (
          <span className="text-xs text-faint">No fix yet</span>
        )}
        <Button size="sm" variant="ghost" onClick={() => onDismiss(group.findings)}>
          Dismiss
        </Button>
      </div>
      {open ? (
        <div className="flex flex-col pb-2 pl-[52px]">
          {group.findings.map((f) => (
            <div key={`${f.id}:${f.version}`} className="flex h-8 items-center gap-3 pr-5 text-sm">
              <span className={cn("w-16 shrink-0 text-xs", severityRank(f.severity) >= 2 ? "text-bad" : "text-muted")}>
                {f.severity}
              </span>
              <span className="min-w-0 flex-1 truncate text-muted">{f.summary}</span>
              <ExternalLink href={f.url} className="shrink-0 text-xs text-faint hover:text-fg">
                {f.aliases.find((a) => a.startsWith("CVE")) ?? f.id}
              </ExternalLink>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function DismissDialog({ findings, onClose }: { findings: Finding[] | undefined; onClose: () => void }) {
  const svc = useServices();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const dismiss = useMutation({
    mutationFn: async (items: Finding[]) => {
      await Promise.all(
        [...new Set(items.map((f) => f.id))].map((id) => {
          const stamp = { hlc: svc.clock.tick(), deviceId: svc.clock.deviceId };
          return svc.store.db
            .insert(dismissals)
            .values({ id, target: id, reason, ...stamp })
            .onConflictDoUpdate({ target: dismissals.id, set: { deleted: false, reason, ...stamp } });
        }),
      );
    },
    onSuccess: async () => {
      setReason("");
      onClose();
      await queryClient.invalidateQueries({ queryKey: ["security"] });
      svc.invalidate(["home"]);
    },
    onError: toastError,
  });
  const n = new Set(findings?.map((f) => f.id)).size;
  return (
    <Dialog
      open={Boolean(findings)}
      onClose={onClose}
      title={n === 1 ? "Dismiss advisory" : `Dismiss ${n} advisories`}
      footer={
        <Button variant="primary" loading={dismiss.isPending} onClick={() => findings && dismiss.mutate(findings)}>
          Dismiss everywhere
        </Button>
      }
    >
      <Field label="Reason" hint="Hidden in every project and on every synced device.">
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
  );
}
