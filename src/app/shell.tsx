import { Outlet } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { handleMarkdownLinkClick } from "@/ui/external";
import { Toaster } from "@/ui/toaster";
import { Palette } from "./palette";
import { useGlobalShortcuts } from "./shortcuts";
import { Sidebar } from "./sidebar";
import { Titlebar } from "./titlebar";

export function Shell() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const openPalette = () => setPaletteOpen(true);
  useGlobalShortcuts(openPalette);

  useEffect(() => {
    document.addEventListener("click", handleMarkdownLinkClick);
    return () => document.removeEventListener("click", handleMarkdownLinkClick);
  }, []);

  return (
    <div className="flex h-full flex-col">
      <Titlebar onSearch={openPalette} />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="min-w-0 flex-1 bg-bg">
          <Outlet />
        </main>
      </div>
      <Palette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <Toaster />
    </div>
  );
}
