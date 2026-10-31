import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { cn } from "cn";
import { Plus, ScrollText, X } from "lucide-react";
import { useState } from "react";
import { useTimeline } from "@/app/queries";
import { useServices } from "@/app/services";
import { useListKeys } from "@/app/shortcuts";
import { githubSlug } from "@/engine/git";
import { JobRefresh } from "@/modules/common";
import type { TimelineItem } from "@/services/changelogs";
import { Badge } from "@/ui/badge";
import { Button, IconButton } from "@/ui/button";
import { Dialog } from "@/ui/dialog";
import { Field, Input } from "@/ui/field";
import { Empty, ErrorNote, Page, Split } from "@/ui/layout";
import { ExternalLink, Markdown } from "@/ui/markdown";
import { Spinner } from "@/ui/spinner";
import { TimeAgo } from "@/ui/time";
import { toastError } from "@/ui/toast";

export const Route = createFileRoute("/changelogs")({ component: Changelogs });

const keyOf = (item: TimelineItem) => `${item.repo}@${item.tag}`;

function Changelogs() {
  const { data: timeline, isPending } = useTimeline();
  const [watching, setWatching] = useState(false);

  return (
    <Page
      title="Changelogs"
      subtitle="Last 45 days"
      className="overflow-hidden"
      actions={
        <>
          <JobRefresh jobId="timeline" />
          <Button icon={<Plus className="size-4" />} onClick={() => setWatching(true)}>
            Watch repos
          </Button>
        </>
      }
    >
      {isPending ? (
        <div className="flex justify-center p-10">
          <Spinner />
        </div>
      ) : !timeline?.items.length ? (
        <Empty icon={<ScrollText />} title="No recent releases" />
      ) : (
        <Timeline items={timeline.items} error={timeline.errors[0]} />
      )}
      <WatchDialog open={watching} onClose={() => setWatching(false)} />
    </Page>
  );
}

function Timeline({ items, error }: { items: TimelineItem[]; error?: string }) {
  const [selected, setSelected] = useState<string>();
  const current = items.find((i) => keyOf(i) === selected) ?? items[0];
  const currentKey = current ? keyOf(current) : undefined;
  useListKeys({ ids: items.map(keyOf), selected: currentKey, onSelect: setSelected });

  return (
    <Split
      listWidth={400}
      list={
        <div className="min-h-0 flex-1 overflow-y-auto">
          {error ? (
            <div className="border-b border-line p-3">
              <ErrorNote>{error}</ErrorNote>
            </div>
          ) : null}
          {items.map((item) => (
            <TimelineRow
              key={keyOf(item)}
              item={item}
              selected={keyOf(item) === currentKey}
              onSelect={() => setSelected(keyOf(item))}
            />
          ))}
        </div>
      }
      detail={current ? <ReleaseNotes item={current} /> : null}
    />
  );
}

function TimelineRow({ item, selected, onSelect }: { item: TimelineItem; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      data-row-id={keyOf(item)}
      onClick={onSelect}
      className={cn(
        "flex w-full flex-col gap-0.5 border-b border-line px-4 py-2 text-left hover:bg-hover",
        selected && "bg-raised",
      )}
    >
      <span className="flex items-center gap-2">
        <span className="truncate font-medium">{item.packageName ?? item.repo}</span>
        <span className="font-mono text-sm text-muted">{item.tag}</span>
        {item.major ? <Badge tone="bad">major</Badge> : null}
        <span className="ml-auto shrink-0 text-xs">
          <TimeAgo value={item.publishedAt} />
        </span>
      </span>
      <span className="truncate text-xs text-faint">
        {item.usedBy.length > 0 ? `Used by ${item.usedBy.join(", ")}` : "Watched"}
      </span>
    </button>
  );
}

function ReleaseNotes({ item }: { item: TimelineItem }) {
  return (
    <article className="flex flex-col gap-3 p-5">
      <header className="flex items-center gap-2">
        <h2 className="text-lg font-medium">{item.title}</h2>
        {item.url ? (
          <ExternalLink href={item.url} className="ml-auto text-sm text-faint hover:text-fg">
            {item.repo}
          </ExternalLink>
        ) : null}
      </header>
      {item.body ? <Markdown source={item.body} /> : <p className="text-muted">No notes.</p>}
    </article>
  );
}

function WatchDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const svc = useServices();
  const queryClient = useQueryClient();
  const [value, setValue] = useState("");
  const { data: repos } = useQuery({ queryKey: ["watched"], queryFn: () => svc.store.listWatchedRepos() });
  const slug = githubSlug(value.includes("/") && !value.includes("://") ? `https://github.com/${value}` : value);

  const add = useMutation({
    mutationFn: async () => {
      if (!slug) throw new Error("Enter owner/repo or a GitHub URL.");
      await svc.store.watchRepo(slug.owner, slug.repo);
    },
    onSuccess: async () => {
      setValue("");
      await queryClient.invalidateQueries({ queryKey: ["watched"] });
    },
    onError: toastError,
  });
  const remove = useMutation({
    mutationFn: (id: string) => svc.store.unwatchRepo(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["watched"] }),
  });

  return (
    <Dialog open={open} onClose={onClose} title="Watched repositories">
      <div className="flex flex-col gap-4">
        <Field label="Repository" hint="owner/repo or a GitHub URL">
          {(id) => (
            <div className="flex gap-2">
              <Input
                id={id}
                value={value}
                placeholder="vitejs/vite"
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && add.mutate()}
              />
              <Button variant="primary" disabled={!slug} loading={add.isPending} onClick={() => add.mutate()}>
                Watch
              </Button>
            </div>
          )}
        </Field>
        <div className="flex flex-col rounded-md border border-line">
          {(repos ?? []).length === 0 ? <p className="p-3 text-sm text-muted">None yet.</p> : null}
          {(repos ?? []).map((repo) => (
            <div key={repo.id} className="flex h-9 items-center border-b border-line px-3 last:border-b-0">
              <span className="font-mono text-sm">
                {repo.owner}/{repo.repo}
              </span>
              <IconButton
                size="sm"
                label={`Stop watching ${repo.owner}/${repo.repo}`}
                className="ml-auto"
                icon={<X className="size-3.5" />}
                onClick={() => remove.mutate(repo.id)}
              />
            </div>
          ))}
        </div>
      </div>
    </Dialog>
  );
}
