import { Outlet } from "@tanstack/react-router";
import * as z from "@zod/mini";
import { useEffect, useState } from "react";
import { ErrorBoundary } from "@/ui/error-boundary";
import { handleMarkdownLinkClick } from "@/ui/external";
import { Toaster } from "@/ui/toaster";
import { DEFAULT_PALETTE_SHORTCUT, PALETTE_SHORTCUT_SETTING } from "./accelerator";
import { Activity } from "./activity";
import { NotificationBell } from "./notifications";
import { Palette } from "./palette";
import { useSetting } from "./queries";
import { useGlobalShortcuts } from "./shortcuts";
import { Sidebar } from "./sidebar";
import { Titlebar } from "./titlebar";

/** Chrome pieces fail on their own: a broken bell or sidebar count must never take the window down. */
const quiet = () => null;

export function Shell() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const openPalette = () => setPaletteOpen(true);
  const { data: paletteKey = DEFAULT_PALETTE_SHORTCUT } = useSetting(
    PALETTE_SHORTCUT_SETTING,
    z.string(),
    DEFAULT_PALETTE_SHORTCUT,
  );
  useGlobalShortcuts(openPalette, paletteKey);

  useEffect(() => {
    document.addEventListener("click", handleMarkdownLinkClick);
    return () => document.removeEventListener("click", handleMarkdownLinkClick);
  }, []);

  return (
    <div className="flex h-full flex-col">
      <Titlebar
        onSearch={openPalette}
        searchShortcut={paletteKey}
        tools={
          <ErrorBoundary fallback={quiet}>
            <Activity />
            <NotificationBell />
          </ErrorBoundary>
        }
      />
      <div className="flex min-h-0 flex-1">
        <ErrorBoundary fallback={quiet}>
          <Sidebar />
        </ErrorBoundary>
        <main className="min-w-0 flex-1 overflow-hidden rounded-tl-lg border-t border-l border-line bg-bg">
          <Outlet />
        </main>
      </div>
      <ErrorBoundary fallback={quiet}>
        <Palette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      </ErrorBoundary>
      <Toaster />
    </div>
  );
}
