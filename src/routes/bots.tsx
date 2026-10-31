import { useMutation } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Bot } from "lucide-react";
import { useState } from "react";
import { useBotPulls } from "@/app/queries";
import { useServices } from "@/app/services";
import { JobRefresh } from "@/modules/common";
import { PullRow } from "@/modules/pulls";
import { refreshBotPulls, type PullSummary } from "@/services/github-feed";
import { Button } from "@/ui/button";
import { Checkbox, Select } from "@/ui/field";
import { Card, Empty, ErrorNote, Page } from "@/ui/layout";
import { toast, toastError } from "@/ui/toast";

export const Route = createFileRoute("/bots")({ component: BotPulls });

const METHODS = ["squash", "merge", "rebase"] as const;
type Method = (typeof METHODS)[number];

function BotPulls() {
  const svc = useServices();
  const { data } = useBotPulls();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [method, setMethod] = useState<Method>("squash");
  const pulls = data?.pulls ?? [];

  const merge = useMutation({
    mutationFn: async (targets: PullSummary[]) => {
      const github = await svc.github();
      const failures: string[] = [];
      for (const pull of targets) {
        try {
          await github.mergePull(pull.repo, pull.number, method);
        } catch (error) {
          failures.push(`${pull.repo}#${pull.number}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      await refreshBotPulls(svc);
      return { merged: targets.length - failures.length, failures };
    },
    onSuccess: ({ merged, failures }) => {
      setPicked(new Set());
      if (failures.length > 0) toastError(new Error(`Merged ${merged}. Failed: ${failures.join("; ")}`));
      else toast(`Merged ${merged} pull ${merged === 1 ? "request" : "requests"}.`);
    },
    onError: toastError,
  });

  const passing = pulls.filter((p) => p.checks === "success" && p.mergeable !== "CONFLICTING");
  return (
    <Page
      title="Bot PRs"
      subtitle="Dependabot and Renovate"
      actions={
        <>
          <JobRefresh jobId="bot-pulls" />
          <Select
            value={method}
            onChange={(e) => setMethod(METHODS.find((m) => m === e.target.value) ?? "squash")}
            className="w-28"
            aria-label="Merge method"
          >
            <option value="squash">Squash</option>
            <option value="merge">Merge</option>
            <option value="rebase">Rebase</option>
          </Select>
          <Button
            variant="primary"
            disabled={picked.size === 0}
            loading={merge.isPending}
            onClick={() => merge.mutate(pulls.filter((p) => picked.has(p.url)))}
          >
            Merge {picked.size > 0 ? picked.size : ""}
          </Button>
        </>
      }
    >
      {data?.error ? (
        <div className="p-5">
          <ErrorNote>{data.error}</ErrorNote>
        </div>
      ) : pulls.length === 0 ? (
        <Empty icon={<Bot />} title="No open bot pull requests" />
      ) : (
        <div className="mx-auto flex max-w-4xl flex-col gap-3 p-5">
          {passing.length > 0 ? (
            <Button size="sm" className="self-start" onClick={() => setPicked(new Set(passing.map((p) => p.url)))}>
              Select {passing.length} with passing checks
            </Button>
          ) : null}
          <Card>
            {pulls.map((pull) => (
              <PullRow
                key={pull.url}
                pull={pull}
                leading={
                  <Checkbox
                    label={`Select ${pull.title}`}
                    checked={picked.has(pull.url)}
                    onChange={(checked) => {
                      const next = new Set(picked);
                      if (checked) next.add(pull.url);
                      else next.delete(pull.url);
                      setPicked(next);
                    }}
                  />
                }
                trailing={pull.mergeable === "CONFLICTING" ? <span className="text-xs text-bad">conflicts</span> : null}
              />
            ))}
          </Card>
        </div>
      )}
    </Page>
  );
}
