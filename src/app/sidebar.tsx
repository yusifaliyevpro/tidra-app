import { Link, useRouterState } from "@tanstack/react-router";
import { cn } from "cn";
import { MODULES, type ModuleDef } from "./modules";
import { useHome } from "./queries";

function badgeFor(
  id: string,
  home: ReturnType<typeof useHome>["data"],
): { count: number; tone: "bad" | "accent" } | undefined {
  if (!home) return undefined;
  const value = {
    projects: { count: home.updates.major + home.updates.minor + home.updates.patch, tone: "accent" as const },
    security: { count: home.security.failingCi.length, tone: "bad" as const },
    ci: { count: home.ci.failing.length, tone: "bad" as const },
    inbox: { count: home.reviewRequests, tone: "accent" as const },
    bots: { count: home.botPulls, tone: "accent" as const },
    deploys: { count: home.deploys.failing.length, tone: "bad" as const },
  }[id];
  return value && value.count > 0 ? value : undefined;
}

function Item({ module, active, badge }: { module: ModuleDef; active: boolean; badge?: ReturnType<typeof badgeFor> }) {
  const Icon = module.icon;
  return (
    <Link
      to={module.path}
      title={`${module.title}  (g ${module.key})`}
      aria-label={module.title}
      className={cn(
        "relative flex size-9 items-center justify-center rounded-md transition-colors",
        active ? "bg-raised text-fg" : "text-muted hover:bg-hover hover:text-fg",
      )}
    >
      <Icon className="size-[18px]" strokeWidth={1.5} />
      {active ? <span className="absolute top-2 bottom-2 -left-2 w-0.5 rounded-full bg-accent" /> : null}
      {badge ? (
        <span
          className={cn(
            "absolute top-1 right-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-1 text-[10px] font-medium tabular",
            badge.tone === "bad" ? "bg-bad text-black" : "bg-accent text-accent-fg",
          )}
        >
          {badge.count > 99 ? "99" : badge.count}
        </span>
      ) : null}
    </Link>
  );
}

export function Sidebar() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { data: home } = useHome();
  const isActive = (m: ModuleDef) => (m.path === "/" ? pathname === "/" : pathname.startsWith(m.path));
  const groups = (["main", "github", "more"] as const).map((group) => ({
    group,
    items: MODULES.filter((m) => m.group === group && m.id !== "settings"),
  }));
  const settings = MODULES.find((m) => m.id === "settings");

  return (
    <nav aria-label="Modules" className="flex w-[52px] shrink-0 flex-col items-center gap-1 border-r border-line py-2">
      {groups.map(({ group, items }, index) => (
        <div key={group} className={cn("flex flex-col gap-1", index > 0 && "mt-1 border-t border-line pt-2")}>
          {items.map((m) => (
            <Item key={m.id} module={m} active={isActive(m)} badge={badgeFor(m.id, home)} />
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
