import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Bot,
  ChevronRight,
  CircleCheck,
  CircleX,
  GitBranch,
  GitPullRequest,
  PackageOpen,
  Rocket,
  ShieldAlert,
  Tag,
  type LucideIcon,
} from "lucide-react";
import { useHome } from "@/app/queries";
import { JobRefresh } from "@/modules/common";
import { projectLink } from "@/modules/links";
import type { HomeSummary } from "@/services/home";
import { openExternal } from "@/ui/external";
import { Page } from "@/ui/layout";
import { Spinner } from "@/ui/spinner";
import type { Tone } from "@/ui/tone";

export const Route = createFileRoute("/")({ component: Home });

type Target =
  | { path: "/projects" | "/inbox" | "/bots" | "/git" | "/changelogs" | "/deploys" }
  | { projectId: string }
  | { href: string };

interface Item {
  key: string;
  icon: LucideIcon;
  tone: Tone;
  title: string;
  detail?: string;
  target: Target;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Everything that needs a look, most urgent first. Nothing here means nothing to do. */
function attentionItems(home: HomeSummary): Item[] {
  const { major, minor, patch, projects } = home.updates;
  const updates = major + minor + patch;
  const breakdown = [major && `${major} major`, minor && `${minor} minor`, patch && `${patch} patch`].filter(Boolean);
  return [
    ...home.security.failingCi.map((item): Item => ({
      key: `security:${item.projectId}`,
      icon: ShieldAlert,
      tone: "bad",
      title: `${item.name} would fail the CI audit`,
      detail: plural(item.findings.length, "advisory", "advisories"),
      target: { projectId: item.projectId },
    })),
    ...home.ci.failing.map((run): Item => ({
      key: `ci:${run.url}`,
      icon: CircleX,
      tone: "bad",
      title: `${run.name}: CI failing`,
      detail: run.title,
      target: { href: run.url },
    })),
    ...home.deploys.failing.map((deploy): Item => ({
      key: `deploy:${deploy.provider}:${deploy.project}`,
      icon: Rocket,
      tone: "bad",
      title: `${deploy.project}: deploy failed`,
      detail: deploy.provider,
      target: deploy.url ? { href: deploy.url } : { path: "/deploys" },
    })),
    ...(home.myPullsFailing > 0
      ? [
          {
            key: "my-pulls",
            icon: GitPullRequest,
            tone: "warn",
            title: `${plural(home.myPullsFailing, "pull request")} with failing checks`,
            target: { path: "/inbox" },
          } satisfies Item,
        ]
      : []),
    ...(home.reviewRequests > 0
      ? [
          {
            key: "reviews",
            icon: GitPullRequest,
            tone: "info",
            title: plural(home.reviewRequests, "review request"),
            target: { path: "/inbox" },
          } satisfies Item,
        ]
      : []),
    ...(updates > 0
      ? [
          {
            key: "updates",
            icon: PackageOpen,
            tone: major > 0 ? "warn" : "neutral",
            title: `${plural(updates, "update")} in ${plural(projects, "project")}`,
            detail: breakdown.join(" · "),
            target: { path: "/projects" },
          } satisfies Item,
        ]
      : []),
    ...home.majorReleases.map((release): Item => ({
      key: `release:${release.repo}@${release.tag}`,
      icon: Tag,
      tone: "neutral",
      title: `${release.packageName ?? release.repo} ${release.tag}`,
      detail: release.usedBy.length > 0 ? `Major release · ${release.usedBy.join(", ")}` : "Major release",
      target: { path: "/changelogs" },
    })),
    ...(home.botPulls > 0
      ? [
          {
            key: "bots",
            icon: Bot,
            tone: "neutral",
            title: plural(home.botPulls, "bot pull request"),
            target: { path: "/bots" },
          } satisfies Item,
        ]
      : []),
    ...(home.dirty > 0
      ? [
          {
            key: "dirty",
            icon: GitBranch,
            tone: "neutral",
            title: `${plural(home.dirty, "project")} with uncommitted changes`,
            target: { path: "/git" },
          } satisfies Item,
        ]
      : []),
  ];
}

const ICON_TONE: Record<Tone, string> = {
  bad: "text-bad",
  warn: "text-warn",
  ok: "text-ok",
  info: "text-info",
  accent: "text-accent",
  neutral: "text-muted",
};

function Row({ item }: { item: Item }) {
  const Icon = item.icon;
  const body = (
    <>
      <Icon className={`size-4 shrink-0 ${ICON_TONE[item.tone]}`} />
      <span className="min-w-0 flex-1 truncate">{item.title}</span>
      {item.detail ? <span className="max-w-[45%] truncate text-sm text-muted">{item.detail}</span> : null}
      <ChevronRight className="size-4 shrink-0 text-faint" />
    </>
  );
  const className = "flex h-11 items-center gap-3 px-4 hover:bg-hover";
  const { target } = item;
  if ("href" in target) {
    return (
      <button type="button" className={`${className} w-full text-left`} onClick={() => openExternal(target.href)}>
        {body}
      </button>
    );
  }
  return "projectId" in target ? (
    <Link {...projectLink(target.projectId)} className={className}>
      {body}
    </Link>
  ) : (
    <Link to={target.path} className={className}>
      {body}
    </Link>
  );
}

function Home() {
  const { data: home } = useHome();
  if (!home) {
    return (
      <Page title="Home">
        <div className="flex justify-center p-10">
          <Spinner />
        </div>
      </Page>
    );
  }
  const items = attentionItems(home);

  return (
    <Page
      title="Home"
      subtitle={plural(home.projects, "project")}
      actions={<JobRefresh jobId="projects" label="Check now" />}
    >
      {items.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center gap-2 text-muted">
          <CircleCheck className="size-6 text-ok" />
          All clear
        </div>
      ) : (
        <div className="mx-auto max-w-3xl p-6">
          <div className="flex flex-col divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
            {items.map((item) => (
              <Row key={item.key} item={item} />
            ))}
          </div>
        </div>
      )}
    </Page>
  );
}
