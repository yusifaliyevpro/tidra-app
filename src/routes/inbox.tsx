import { useMutation } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import * as z from "@zod/mini";
import { Bell, Check, CheckCheck, CircleDot, GitPullRequest, MessageSquare, Tag, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { useBotPulls, useInbox } from "@/app/queries";
import { useServices } from "@/app/services";
import { useListKeys } from "@/app/shortcuts";
import type { GitHubNotification } from "@/integrations/github";
import { JobRefresh } from "@/modules/common";
import { ChecksIcon } from "@/modules/pulls";
import { clearNotifications, type PullSummary } from "@/services/github-feed";
import { Badge } from "@/ui/badge";
import { Button, IconButton } from "@/ui/button";
import { openExternal } from "@/ui/external";
import { Chip, Empty, ErrorNote, Page } from "@/ui/layout";
import { TimeAgo } from "@/ui/time";
import { toastError } from "@/ui/toast";

const FILTERS = ["mine", "reviews", "bots", "unread"] as const;
type Filter = (typeof FILTERS)[number];

export const Route = createFileRoute("/inbox")({
  validateSearch: z.object({ filter: z.optional(z.enum(FILTERS)) }),
  component: Inbox,
});

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
  const { data: bots } = useBotPulls();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const filter = search.filter ?? "mine";

  if (data?.error) {
    return (
      <Page title="Pull requests">
        <Empty
          title="GitHub isn't connected"
          action={
            <Link to="/settings" search={{ section: "github" }}>
              <Button variant="primary" size="sm" tabIndex={-1}>
                Connect GitHub
              </Button>
            </Link>
          }
        />
      </Page>
    );
  }

  const reviews = data?.reviewRequests ?? [];
  const mine = data?.myPulls ?? [];
  const botPulls = bots?.pulls ?? [];
  const unread = (data?.notifications ?? []).filter((n) => n.unread);
  const filters: { id: Filter; label: string; count: number }[] = [
    { id: "mine", label: "Yours", count: mine.length },
    { id: "reviews", label: "Review requests", count: reviews.length },
    { id: "bots", label: "Bots", count: botPulls.length },
    { id: "unread", label: "Notifications", count: unread.length },
  ];

  return (
    <Page
      title="Pull requests"
      actions={<JobRefresh jobId={filter === "bots" ? "bot-pulls" : "inbox"} />}
      toolbar={filters.map(({ id, label, count }) => (
        <Chip
          key={id}
          active={filter === id}
          count={count}
          onClick={() => void navigate({ search: { filter: id === "mine" ? undefined : id }, replace: true })}
        >
          {label}
        </Chip>
      ))}
    >
      <InboxList filter={filter} pulls={{ mine, reviews, bots: botPulls }} unread={unread} botsError={bots?.error} />
    </Page>
  );
}

const EMPTY: Record<Exclude<Filter, "unread">, string> = {
  mine: "No open pull requests",
  reviews: "No reviews requested",
  bots: "No open bot pull requests",
};

function InboxList({
  filter,
  pulls,
  unread,
  botsError,
}: {
  filter: Filter;
  pulls: Record<Exclude<Filter, "unread">, PullSummary[]>;
  unread: GitHubNotification[];
  botsError: string | undefined;
}) {
  if (filter === "unread") return <Notifications items={unread} />;
  if (filter === "bots" && botsError) {
    return (
      <div className="p-5">
        <ErrorNote>{botsError}</ErrorNote>
      </div>
    );
  }
  return <Pulls pulls={pulls[filter]} empty={EMPTY[filter]} review={filter === "reviews"} />;
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
          className="group flex h-12 items-center gap-3 border-b border-line px-5 hover:bg-hover data-selected:bg-selected"
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
            className="flex h-12 items-center gap-3 border-b border-line px-5 hover:bg-hover data-selected:bg-selected"
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
