import { createFileRoute } from "@tanstack/react-router";
import { Bot } from "lucide-react";
import { useBotPulls } from "@/app/queries";
import { JobRefresh } from "@/modules/common";
import { PullRow } from "@/modules/pulls";
import { Card, Empty, ErrorNote, Page } from "@/ui/layout";

export const Route = createFileRoute("/bots")({ component: BotPulls });

function BotPulls() {
  const { data } = useBotPulls();
  const pulls = data?.pulls ?? [];
  return (
    <Page title="Bot PRs" subtitle="Dependabot and Renovate" actions={<JobRefresh jobId="bot-pulls" />}>
      {data?.error ? (
        <div className="p-5">
          <ErrorNote>{data.error}</ErrorNote>
        </div>
      ) : pulls.length === 0 ? (
        <Empty icon={<Bot />} title="No open bot pull requests" />
      ) : (
        <div className="mx-auto flex max-w-4xl flex-col p-5">
          <Card>
            {pulls.map((pull) => (
              <PullRow
                key={pull.url}
                pull={pull}
                trailing={pull.mergeable === "CONFLICTING" ? <span className="text-xs text-bad">conflicts</span> : null}
              />
            ))}
          </Card>
        </div>
      )}
    </Page>
  );
}
