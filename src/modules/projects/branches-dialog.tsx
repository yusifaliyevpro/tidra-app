import { useMutation, useQuery } from "@tanstack/react-query";
import { GitMerge, Trash2 } from "lucide-react";
import { useState } from "react";
import { useServices } from "@/app/services";
import { deleteBranches, listBranchDetails, type BranchDetail } from "@/services/repos";
import { Badge } from "@/ui/badge";
import { Button, IconButton } from "@/ui/button";
import { Dialog } from "@/ui/dialog";
import { Spinner } from "@/ui/spinner";
import { TimeAgo } from "@/ui/time";
import { toast, toastError } from "@/ui/toast";

const deletable = (branch: BranchDetail) => !branch.current && !branch.isDefault;

/** A repo's local branches, which ones are merged, and deleting them one at a time or all at once. */
export function BranchesDialog({
  projectId,
  label,
  onClose,
}: {
  projectId: string | undefined;
  label: string;
  onClose: () => void;
}) {
  return projectId ? <OpenBranches key={projectId} projectId={projectId} label={label} onClose={onClose} /> : null;
}

function OpenBranches({ projectId, label, onClose }: { projectId: string; label: string; onClose: () => void }) {
  const svc = useServices();
  const details = useQuery({
    // Under "branches", so a switch or fetch refreshes this list too.
    queryKey: ["branches", projectId, "details"],
    queryFn: () => listBranchDetails(svc, projectId),
    staleTime: 0,
  });
  const [confirming, setConfirming] = useState<BranchDetail[]>();
  const remove = useMutation({
    mutationFn: (names: string[]) => deleteBranches(svc, projectId, names),
    onSuccess: (message) => toast(message),
    onError: toastError,
    onSettled: () => setConfirming(undefined),
  });
  const branches = details.data?.branches ?? [];
  const removable = branches.filter(deletable);
  const removeAll = (list: BranchDetail[]) => remove.mutate(list.map((b) => b.name));
  const deleting = new Set(remove.isPending ? remove.variables : []);

  return (
    <>
      <Dialog
        open
        onClose={onClose}
        title={`${label} branches`}
        className="w-[640px]"
        footer={
          removable.length > 0 ? (
            <Button size="sm" variant="danger" disabled={remove.isPending} onClick={() => setConfirming(removable)}>
              Delete all
            </Button>
          ) : undefined
        }
      >
        {details.isPending ? (
          <div className="flex justify-center p-6">
            <Spinner />
          </div>
        ) : null}
        {details.error ? <p className="text-sm text-bad">{details.error.message}</p> : null}
        <div className="-m-4 flex flex-col">
          {branches.map((branch) => (
            <BranchRow
              key={branch.name}
              branch={branch}
              busy={remove.isPending}
              deleting={deleting.has(branch.name)}
              onDelete={() => (branch.merged ? removeAll([branch]) : setConfirming([branch]))}
            />
          ))}
        </div>
      </Dialog>
      <ConfirmDelete
        branches={confirming}
        base={details.data?.base}
        deleting={remove.isPending}
        onCancel={() => setConfirming(undefined)}
        onConfirm={() => confirming && removeAll(confirming)}
      />
    </>
  );
}

function BranchRow({
  branch,
  busy,
  deleting,
  onDelete,
}: {
  branch: BranchDetail;
  busy: boolean;
  deleting: boolean;
  onDelete: () => void;
}) {
  return (
    <div className="flex h-10 shrink-0 items-center gap-2.5 border-b border-line pr-2 pl-4 last:border-b-0">
      <span className="flex size-4 shrink-0 items-center justify-center">
        {branch.merged && !branch.isDefault ? (
          <span title="Merged" className="text-ok">
            <GitMerge aria-label="Merged" className="size-4" strokeWidth={1.5} />
          </span>
        ) : null}
      </span>
      <span className="min-w-0 truncate font-mono text-sm" title={branch.name}>
        {branch.name}
      </span>
      {branch.current ? <Badge tone="info">current</Badge> : null}
      {branch.isDefault ? <Badge>default</Badge> : null}
      {branch.upstreamGone ? <Badge tone="warn">remote deleted</Badge> : null}
      {branch.ahead > 0 ? <Badge tone="info">{branch.ahead} unpushed</Badge> : null}
      <span className="ml-auto shrink-0 text-sm">
        <TimeAgo value={new Date(branch.lastCommit).toISOString()} />
      </span>
      {deletable(branch) ? (
        <IconButton
          size="sm"
          label={`Delete ${branch.name}`}
          loading={deleting}
          disabled={busy}
          icon={<Trash2 className="size-3.5" />}
          onClick={onDelete}
        />
      ) : (
        <span className="size-7 shrink-0" />
      )}
    </div>
  );
}

function confirmText(branches: BranchDetail[], base: string | undefined) {
  const into = base ? ` into ${base}` : "";
  const unmerged = branches.filter((b) => !b.merged).length;
  const [only] = branches;
  if (branches.length === 1 && only) return `${only.name} isn't merged${into}.`;
  if (unmerged === 0) return `All of them are merged${into}.`;
  return `${unmerged} of them ${unmerged === 1 ? "isn't" : "aren't"} merged${into}.`;
}

/** Spells out what can be lost: an unmerged branch may hold the only copy of its commits. */
function ConfirmDelete({
  branches,
  base,
  deleting,
  onCancel,
  onConfirm,
}: {
  branches: BranchDetail[] | undefined;
  base: string | undefined;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const count = branches?.length ?? 0;
  const risky = branches?.some((b) => !b.merged);
  return (
    <Dialog
      open={branches !== undefined}
      onClose={onCancel}
      title={count === 1 ? "Delete this branch?" : `Delete ${count} branches?`}
      className="w-[440px]"
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="danger" loading={deleting} onClick={onConfirm}>
            Delete
          </Button>
        </>
      }
    >
      <p className="text-sm">
        {branches ? confirmText(branches, base) : null}
        {risky ? " Commits that were never pushed will be lost." : null}
      </p>
      <p className="mt-2 text-sm text-muted">Copies on the remote stay.</p>
    </Dialog>
  );
}
