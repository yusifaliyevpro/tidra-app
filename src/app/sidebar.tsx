import { Link, useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import { cn } from "cn";
import { useEffect, type MouseEvent } from "react";
import type { HomeSummary } from "@/services/home";
import { MODULES, type ModuleDef } from "./modules";
import { useHome } from "./queries";

type Count = { value: number; tone: "bad" | "warn" | "accent" | "muted"; title: string };

/** Counts only for things worth acting on; a number that is always there turns into wallpaper. */
function countFor(id: string, home: HomeSummary | undefined): Count | undefined {
  if (!home) return undefined;
  const urgent = home.security.bySeverity.critical + home.security.bySeverity.high;
  const value: Count | undefined = {
    projects: { value: home.updates.projects, tone: "muted", title: "Projects with updates" } as const,
    security: urgent
      ? ({ value: urgent, tone: "bad", title: "High and critical advisories" } as const)
      : { value: home.security.total, tone: "muted" as const, title: "Advisories" },
    actions: { value: home.actions.outdated, tone: "muted", title: "Outdated actions" } as const,
    git: {
      value: home.git.unpushed + home.git.dirty,
      tone: "warn",
      title: "Repos with unpushed or local changes",
    } as const,
    inbox: { value: home.reviewRequests, tone: "accent", title: "Review requests" } as const,
    ci: { value: home.ci.failing.length, tone: "bad", title: "Failing" } as const,
    bots: { value: home.botPulls, tone: "muted", title: "Open bot PRs" } as const,
    deploys: { value: home.deploys.failing.length, tone: "bad", title: "Failed deploys" } as const,
  }[id];
  return value && value.value > 0 ? value : undefined;
}

const COUNT_TONE: Record<Count["tone"], string> = {
  bad: "bg-bad/15 text-bad",
  warn: "text-warn",
  accent: "bg-accent/20 text-accent",
  muted: "text-faint",
};

/** Where each section was last left (path and search), so coming back resumes there instead of its root. */
const lastPlace = new Map<string, string>();

const owns = (m: ModuleDef, pathname: string) => (m.path === "/" ? pathname === "/" : pathname.startsWith(m.path));

function Item({ module, active, count }: { module: ModuleDef; active: boolean; count?: Count }) {
  const Icon = module.icon;
  const router = useRouter();
  const navigate = useNavigate();
  // Elsewhere: resume where this section was left. Already here: a second click goes back to its root.
  const onClick = (event: MouseEvent) => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    const resume = lastPlace.get(module.id);
    if (!active && resume) router.history.push(resume);
    else void navigate({ to: module.path });
  };
  return (
    <Link
      to={module.path}
      onClick={onClick}
      title={`${module.title}  (g then ${module.key})`}
      className={cn(
        "group flex h-7 items-center gap-2.5 rounded-md px-2 text-base transition-colors",
        active ? "bg-white/[0.07] text-fg" : "text-muted hover:bg-white/[0.04] hover:text-fg",
      )}
    >
      <Icon
        className={cn("size-4 shrink-0", active ? "text-fg" : "text-faint group-hover:text-muted")}
        strokeWidth={1.5}
      />
      <span className="min-w-0 flex-1 truncate">{module.title}</span>
      {count ? (
        <span
          title={count.title}
          className={cn("rounded px-1.5 text-xs leading-[18px] font-medium tabular", COUNT_TONE[count.tone])}
        >
          {count.value > 999 ? "999+" : count.value}
        </span>
      ) : null}
    </Link>
  );
}

const GROUP_TITLE = { main: undefined, github: "GitHub", more: "Tools" } as const;

export function Sidebar() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const href = useRouterState({ select: (state) => state.location.href });
  const { data: home } = useHome();
  const isActive = (m: ModuleDef) => owns(m, pathname);

  useEffect(() => {
    const current = MODULES.find((m) => owns(m, pathname));
    if (current) lastPlace.set(current.id, href);
  }, [pathname, href]);
  const settings = MODULES.find((m) => m.id === "settings");

  return (
    <nav aria-label="Modules" className="flex w-[208px] shrink-0 flex-col gap-4 overflow-y-auto px-2 py-3">
      {(["main", "github", "more"] as const).map((group) => (
        <div key={group} className="flex flex-col gap-px">
          {GROUP_TITLE[group] ? (
            <span className="px-2 pb-1 text-xs font-medium text-faint">{GROUP_TITLE[group]}</span>
          ) : null}
          {MODULES.filter((m) => m.group === group && m.id !== "settings").map((m) => (
            <Item key={m.id} module={m} active={isActive(m)} count={countFor(m.id, home)} />
          ))}
        </div>
      ))}
      {settings ? (
        <div className="mt-auto">
          <Item module={settings} active={isActive(settings)} />
        </div>
      ) : null}
    </nav>
  );
}
