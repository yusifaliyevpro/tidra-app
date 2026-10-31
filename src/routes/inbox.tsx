import { useMutation } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, Inbox as InboxIcon } from "lucide-react";
import { useState } from "react";
import { useInbox } from "@/app/queries";
import { useServices } from "@/app/services";
import { JobRefresh } from "@/modules/common";
import { PullRow } from "@/modules/pulls";
import { refreshInbox } from "@/services/github-feed";
import { Badge } from "@/ui/badge";
import { IconButton } from "@/ui/button";
import { openExternal } from "@/ui/external";
import { Card, Empty, Page } from "@/ui/layout";
import { Tabs } from "@/ui/misc";
import { TimeAgo } from "@/ui/time";
import { toastError } from "@/ui/toast";

export const Route = createFileRoute("/inbox")({ component: Inbox });

type Tab = "reviews" | "mine" | "notifications";

/** API URLs in notifications point at api.github.com; this maps the common ones to their web pages. */
function webUrl(apiUrl: string | null | undefined, repoUrl: string) {
  if (!apiUrl) return repoUrl;
  return apiUrl.replace("https://api.github.com/repos/", "https://github.com/").replace("/pulls/", "/pull/");
}

function Inbox() {
  const svc = useServices();
  const { data } = useInbox();
  const [tab, setTab] = useState<Tab>("reviews");
  const markRead = useMutation({
    mutationFn: async (id: string) => {
      await (await svc.github()).markNotificationRead(id);
      await refreshInbox(svc);
    },
    onError: toastError,
  });

  if (data?.error) {
    return (
      <Page title="GitHub inbox">
        <Empty
          icon={<InboxIcon />}
          title="GitHub isn't connected"
          action={
            <Link to="/settings" className="text-accent hover:underline">
              Open Settings
            </Link>
          }
        >
          {data.error}
        </Empty>
      </Page>
    );
  }
  const unread = (data?.notifications ?? []).filter((n) => n.unread);
  return (
    <Page title="GitHub inbox" actions={<JobRefresh jobId="inbox" />} className="flex flex-col">
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        items={[
          { id: "reviews", label: "Review requests", count: data?.reviewRequests.length },
          { id: "mine", label: "Your pull requests", count: data?.myPulls.length },
          { id: "notifications", label: "Notifications", count: unread.length },
        ]}
      />
      <div className="mx-auto w-full max-w-4xl p-5">
        <Card>
          {tab === "reviews" ? (
            data?.reviewRequests.length ? (
              data.reviewRequests.map((pull) => <PullRow key={pull.url} pull={pull} />)
            ) : (
              <p className="p-4 text-sm text-muted">No reviews requested.</p>
            )
          ) : tab === "mine" ? (
            data?.myPulls.length ? (
              data.myPulls.map((pull) => <PullRow key={pull.url} pull={pull} />)
            ) : (
              <p className="p-4 text-sm text-muted">No open pull requests.</p>
            )
          ) : unread.length ? (
            unread.map((n) => (
              <div
                key={n.id}
                className="flex h-11 items-center gap-3 border-b border-line px-4 last:border-b-0 hover:bg-hover"
              >
                <Badge>{n.reason.replaceAll("_", " ")}</Badge>
                <button
                  type="button"
                  className="flex min-w-0 flex-1 flex-col text-left"
                  onClick={() => openExternal(webUrl(n.subject.url, n.repository.html_url))}
                >
                  <span className="truncate">{n.subject.title}</span>
                  <span className="text-xs text-faint">
                    {n.repository.full_name} · {n.subject.type}
                  </span>
                </button>
                <span className="text-xs">
                  <TimeAgo value={n.updated_at} />
                </span>
                <IconButton
                  size="sm"
                  label="Mark as read"
                  icon={<Check className="size-3.5" />}
                  onClick={() => markRead.mutate(n.id)}
                />
              </div>
            ))
          ) : (
            <p className="p-4 text-sm text-muted">No unread notifications.</p>
          )}
        </Card>
      </div>
    </Page>
  );
}
