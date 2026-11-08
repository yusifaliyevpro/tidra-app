import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import * as z from "@zod/mini";
import { cn } from "cn";
import { Pause, Search } from "lucide-react";
import { useEffect, type MouseEvent, type ReactNode } from "react";
import { projectLink } from "@/modules/links";
import type { HomeSummary } from "@/services/home";
import { PINNED_SETTING, pinnedSchema } from "@/services/pins";
import { countFor, type Count } from "@/services/sidebar-counts";
import { projectStatus } from "@/services/status";
import { Kbd } from "@/ui/layout";
import { StatusGlyph } from "@/ui/status-glyph";
import { acceleratorKeys } from "./accelerator";
import { AppUpdateButton } from "./app-update";
import { MODULES, type ModuleDef } from "./modules";
import { NotificationBell } from "./notifications";
import { useHome, useJobs, useSetting } from "./queries";
import { useServices } from "./services";

const COUNT_TONE: Record<Count["tone"], string> = {
  bad: "bg-bad/13 text-bad",
  warn: "text-warn",
  accent: "bg-accent-bg text-accent-text",
  plain: "text-faint",
};

/** Where each section was last left (path and search), so coming back resumes there instead of its root. */
const lastPlace = new Map<string, string>();

const owns = (m: ModuleDef, pathname: string) => (m.path === "/" ? pathname === "/" : pathname.startsWith(m.path));

const ROW = "flex h-7 items-center gap-2.5 rounded-md px-2 text-base transition-colors duration-[80ms]";

function Item({
  module,
  active,
  count,
  collapsed,
}: {
  module: ModuleDef;
  active: boolean;
  count?: Count;
  collapsed: boolean;
}) {
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
      aria-label={collapsed ? module.title : undefined}
      title={`${module.title}  (g then ${module.key})`}
      className={cn(
        ROW,
        "group",
        collapsed && "justify-center px-0",
        active ? "bg-selected text-fg" : "text-muted hover:bg-hover hover:text-fg",
      )}
    >
      <Icon
        className={cn("size-4 shrink-0", active ? "text-fg" : "text-faint group-hover:text-muted")}
        strokeWidth={1.5}
      />
      {collapsed ? null : <span className="min-w-0 flex-1 truncate">{module.title}</span>}
      {count && !collapsed ? (
        <span
          title={count.title}
          className={cn(
            "flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-xs font-medium tabular",
            COUNT_TONE[count.tone],
          )}
        >
          {count.value > 999 ? "999+" : count.value}
        </span>
      ) : null}
    </Link>
  );
}

function GroupLabel({ children }: { children: ReactNode }) {
  return <span className="mt-3 flex h-6 items-center px-2 text-xs font-medium text-faint">{children}</span>;
}

function Pinned({ home, pathname }: { home: HomeSummary | undefined; pathname: string }) {
  const { data: pinned = [] } = useSetting(PINNED_SETTING, pinnedSchema, []);
  const { data: jobs = [] } = useJobs();
  const checking = jobs.some((j) => j.id === "projects" && j.running);
  const health = new Map((home?.health ?? []).map((h) => [h.id, h]));
  const rows = pinned.flatMap((id) => {
    const h = health.get(id);
    return h ? [h] : [];
  });
  if (rows.length === 0) return null;
  return (
    <>
      <GroupLabel>Pinned</GroupLabel>
      {rows.map((h) => {
        const link = projectLink(h.id);
        const active = pathname === `/projects/${encodeURIComponent(h.id)}` || pathname === `/projects/${h.id}`;
        return (
          <Link
            key={h.id}
            {...link}
            className={cn(ROW, active ? "bg-selected text-fg" : "text-muted hover:bg-hover hover:text-fg")}
          >
            <span className="flex size-4 items-center justify-center">
              <StatusGlyph status={projectStatus(h, checking)} />
            </span>
            <span className="min-w-0 flex-1 truncate">{h.name}</span>
          </Link>
        );
      })}
    </>
  );
}

function SearchButton({ onSearch, shortcut }: { onSearch: () => void; shortcut: string }) {
  return (
    <button
      type="button"
      onClick={onSearch}
      className="mb-2.5 flex h-[30px] items-center gap-2 rounded-md border border-line bg-canvas px-2 text-sm text-faint transition-colors hover:border-line-strong hover:text-muted"
    >
      <Search className="size-3.5 shrink-0" />
      Search
      <span className="ml-auto flex gap-0.5">
        {acceleratorKeys(shortcut).map((key) => (
          <Kbd key={key}>{key}</Kbd>
        ))}
      </span>
    </button>
  );
}

export const SIDEBAR_COLLAPSED = "sidebarCollapsed";

function useLocalFlag(key: string) {
  const svc = useServices();
  const queryClient = useQueryClient();
  const { data = false } = useQuery({
    queryKey: ["local", key],
    queryFn: () => svc.store.getLocal(key, z.boolean(), false),
  });
  const set = (value: boolean) => {
    queryClient.setQueryData(["local", key], value);
    void svc.store.setLocal(key, value);
  };
  return [data, set] as const;
}

export function useSidebarCollapsed() {
  return useLocalFlag(SIDEBAR_COLLAPSED);
}

export function Sidebar({ onSearch, searchShortcut }: { onSearch: () => void; searchShortcut: string }) {
  const svc = useServices();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const href = useRouterState({ select: (state) => state.location.href });
  const { data: home } = useHome();
  const [collapsed] = useSidebarCollapsed();
  const isActive = (m: ModuleDef) => owns(m, pathname);

  useEffect(() => {
    const current = MODULES.find((m) => owns(m, pathname));
    if (current) lastPlace.set(current.id, href);
  }, [pathname, href]);
  const item = (m: ModuleDef) => (
    <Item key={m.id} module={m} active={isActive(m)} count={countFor(m.id, home)} collapsed={collapsed} />
  );

  return (
    <nav
      aria-label="Sidebar"
      className={cn(
        "flex shrink-0 flex-col gap-0.5 overflow-y-auto px-2.5 pt-1.5 pb-2",
        collapsed ? "w-[52px] px-2" : "w-[224px]",
      )}
    >
      <div data-tauri-drag-region className="flex h-9 shrink-0 items-center gap-2 px-1.5 drag">
        <img src="/logo.svg" alt="" className="size-4" draggable={false} />
        {collapsed ? null : (
          <>
            <span data-tauri-drag-region className="font-medium">
              Tidra
            </span>
            <span className="ml-auto no-drag">
              <NotificationBell />
            </span>
          </>
        )}
      </div>
      {collapsed ? null : <SearchButton onSearch={onSearch} shortcut={searchShortcut} />}
      {MODULES.filter((m) => m.group === "main").map(item)}
      {collapsed ? null : <Pinned home={home} pathname={pathname} />}
      {collapsed ? <span className="my-2 h-px bg-line" /> : <GroupLabel>Tools</GroupLabel>}
      {MODULES.filter((m) => m.group === "tools").map(item)}
      <div className="mt-auto flex flex-col gap-1.5 pt-3">
        {collapsed ? null : <AppUpdateButton />}
        {svc.scheduler.isPaused() && !collapsed ? (
          <span className="flex h-7 items-center gap-2.5 px-2 text-sm text-faint" title="Background checks are paused">
            <Pause className="size-4" strokeWidth={1.5} />
            Checks paused
          </span>
        ) : null}
        {MODULES.filter((m) => m.group === "settings").map(item)}
      </div>
    </nav>
  );
}
