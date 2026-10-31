import { useMutation, useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { useServices } from "@/app/services";
import type { ChangelogEntry } from "@/engine/changelog";
import { aiReady, readUpgradeSummary, summarize } from "@/services/ai";
import { changelogFor, type ChangelogResult } from "@/services/changelogs";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { ErrorNote, Note, Section } from "@/ui/layout";
import { ExternalLink, Markdown } from "@/ui/markdown";
import { Spinner } from "@/ui/spinner";
import { TimeAgo } from "@/ui/time";

interface Upgrade {
  name: string;
  from: string | undefined;
  to: string;
}

/** Release notes from the installed version up to `to`, with an optional AI summary of breaking changes. */
export function ChangelogPanel({ name, from, to }: Upgrade) {
  const svc = useServices();
  const changelog = useQuery({
    queryKey: ["changelog", name, from, to],
    queryFn: () => changelogFor(svc, name, from, to),
  });

  if (changelog.isPending) {
    return (
      <div className="flex justify-center p-8">
        <Spinner />
      </div>
    );
  }
  if (changelog.error) return <ErrorNote>{changelog.error.message}</ErrorNote>;
  const { entries, repo, rateLimited } = changelog.data;

  return (
    <div className="flex flex-col gap-4">
      <ChangelogHeader changelog={changelog.data} />
      {rateLimited ? <Note>GitHub rate limit reached. Add a token in Settings.</Note> : null}
      {entries.length > 0 ? <UpgradeSummary upgrade={{ name, from, to }} entries={entries} /> : null}
      {entries.length === 0 ? (
        <Note>
          {repo ? "No release notes found for these versions." : "This package doesn't link to a GitHub repository."}
        </Note>
      ) : (
        entries.toReversed().map((entry) => <Release key={entry.version} entry={entry} />)
      )}
    </div>
  );
}

function ChangelogHeader({ changelog: { entries, repo, source } }: { changelog: ChangelogResult }) {
  const breaking = entries.filter((e) => e.breaking).length;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
      <span>
        {entries.length} {entries.length === 1 ? "release" : "releases"}
      </span>
      {breaking > 0 ? <Badge tone="bad">{breaking} breaking</Badge> : null}
      {repo ? (
        <ExternalLink href={`https://github.com/${repo.owner}/${repo.repo}`} className="text-faint hover:text-fg">
          {repo.owner}/{repo.repo}
        </ExternalLink>
      ) : null}
      {source === "changelog" ? <span className="text-faint">from CHANGELOG.md</span> : null}
    </div>
  );
}

/** Hidden until an AI provider is set up; the summary is cached per upgrade. */
function UpgradeSummary({ upgrade, entries }: { upgrade: Upgrade; entries: ChangelogEntry[] }) {
  const svc = useServices();
  const { name, from, to } = upgrade;
  const ready = useQuery({ queryKey: ["ai-ready"], queryFn: () => aiReady(svc) });
  const cached = useQuery({
    queryKey: ["ai-summary", name, from, to],
    queryFn: async () => (await readUpgradeSummary(svc, name, from, to)) ?? null,
  });
  const summary = useMutation({
    mutationFn: () => summarize(svc, { name, from, to, entries }),
    onSuccess: () => void cached.refetch(),
  });
  if (!ready.data) return null;
  const shown = cached.data;

  return (
    <Section
      title={shown ? `Summary · ${shown.model}` : "Summary"}
      actions={
        <Button
          size="sm"
          icon={<Sparkles className="size-3.5" />}
          loading={summary.isPending}
          onClick={() => summary.mutate()}
        >
          {shown ? "Summarize again" : "Summarize breaking changes"}
        </Button>
      }
    >
      {summary.error ? <ErrorNote>{summary.error.message}</ErrorNote> : null}
      {shown ? (
        <div className="rounded-md border border-accent/20 bg-accent/5 p-3">
          <Markdown source={shown.text} />
        </div>
      ) : null}
    </Section>
  );
}

function Release({ entry }: { entry: ChangelogEntry }) {
  return (
    <article className="flex flex-col gap-1.5 border-t border-line pt-3">
      <header className="flex items-center gap-2">
        <span className="font-mono font-medium">{entry.version}</span>
        {entry.breaking ? <Badge tone="bad">breaking</Badge> : null}
        {entry.url ? (
          <ExternalLink href={entry.url} className="text-sm text-faint hover:text-fg">
            {entry.title !== entry.version ? entry.title : "Release"}
          </ExternalLink>
        ) : null}
        <span className="ml-auto text-xs">{entry.publishedAt ? <TimeAgo value={entry.publishedAt} /> : null}</span>
      </header>
      {entry.body ? <Markdown source={entry.body} /> : <p className="text-sm text-faint">No notes.</p>}
    </article>
  );
}
