import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, Cloud, GitBranch, Plus } from "lucide-react";
import { useState } from "react";
import { useServices } from "@/app/services";
import type { GitStatus } from "@/engine/git";
import { listBranches, switchBranch } from "@/services/repos";
import { MenuItem, Popover } from "@/ui/popover";
import { Spinner } from "@/ui/spinner";
import { toast, toastError } from "@/ui/toast";

const VALID_BRANCH = /^(?!\/|.*\/\/|.*\.\.|.*@\{)[\w./-]+(?<![./])$/;

/** The current branch as a button; opens a filterable list to switch to (or create) another branch in place. */
export function BranchMenu({ projectId, git }: { projectId: string; git: GitStatus | undefined }) {
  if (!git) return <span className="text-sm text-faint">No git</span>;
  const changed = git.changed + git.untracked;
  return (
    <Popover
      className="w-72"
      renderTrigger={({ open, toggle }) => (
        <button
          type="button"
          aria-expanded={open}
          title="Switch branch"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            toggle(event);
          }}
          className="flex h-6 max-w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 text-sm text-muted transition-colors hover:bg-white/[0.06] hover:text-fg aria-expanded:bg-white/[0.06] aria-expanded:text-fg"
        >
          <GitBranch className="size-3.5 shrink-0" />
          <span className="truncate font-mono text-xs">{git.branch ?? "detached"}</span>
          <ChevronDown className="size-3 shrink-0 text-faint" />
        </button>
      )}
    >
      {(close) => <BranchList projectId={projectId} current={git.branch} changed={changed} onDone={close} />}
    </Popover>
  );
}

function BranchList({
  projectId,
  current,
  changed,
  onDone,
}: {
  projectId: string;
  current: string | undefined;
  changed: number;
  onDone: () => void;
}) {
  const svc = useServices();
  const [filter, setFilter] = useState("");
  const branches = useQuery({ queryKey: ["branches", projectId], queryFn: () => listBranches(svc, projectId) });
  const change = useMutation({
    mutationFn: ({ name, create }: { name: string; create: boolean }) => switchBranch(svc, projectId, name, { create }),
    onSuccess: (_, { name, create }) => {
      toast(create ? `Created and switched to ${name}.` : `Switched to ${name}.`);
      onDone();
    },
    onError: toastError,
  });
  const query = filter.trim();
  const shown = (branches.data ?? []).filter((b) => b.name.toLowerCase().includes(query.toLowerCase()));
  const canCreate = query && VALID_BRANCH.test(query) && !(branches.data ?? []).some((b) => b.name === query);
  const pick = (name: string, create = false) => {
    if (name !== current || create) change.mutate({ name, create });
    else onDone();
  };

  return (
    <>
      <div className="border-b border-line p-1.5">
        <input
          ref={(el) => el?.focus()}
          aria-label="Find or create a branch"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            const first = shown[0];
            if (canCreate && !first) pick(query, true);
            else if (first) pick(first.name);
          }}
          placeholder="Find or create a branch"
          spellCheck={false}
          className="h-7 w-full rounded-md bg-transparent px-2 text-base outline-none placeholder:text-faint"
        />
      </div>
      <div className="flex min-h-0 flex-col overflow-y-auto p-1">
        {branches.isPending ? (
          <div className="flex justify-center p-3">
            <Spinner />
          </div>
        ) : null}
        {branches.error ? <p className="px-2 py-2 text-sm text-bad">{branches.error.message}</p> : null}
        {shown.map((branch) => (
          <MenuItem
            key={`${branch.remote}:${branch.name}`}
            active={branch.name === current}
            disabled={change.isPending}
            onSelect={() => pick(branch.name)}
          >
            {branch.name === current ? (
              <Check className="size-3.5 shrink-0 text-accent" />
            ) : branch.remote ? (
              <Cloud className="size-3.5 shrink-0 text-faint" />
            ) : (
              <span className="size-3.5 shrink-0" />
            )}
            <span className="truncate font-mono text-sm">{branch.name}</span>
            {change.isPending && change.variables.name === branch.name ? <Spinner className="ml-auto size-3" /> : null}
          </MenuItem>
        ))}
        {canCreate ? (
          <MenuItem disabled={change.isPending} onSelect={() => pick(query, true)}>
            <Plus className="size-3.5 shrink-0" />
            <span className="truncate">
              Create <span className="font-mono text-sm text-fg">{query}</span>
            </span>
          </MenuItem>
        ) : null}
      </div>
      {changed > 0 ? (
        <p className="border-t border-line px-3 py-2 text-xs text-muted">
          {changed} uncommitted {changed === 1 ? "change moves" : "changes move"} with you
        </p>
      ) : null}
    </>
  );
}
