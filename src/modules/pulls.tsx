import { CircleCheck, CircleDot, CircleX, GitPullRequest } from "lucide-react";
import type { ReactNode } from "react";
import type { PullSummary } from "@/services/github-feed";
import { openExternal } from "@/ui/external";
import { TimeAgo } from "@/ui/time";

export function ChecksIcon({ state }: { state: PullSummary["checks"] }) {
  if (state === "success") return <CircleCheck className="size-4 text-ok" aria-label="Checks passed" />;
  if (state === "failure") return <CircleX className="size-4 text-bad" aria-label="Checks failed" />;
  if (state === "pending") return <CircleDot className="size-4 text-warn" aria-label="Checks running" />;
  return <GitPullRequest className="size-4 text-faint" aria-label="No checks" />;
}

export function PullRow({ pull, leading, trailing }: { pull: PullSummary; leading?: ReactNode; trailing?: ReactNode }) {
  return (
    <div className="flex h-11 items-center gap-3 border-b border-line px-4 last:border-b-0 hover:bg-hover">
      {leading}
      <ChecksIcon state={pull.checks} />
      <button type="button" className="flex min-w-0 flex-1 flex-col text-left" onClick={() => openExternal(pull.url)}>
        <span className="truncate">{pull.title}</span>
        <span className="truncate text-xs text-faint">
          {pull.repo} #{pull.number}
          {pull.author ? ` · ${pull.author}` : ""}
          {pull.draft ? " · draft" : ""}
        </span>
      </button>
      <span className="shrink-0 text-xs">
        <TimeAgo value={pull.updatedAt} />
      </span>
      {trailing}
    </div>
  );
}
