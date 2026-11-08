import { Outlet, useRouter } from "@tanstack/react-router";
import * as z from "@zod/mini";
import { useEffect, useState } from "react";
import { ReportIssueDialog } from "@/modules/report-issue";
import { ErrorBoundary } from "@/ui/error-boundary";
import { handleMarkdownLinkClick } from "@/ui/external";
import { Spinner } from "@/ui/spinner";
import { Toaster } from "@/ui/toaster";
import { DEFAULT_PALETTE_SHORTCUT, PALETTE_SHORTCUT_SETTING } from "./accelerator";
import { DismissedWorkChips } from "./dismissed-work";
import { Palette } from "./palette";
import { useJobs, useSetting } from "./queries";
import { useGlobalShortcuts } from "./shortcuts";
import { Sidebar, useSidebarCollapsed } from "./sidebar";
import { WindowButtons } from "./titlebar";

/** Chrome pieces fail on their own: a broken bell or sidebar count must never take the window down. */
const quiet = () => null;

/** A thin line under the header while background checks run; waits 250 ms so quick ones never flash. */
function ProgressLine() {
  const { data: jobs = [] } = useJobs();
  const running = jobs.filter((j) => j.running);
  if (running.length === 0) return null;
  return (
    <div
      aria-hidden="true"
      title={running.map((j) => j.title).join("\n")}
      className="pointer-events-none absolute inset-x-0 top-[43px] z-20 h-0.5 appear-late overflow-hidden"
    >
      <div className="h-full w-2/5 animate-progress rounded-full bg-info" />
    </div>
  );
}

/** What is being checked right now, and dismissed output dialogs, centered where the window title would be. */
function ActivityStatus() {
  const { data: jobs = [] } = useJobs();
  const running = jobs.filter((j) => j.running);
  const [first] = running;
  return (
    <div
      data-tauri-drag-region
      aria-live="polite"
      className="pointer-events-none absolute top-0 left-1/2 z-20 flex h-11 max-w-[44%] -translate-x-1/2 items-center gap-1.5"
    >
      <DismissedWorkChips />
      {first ? (
        <span
          title={running.map((j) => j.title).join("\n")}
          className="pointer-events-auto hidden min-w-0 appear-late items-center gap-2 rounded-full bg-selected px-2.5 py-0.5 text-sm text-muted lg:flex"
        >
          <Spinner className="size-3 shrink-0" />
          <span className="truncate">{first.title}</span>
          {running.length > 1 ? <span className="shrink-0 text-faint tabular">+{running.length - 1}</span> : null}
        </span>
      ) : null}
    </div>
  );
}

/** Mouse back/forward and Alt+arrows move through in-app history, like any desktop app. */
function useHistoryButtons() {
  const router = useRouter();
  useEffect(() => {
    const onMouse = (event: MouseEvent) => {
      if (event.button === 3) router.history.back();
      if (event.button === 4) router.history.forward();
    };
    const onKey = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === "ArrowLeft") router.history.back();
      if (event.key === "ArrowRight") router.history.forward();
    };
    window.addEventListener("mouseup", onMouse);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mouseup", onMouse);
      window.removeEventListener("keydown", onKey);
    };
  }, [router]);
}

export function Shell() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const openPalette = () => setPaletteOpen(true);
  const [collapsed, setCollapsed] = useSidebarCollapsed();
  const { data: paletteKey = DEFAULT_PALETTE_SHORTCUT } = useSetting(
    PALETTE_SHORTCUT_SETTING,
    z.string(),
    DEFAULT_PALETTE_SHORTCUT,
  );
  useGlobalShortcuts(openPalette, paletteKey, () => setCollapsed(!collapsed));
  useHistoryButtons();
  const { data: jobs = [] } = useJobs();

  useEffect(() => {
    document.addEventListener("click", handleMarkdownLinkClick);
    return () => document.removeEventListener("click", handleMarkdownLinkClick);
  }, []);

  return (
    <div className="flex h-full">
      <ErrorBoundary fallback={quiet}>
        <Sidebar onSearch={openPalette} searchShortcut={paletteKey} />
      </ErrorBoundary>
      <main
        aria-busy={jobs.some((j) => j.running)}
        className="relative my-2 mr-2 min-w-0 flex-1 overflow-hidden rounded-xl border border-line bg-canvas shadow-canvas"
      >
        <Outlet />
        <ErrorBoundary fallback={quiet}>
          <ProgressLine />
          <ActivityStatus />
        </ErrorBoundary>
        <WindowButtons className="absolute top-2 right-2 z-30" />
      </main>
      <ErrorBoundary fallback={quiet}>
        <Palette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      </ErrorBoundary>
      <ErrorBoundary fallback={quiet}>
        <ReportIssueDialog />
      </ErrorBoundary>
      <Toaster />
    </div>
  );
}
