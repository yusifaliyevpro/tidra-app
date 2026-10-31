import { Link } from "@tanstack/react-router";
import { Check, Circle, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useServices } from "@/app/services";
import type { Bump } from "@/engine/versions";
import { projectLink } from "@/modules/links";
import type { readAllReports } from "@/services/projects";
import { planBatch, startBatch, subscribeBatch, type BatchItem, type BatchProgress } from "@/services/updates";
import { BumpBadge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { Dialog } from "@/ui/dialog";
import { Checkbox } from "@/ui/field";
import { Spinner } from "@/ui/spinner";

type Rows = Awaited<ReturnType<typeof readAllReports>>;

const LEVELS: Bump[] = ["patch", "minor", "major"];

function toggle<T>(set: Set<T>, value: T) {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

function ItemIcon({ state }: { state: BatchItem["state"] }) {
  if (state === "running") return <Spinner className="size-3.5 text-accent" />;
  if (state === "ok") return <Check className="size-3.5 text-ok" />;
  if (state === "failed") return <X className="size-3.5 text-bad" />;
  return <Circle className="size-3.5 text-faint" />;
}

/** Picks bump levels and projects, then updates them a couple at a time, each on its own run with checks. */
export function BatchUpdateDialog({ open, rows, onClose }: { open: boolean; rows: Rows; onClose: () => void }) {
  const svc = useServices();
  const [levels, setLevels] = useState<Set<Bump>>(() => new Set(["patch", "minor"]));
  const [skipped, setSkipped] = useState<Set<string>>(() => new Set());
  const [batchId, setBatchId] = useState<string>();
  const [progress, setProgress] = useState<BatchProgress>();

  useEffect(() => (batchId ? subscribeBatch(batchId, setProgress) : undefined), [batchId]);

  const plans = planBatch(rows, levels);
  const chosen = plans.filter((plan) => !skipped.has(plan.projectId));

  const close = () => {
    if (progress?.done !== false) {
      setBatchId(undefined);
      setProgress(undefined);
    }
    onClose();
  };

  const counts = progress
    ? {
        ok: progress.items.filter((i) => i.state === "ok").length,
        failed: progress.items.filter((i) => i.state === "failed").length,
      }
    : undefined;

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Update projects"
      className="w-[600px]"
      footer={
        progress ? (
          <>
            <span className="mr-auto self-center text-sm text-muted">
              {progress.done
                ? `${counts?.ok ?? 0} updated, ${counts?.failed ?? 0} failed`
                : "Updates keep running if you close this."}
            </span>
            <Button onClick={close}>Close</Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={chosen.length === 0}
              onClick={() => setBatchId(startBatch(svc, chosen))}
            >
              {chosen.length === 1 ? "Update 1 project" : `Update ${chosen.length} projects`}
            </Button>
          </>
        )
      }
    >
      {progress ? (
        <ul className="flex flex-col">
          {progress.items.map((item) => (
            <li key={item.projectId} className="flex min-h-9 items-center gap-2.5 border-b border-line last:border-b-0">
              <ItemIcon state={item.state} />
              <Link {...projectLink(item.projectId)} onClick={close} className="shrink-0 font-medium hover:underline">
                {item.name}
              </Link>
              <span className="shrink-0 text-sm text-faint">
                {item.packages} {item.packages === 1 ? "package" : "packages"}
              </span>
              {item.detail ? (
                <span title={item.detail} className="ml-auto min-w-0 truncate text-sm text-bad">
                  {item.detail}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-4 text-sm">
            <span className="text-muted">Include</span>
            {LEVELS.map((level) => (
              <span key={level} className="flex items-center gap-1.5">
                <Checkbox
                  label={`Include ${level} updates`}
                  checked={levels.has(level)}
                  onChange={() => setLevels(toggle(levels, level))}
                />
                <BumpBadge bump={level} />
              </span>
            ))}
          </div>
          {plans.length === 0 ? (
            <p className="text-sm text-muted">No project has updates at these levels.</p>
          ) : (
            <ul className="flex flex-col rounded-md border border-line">
              {plans.map((plan) => (
                <li
                  key={plan.projectId}
                  className="flex h-9 items-center gap-2.5 border-b border-line px-3 last:border-b-0"
                >
                  <Checkbox
                    label={`Update ${plan.name}`}
                    checked={!skipped.has(plan.projectId)}
                    onChange={() => setSkipped(toggle(skipped, plan.projectId))}
                  />
                  <span className="font-medium">{plan.name}</span>
                  <span className="ml-auto truncate text-sm text-faint">
                    {plan.picks.map((p) => p.entry.name).join(", ")}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-sm text-muted">
            Two projects run at a time. Each follows its own settings for branches, checks, push and pull requests.
          </p>
        </div>
      )}
    </Dialog>
  );
}
