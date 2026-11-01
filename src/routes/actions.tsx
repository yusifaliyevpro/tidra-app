import { useMutation } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { cn } from "cn";
import { ArrowRight, ChevronRight, ExternalLink, Workflow } from "lucide-react";
import { useState } from "react";
import { useActions } from "@/app/queries";
import { useServices } from "@/app/services";
import { JobRefresh } from "@/modules/common";
import { BranchActions } from "@/modules/projects/branch-actions";
import { SyncButton } from "@/modules/projects/sync-button";
import { applyActionUpdatesToRepo, type ActionItem } from "@/services/actions";
import type { RepoGroup } from "@/services/repos";
import { Button, IconButton } from "@/ui/button";
import { ErrorBoundary } from "@/ui/error-boundary";
import { openExternal } from "@/ui/external";
import { Empty, ErrorNote, Page } from "@/ui/layout";
import { Mono } from "@/ui/misc";
import { Spinner } from "@/ui/spinner";
import { toast, toastError } from "@/ui/toast";

export const Route = createFileRoute("/actions")({ component: Actions });

const shortRef = (ref: string) => (/^[0-9a-f]{40}$/.test(ref) ? ref.slice(0, 7) : ref);
const itemKey = (item: ActionItem) => `${item.file}:${item.line}`;

type Row = NonNullable<ReturnType<typeof useActions>["data"]>[number];

function Actions() {
  const { data: rows, isPending } = useActions();
  const withItems = (rows ?? [])
    .filter(({ report }) => (report?.items.length ?? 0) > 0 || report?.error)
    .map((row) => ({ ...row, outdated: (row.report?.items ?? []).filter((i) => i.next) }))
    .toSorted((a, b) => b.outdated.length - a.outdated.length || a.repo.label.localeCompare(b.repo.label));
  const current = withItems.filter((r) => r.outdated.length === 0 && !r.report?.error);
  const total = withItems.reduce((sum, r) => sum + r.outdated.length, 0);

  return (
    <Page
      title="Actions"
      subtitle={total > 0 ? `${total} outdated in ${withItems.length - current.length} repos` : "All up to date"}
      actions={<JobRefresh jobId="actions" />}
    >
      {isPending ? (
        <div className="flex justify-center p-10">
          <Spinner />
        </div>
      ) : withItems.length === 0 ? (
        <Empty icon={<Workflow />} title="No workflows" />
      ) : (
        <div className="mx-auto flex max-w-5xl flex-col p-5">
          <div className="overflow-hidden rounded-lg border border-line bg-surface">
            {withItems.map((row) => (
              <ErrorBoundary key={row.repo.key}>
                <RepoActions row={row} outdated={row.outdated} />
              </ErrorBoundary>
            ))}
          </div>
        </div>
      )}
    </Page>
  );
}

function RepoActions({ row, outdated }: { row: Row; outdated: ActionItem[] }) {
  const svc = useServices();
  const [open, setOpen] = useState(false);
  const { repo, report } = row;
  const apply = useMutation({
    mutationFn: (items: ActionItem[]) => applyActionUpdatesToRepo(svc, repo.key, items),
    onSuccess: (message) => toast(`Committed: ${message}`),
    onError: toastError,
  });
  const items = report?.items ?? [];
  return (
    <div className="border-b border-line last:border-b-0">
      <div className="flex h-12 items-center gap-3 pr-4 pl-3">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
        >
          <ChevronRight className={cn("size-4 shrink-0 text-faint transition-transform", open && "rotate-90")} />
          <span className="truncate font-medium">{repo.label}</span>
          {repo.github ? <span className="truncate text-sm text-faint">{repo.github}</span> : null}
          <span className="ml-auto shrink-0 text-sm">
            {report?.error ? (
              <span className="text-bad">Scan failed</span>
            ) : outdated.length > 0 ? (
              <span className="text-warn">{outdated.length} outdated</span>
            ) : (
              <span className="text-faint">{items.length} up to date</span>
            )}
          </span>
        </button>
        <RepoPush repo={repo} />
        {outdated.length > 0 ? (
          <Button
            size="sm"
            loading={apply.isPending && apply.variables.length > 1}
            disabled={apply.isPending}
            onClick={() => apply.mutate(outdated)}
          >
            Update all
          </Button>
        ) : null}
      </div>
      {open ? (
        <div className="border-t border-line bg-bg/40">
          {report?.error ? (
            <div className="p-3">
              <ErrorNote>{report.error}</ErrorNote>
            </div>
          ) : null}
          {items.map((item) => (
            <ActionRow
              key={itemKey(item)}
              item={item}
              updating={apply.isPending && apply.variables.length === 1 && apply.variables[0] === item}
              disabled={apply.isPending}
              onUpdate={() => apply.mutate([item])}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** After committing workflow bumps, the push and PR buttons appear right where the commit happened. */
function RepoPush({ repo }: { repo: RepoGroup }) {
  const first = repo.projects[0];
  if (!first) return null;
  return (
    <>
      <BranchActions projectId={first.id} git={repo.report?.git} size="sm" />
      <SyncButton projectId={first.id} git={repo.report?.git} fork={repo.report?.fork} />
    </>
  );
}

function ActionRow({
  item,
  updating,
  disabled,
  onUpdate,
}: {
  item: ActionItem;
  updating: boolean;
  disabled: boolean;
  onUpdate: () => void;
}) {
  return (
    <div className="flex h-10 items-center gap-3 border-b border-line pr-4 pl-10 text-sm last:border-b-0">
      <span className="w-64 truncate font-medium">{item.action}</span>
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
      <span className="ml-auto flex items-center gap-1">
        <IconButton
          size="sm"
          label={`${item.repo} releases`}
          icon={<ExternalLink className="size-3.5" />}
          onClick={() => openExternal(`https://github.com/${item.repo}/releases`)}
        />
        {item.next ? (
          <Button size="sm" loading={updating} disabled={disabled} onClick={onUpdate}>
            Update
          </Button>
        ) : null}
      </span>
    </div>
  );
}
