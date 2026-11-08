import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { cn } from "cn";
import { Plus, X } from "lucide-react";
import { useState } from "react";
import { useReports, useTimeline } from "@/app/queries";
import { useServices } from "@/app/services";
import { useListKeys } from "@/app/shortcuts";
import { githubSlug } from "@/engine/git";
import { JobRefresh } from "@/modules/common";
import { readWatchedPackages, setPackageWatched, type TimelineItem } from "@/services/changelogs";
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

function useWatched() {
  const svc = useServices();
  return useQuery({
    queryKey: ["watched"],
    queryFn: async () => ({ repos: await svc.store.listWatchedRepos(), packages: await readWatchedPackages(svc) }),
  });
}

function Changelogs() {
  const { data: timeline, isPending } = useTimeline();
  const { data: watched } = useWatched();
  const watchCount = (watched?.repos.length ?? 0) + (watched?.packages.length ?? 0);
  const [watching, setWatching] = useState(false);

  return (
    <Page
      title="Changelogs"

      className="overflow-hidden"
      actions={
        <>
          <JobRefresh jobId="timeline" />
          <Button icon={<Plus className="size-4" />} onClick={() => setWatching(true)}>
            Watch
          </Button>
        </>
      }
    >
      {isPending ? (
        <div className="flex justify-center p-10">
          <Spinner />
        </div>
      ) : !timeline?.items.length ? (
        <Empty
          title={watchCount > 0 ? "No releases in the last 45 days" : "Nothing watched"}
          action={
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setWatching(true)}>
              Watch packages
            </Button>
          }
        />
      ) : (
        <Timeline items={timeline.items} error={timeline.errors[0]} />
      )}
      <WatchDialog open={watching} onClose={() => setWatching(false)} />
    </Page>
  );
}

interface Feed {
  name: string;
  releases: TimelineItem[];
  usedBy: string[];
  major: boolean;
}

/** One entry per package or repo, newest release first, instead of one row per tag. */
function feeds(items: TimelineItem[]): Feed[] {
  const groups = Map.groupBy(items, (item) => item.packageName ?? item.repo);
  return [...groups]
    .map(([name, releases]) => ({
      name,
      releases: releases.toSorted((x, y) => Date.parse(y.publishedAt) - Date.parse(x.publishedAt)),
      usedBy: [...new Set(releases.flatMap((r) => r.usedBy))],
      major: releases.some((r) => r.major),
    }))
    .toSorted((x, y) => Date.parse(y.releases[0]?.publishedAt ?? "") - Date.parse(x.releases[0]?.publishedAt ?? ""));
}

function Timeline({ items, error }: { items: TimelineItem[]; error?: string }) {
  const [selected, setSelected] = useState<string>();
  const list = feeds(items);
  const current = list.find((f) => f.name === selected) ?? list[0];
  useListKeys({ ids: list.map((f) => f.name), selected: current?.name, onSelect: setSelected });

  return (
    <Split
      listWidth={340}
      list={
        <div className="min-h-0 flex-1 overflow-y-auto">
          {error ? (
            <div className="border-b border-line p-3">
              <ErrorNote>{error}</ErrorNote>
            </div>
          ) : null}
          {list.map((feed) => (
            <FeedRow
              key={feed.name}
              feed={feed}
              selected={feed.name === current?.name}
              onSelect={() => setSelected(feed.name)}
            />
          ))}
        </div>
      }
      detail={current ? <FeedNotes key={current.name} feed={current} /> : null}
    />
  );
}

function FeedRow({ feed, selected, onSelect }: { feed: Feed; selected: boolean; onSelect: () => void }) {
  const [latest] = feed.releases;
  return (
    <button
      type="button"
      data-row-id={feed.name}
      onClick={onSelect}
      className={cn(
        "flex w-full flex-col gap-0.5 border-b border-line px-4 py-2.5 text-left hover:bg-hover",
        selected && "bg-selected",
      )}
    >
      <span className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-medium">{feed.name}</span>
        <span className="shrink-0 text-xs">
          <TimeAgo value={latest?.publishedAt} />
        </span>
      </span>
      <span className="flex items-center gap-2 text-xs text-faint">
        <span className={cn("font-mono", feed.major ? "text-bad" : "text-muted")}>{latest?.tag}</span>
        {feed.releases.length > 1 ? <span>+{feed.releases.length - 1} earlier</span> : null}
        <span className="ml-auto truncate" title={feed.usedBy.join(", ")}>
          {feed.usedBy.length > 0
            ? `${feed.usedBy.length} ${feed.usedBy.length === 1 ? "project" : "projects"}`
            : "Watched"}
        </span>
      </span>
    </button>
  );
}

function FeedNotes({ feed }: { feed: Feed }) {
  return (
    <div className="flex flex-col">
      <header className="flex flex-col gap-2 border-b border-line px-5 py-4">
        <h2 className="text-lg font-medium">{feed.name}</h2>
        {feed.usedBy.length > 0 ? <p className="text-sm text-muted">Used by {feed.usedBy.join(", ")}</p> : null}
      </header>
      {feed.releases.map((item) => (
        <div key={keyOf(item)} className="border-b border-line last:border-b-0">
          <ReleaseNotes item={item} />
        </div>
      ))}
    </div>
  );
}

function ReleaseNotes({ item }: { item: TimelineItem }) {
  return (
    <article className="flex flex-col gap-3 p-5">
      <header className="flex items-center gap-2">
        <h3 className="font-mono font-medium">{item.tag}</h3>
        {item.major ? <Badge tone="bad">major</Badge> : null}
        <span className="text-xs">
          <TimeAgo value={item.publishedAt} />
        </span>
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
  const { data: rows } = useReports();
  const { data: watched } = useWatched();
  const query = value.trim();
  const isPackage = query.startsWith("@") || (!query.includes("/") && query.length > 0);
  const slug = isPackage ? undefined : githubSlug(query.includes("://") ? query : `https://github.com/${query}`);
  const watchedPackages = new Set(watched?.packages ?? []);
  const dependencies = [...new Set((rows ?? []).flatMap(({ report }) => report?.dependencies.map((d) => d.name) ?? []))]
    .filter((name) => !watchedPackages.has(name) && (!query || name.includes(query)))
    .toSorted()
    .slice(0, 8);

  const changed = async () => {
    await queryClient.invalidateQueries({ queryKey: ["watched"] });
    void svc.scheduler.runNow("timeline");
  };
  const add = useMutation({
    mutationFn: async (target: { package: string } | { owner: string; repo: string }) => {
      if ("package" in target) await setPackageWatched(svc, target.package, true);
      else await svc.store.watchRepo(target.owner, target.repo);
    },
    onSuccess: async () => {
      setValue("");
      await changed();
    },
    onError: toastError,
  });
  const removeRepo = useMutation({ mutationFn: (id: string) => svc.store.unwatchRepo(id), onSuccess: changed });
  const removePackage = useMutation({
    mutationFn: (name: string) => setPackageWatched(svc, name, false),
    onSuccess: changed,
  });
  const submit = () => {
    if (isPackage) add.mutate({ package: query });
    else if (slug) add.mutate(slug);
  };

  return (
    <Dialog open={open} onClose={onClose} title="Watch releases" className="w-[560px]">
      <div className="flex flex-col gap-4">
        <Field label="Package or repository">
          {(id) => (
            <div className="flex gap-2">
              <Input
                id={id}
                value={value}
                placeholder="vite or vitejs/vite"
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
              />
              <Button variant="primary" disabled={!isPackage && !slug} loading={add.isPending} onClick={submit}>
                Watch
              </Button>
            </div>
          )}
        </Field>
        {dependencies.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted">From your projects</span>
            <div className="flex flex-wrap gap-1.5">
              {dependencies.map((name) => (
                <Button
                  key={name}
                  size="sm"
                  icon={<Plus className="size-3" />}
                  onClick={() => add.mutate({ package: name })}
                >
                  {name}
                </Button>
              ))}
            </div>
          </div>
        ) : null}
        <div className="flex flex-col rounded-md border border-line">
          {!watched?.repos.length && !watched?.packages.length ? (
            <p className="p-3 text-sm text-muted">Nothing watched yet</p>
          ) : null}
          {(watched?.packages ?? []).map((name) => (
            <WatchedRow key={name} label={name} kind="package" onRemove={() => removePackage.mutate(name)} />
          ))}
          {(watched?.repos ?? []).map((repo) => (
            <WatchedRow
              key={repo.id}
              label={`${repo.owner}/${repo.repo}`}
              kind="repository"
              onRemove={() => removeRepo.mutate(repo.id)}
            />
          ))}
        </div>
      </div>
    </Dialog>
  );
}

function WatchedRow({ label, kind, onRemove }: { label: string; kind: string; onRemove: () => void }) {
  return (
    <div className="flex h-9 items-center gap-2 border-b border-line px-3 last:border-b-0">
      <span className="font-mono text-sm">{label}</span>
      <span className="text-xs text-faint">{kind}</span>
      <IconButton
        size="sm"
        label={`Stop watching ${label}`}
        className="ml-auto"
        icon={<X className="size-3.5" />}
        onClick={onRemove}
      />
    </div>
  );
}
