import { useMutation } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { cn } from "cn";
import {
  Bell,
  Check,
  CheckCheck,
  CircleDot,
  Eye,
  GitPullRequest,
  Inbox as InboxIcon,
  MessageSquare,
  Tag,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { useInbox } from "@/app/queries";
import { useServices } from "@/app/services";
import { useListKeys } from "@/app/shortcuts";
import type { GitHubNotification } from "@/integrations/github";
import { JobRefresh } from "@/modules/common";
import { ChecksIcon } from "@/modules/pulls";
import { clearNotifications, type PullSummary } from "@/services/github-feed";
import { Badge } from "@/ui/badge";
import { Button, IconButton } from "@/ui/button";
import { openExternal } from "@/ui/external";
import { Empty, Page } from "@/ui/layout";
import { TimeAgo } from "@/ui/time";
import { toast, toastError } from "@/ui/toast";

export const Route = createFileRoute("/inbox")({ component: Inbox });

type Filter = "reviews" | "mine" | "unread";

/** API URLs in notifications point at api.github.com; this maps the common ones to their web pages. */
function webUrl(apiUrl: string | null | undefined, repoUrl: string) {
  if (!apiUrl) return repoUrl;
  return apiUrl.replace("https://api.github.com/repos/", "https://github.com/").replace("/pulls/", "/pull/");
}

const SUBJECT_ICON: Record<string, LucideIcon> = {
  PullRequest: GitPullRequest,
  Issue: CircleDot,
  Release: Tag,
  Discussion: MessageSquare,
};

function Inbox() {
  const { data } = useInbox();
  const [filter, setFilter] = useState<Filter>("mine");

  if (data?.error) {
    return (
      <Page title="Pull requests">
        <Empty
          icon={<InboxIcon />}
          title="GitHub isn't connected"
          action={
            <Link to="/settings" search={{ section: "github" }} className="text-accent hover:underline">
              Open GitHub settings
            </Link>
          }
        >
          {data.error}
        </Empty>
      </Page>
    );
  }

  const reviews = data?.reviewRequests ?? [];
  const mine = data?.myPulls ?? [];
  const unread = (data?.notifications ?? []).filter((n) => n.unread);
  const filters: { id: Filter; label: string; icon: LucideIcon; count: number }[] = [
    { id: "mine", label: "Your pull requests", icon: GitPullRequest, count: mine.length },
    { id: "reviews", label: "Review requests", icon: Eye, count: reviews.length },
    { id: "unread", label: "Notifications", icon: Bell, count: unread.length },
  ];

  return (
    <Page title="Pull requests" actions={<JobRefresh jobId="inbox" />} className="flex overflow-hidden">
      <nav className="flex w-56 shrink-0 flex-col gap-0.5 border-r border-line p-2">
        {filters.map(({ id, label, icon: Icon, count }) => (
          <button
            key={id}
            type="button"
            aria-current={filter === id || undefined}
            onClick={() => setFilter(id)}
            className={cn(
              "flex h-8 items-center gap-2.5 rounded-md px-2.5 text-left",
              filter === id ? "bg-raised text-fg" : "text-muted hover:bg-hover hover:text-fg",
            )}
          >
            <Icon className="size-4" />
            <span className="flex-1">{label}</span>
            {count > 0 ? <span className="text-xs text-faint tabular">{count}</span> : null}
          </button>
        ))}
      </nav>
      <div className="min-w-0 flex-1 overflow-y-auto">
        {filter === "unread" ? (
          <Notifications items={unread} />
        ) : (
          <Pulls
            pulls={filter === "reviews" ? reviews : mine}
            empty={filter === "reviews" ? "No reviews requested" : "No open pull requests"}
            review={filter === "reviews"}
          />
        )}
      </div>
    </Page>
  );
}

function Pulls({ pulls, empty, review }: { pulls: PullSummary[]; empty: string; review: boolean }) {
  const [selected, setSelected] = useState<string>();
  useListKeys({
    ids: pulls.map((p) => p.url),
    selected,
    onSelect: setSelected,
    onOpen: (url) => openExternal(review ? `${url}/files` : url),
  });
  if (pulls.length === 0) return <Empty title={empty} />;
  return (
    <>
      {pulls.map((pull) => (
        <div
          key={pull.url}
          data-row-id={pull.url}
          data-selected={selected === pull.url || undefined}
          className="group flex h-14 items-center gap-3 border-b border-line px-5 hover:bg-hover data-selected:bg-raised"
        >
          <ChecksIcon state={pull.checks} />
          <button
            type="button"
            onClick={() => openExternal(pull.url)}
            className="flex min-w-0 flex-1 flex-col text-left"
          >
            <span className="truncate">{pull.title}</span>
            <span className="truncate text-xs text-faint">
              {pull.repo} #{pull.number}
              {pull.author ? ` · ${pull.author}` : ""}
            </span>
          </button>
          {pull.draft ? <Badge>draft</Badge> : null}
          {pull.mergeable === "CONFLICTING" ? <Badge tone="bad">conflicts</Badge> : null}
          <span className="w-20 shrink-0 text-right text-xs">
            <TimeAgo value={pull.updatedAt} />
          </span>
          {review ? (
            <Button size="sm" variant="primary" onClick={() => openExternal(`${pull.url}/files`)}>
              Review
            </Button>
          ) : (
            <Button size="sm" onClick={() => openExternal(pull.url)}>
              Open
            </Button>
          )}
        </div>
      ))}
    </>
  );
}

function Notifications({ items }: { items: GitHubNotification[] }) {
  const svc = useServices();
  const [selected, setSelected] = useState<string>();
  const clear = useMutation({
    mutationFn: ({ ids, done }: { ids: string[] | "all"; done?: boolean }) => clearNotifications(svc, ids, done),
    onSuccess: (_, { ids, done }) => {
      if (ids === "all") toast("Marked all as read.");
      else if (done) toast("Marked as done.");
    },
    onError: toastError,
  });
  const open = (n: GitHubNotification) => {
    openExternal(webUrl(n.subject.url, n.repository.html_url));
    clear.mutate({ ids: [n.id] });
  };
  useListKeys({
    ids: items.map((n) => n.id),
    selected,
    onSelect: setSelected,
    onOpen: (id) => {
      const n = items.find((item) => item.id === id);
      if (n) open(n);
    },
  });

  if (items.length === 0) return <Empty title="No unread notifications" />;
  return (
    <>
      <div className="flex h-10 items-center border-b border-line px-5">
        <span className="text-sm text-muted">{items.length} unread</span>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          icon={<CheckCheck className="size-3.5" />}
          loading={clear.isPending && clear.variables?.ids === "all"}
          onClick={() => clear.mutate({ ids: "all" })}
        >
          Mark all read
        </Button>
      </div>
      {items.map((n) => {
        const Icon = SUBJECT_ICON[n.subject.type] ?? Bell;
        return (
          <div
            key={n.id}
            data-row-id={n.id}
            data-selected={selected === n.id || undefined}
            className="flex h-14 items-center gap-3 border-b border-line px-5 hover:bg-hover data-selected:bg-raised"
          >
            <Icon className="size-4 shrink-0 text-muted" />
            <button type="button" onClick={() => open(n)} className="flex min-w-0 flex-1 flex-col text-left">
              <span className="truncate">{n.subject.title}</span>
              <span className="truncate text-xs text-faint">{n.repository.full_name}</span>
            </button>
            <Badge>{n.reason.replaceAll("_", " ")}</Badge>
            <span className="w-20 shrink-0 text-right text-xs">
              <TimeAgo value={n.updated_at} />
            </span>
            <IconButton
              size="sm"
              label="Mark as read"
              icon={<Check className="size-3.5" />}
              onClick={() => clear.mutate({ ids: [n.id] })}
            />
            <IconButton
              size="sm"
              label="Done"
              icon={<CheckCheck className="size-3.5" />}
              onClick={() => clear.mutate({ ids: [n.id], done: true })}
            />
          </div>
        );
      })}
    </>
  );
}
