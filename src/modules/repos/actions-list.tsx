import { useMutation } from "@tanstack/react-query";
import { ArrowRight, ClipboardCopy, ExternalLink } from "lucide-react";
import { useState } from "react";
import { useServices } from "@/app/services";
import { isEditableInput, type ToolInput } from "@/engine/actions";
import {
  actionsUpdatePrompt,
  applyActionUpdatesToRepo,
  setToolVersion,
  type ActionItem,
  type ActionsReport,
} from "@/services/actions";
import type { RepoGroup } from "@/services/repos";
import { Button, IconButton } from "@/ui/button";
import { openExternal } from "@/ui/external";
import { Input } from "@/ui/field";
import { ErrorNote } from "@/ui/layout";
import { Mono } from "@/ui/misc";
import { toast, toastError } from "@/ui/toast";

const shortRef = (ref: string) => (/^[0-9a-f]{40}$/.test(ref) ? ref.slice(0, 7) : ref);
const itemKey = (item: ActionItem) => `${item.file}:${item.line}`;

/** A repo's workflow actions; outdated ones commit on a `tidra/actions-<date>` branch cut from the default branch. */
export function ActionsList({ repo, report }: { repo: RepoGroup; report: ActionsReport | undefined }) {
  const svc = useServices();
  const items = report?.items ?? [];
  const outdated = items.filter((i) => i.next);
  const apply = useMutation({
    mutationFn: (picks: ActionItem[]) => applyActionUpdatesToRepo(svc, repo.key, picks),
    onSuccess: ({ message, branch }) => toast(`Committed on ${branch}: ${message}`),
    onError: toastError,
  });
  const copyPrompt = () =>
    navigator.clipboard
      .writeText(actionsUpdatePrompt(repo, items))
      .then(() => toast("Prompt copied. Paste it into your coding agent."))
      .catch(toastError);

  return (
    <div className="flex flex-col">
      {report?.error ? (
        <div className="py-2">
          <ErrorNote>{report.error}</ErrorNote>
        </div>
      ) : null}
      {items.length === 0 && !report?.error ? <p className="py-2 text-sm text-faint">No workflows</p> : null}
      {items.map((item) => (
        <div key={itemKey(item)} className="flex h-9 items-center gap-3 border-b border-line text-sm last:border-b-0">
          <span className="w-56 truncate font-medium">{item.action}</span>
          <span className="w-36 truncate text-faint">{item.file.replace(".github/workflows/", "")}</span>
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
            <span className="text-faint">tracks a branch</span>
          ) : null}
          {item.inputs?.map((input) => (
            <ToolVersion key={input.line} repoKey={repo.key} item={item} input={input} />
          ))}
          <span className="ml-auto flex items-center gap-1">
            <IconButton
              size="sm"
              label={`${item.repo} releases`}
              icon={<ExternalLink className="size-3.5" />}
              onClick={() => openExternal(`https://github.com/${item.repo}/releases`)}
            />
            {item.next ? (
              <Button
                size="sm"
                loading={apply.isPending && apply.variables.length === 1 && apply.variables[0] === item}
                disabled={apply.isPending}
                onClick={() => apply.mutate([item])}
              >
                Update
              </Button>
            ) : null}
          </span>
        </div>
      ))}
      {outdated.length > 1 ? (
        <div className="flex items-center justify-end gap-2 pt-2">
          <Button
            size="sm"
            variant="ghost"
            icon={<ClipboardCopy className="size-3.5" />}
            onClick={() => void copyPrompt()}
          >
            Copy prompt for an agent
          </Button>
          <Button
            size="sm"
            loading={apply.isPending && apply.variables.length > 1}
            disabled={apply.isPending}
            onClick={() => apply.mutate(outdated)}
          >
            Update all {outdated.length}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** The tool version a setup step pins (`node-version: 24`); a plain value edits in place and commits on the current branch. */
function ToolVersion({ repoKey, item, input }: { repoKey: string; item: ActionItem; input: ToolInput }) {
  const svc = useServices();
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const save = useMutation({
    mutationFn: (value: string) => setToolVersion(svc, repoKey, item, input, value),
    onSuccess: ({ message, branch }) => {
      setDraft(undefined);
      toast(`Committed on ${branch}: ${message}`);
    },
    onError: toastError,
  });
  const label = `${input.tool} version`;
  if (!isEditableInput(input)) {
    return (
      <span className="flex min-w-0 items-center gap-1.5" title={`${label} comes from an expression`}>
        <span className="text-faint">{input.tool}</span>
        <Mono className="truncate text-muted">{input.value}</Mono>
      </span>
    );
  }
  if (draft === undefined) {
    return (
      <Button
        size="sm"
        variant="ghost"
        title={`Change ${label}`}
        aria-label={`${label} ${input.value}, change`}
        onClick={() => setDraft(input.value)}
      >
        <span className="text-faint">{input.tool}</span>
        <Mono className="text-fg">{input.value}</Mono>
      </Button>
    );
  }
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      <span className="text-faint">{input.tool}</span>
      <Input
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- the field appears because the user asked to type in it
        autoFocus
        aria-label={label}
        className="h-6 w-20 px-1.5 font-mono text-sm"
        value={draft}
        readOnly={save.isPending}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => !save.isPending && setDraft(undefined)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && draft.trim() === input.value) setDraft(undefined);
          else if (e.key === "Enter" && draft.trim()) save.mutate(draft);
          if (e.key === "Escape") {
            e.stopPropagation();
            setDraft(undefined);
          }
        }}
      />
    </span>
  );
}
