import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { register, unregisterAll } from "@tauri-apps/plugin-global-shortcut";
import * as z from "@zod/mini";
import { inTauri } from "@/core/native";
import type { Services } from "@/services/context";
import { updateTray } from "@/services/notify";
import { applyTheme, THEME_SETTING, THEMES } from "./theme";

export const HOTKEY_SETTING = "hotkey";
export const ACCENT_SETTING = "accent";
export const DEFAULT_HOTKEY = "CommandOrControl+Shift+Space";
export const DEFAULT_ACCENT = "#4565e8";

export async function applyAppearance(svc: Services) {
  const accent = await svc.store.getSetting(ACCENT_SETTING, z.string(), DEFAULT_ACCENT);
  document.documentElement.style.setProperty("--accent", accent);
  applyTheme(await svc.store.getSetting(THEME_SETTING, z.enum(THEMES), "system"));
}

async function toggleWindow() {
  const win = getCurrentWindow();
  if ((await win.isVisible()) && (await win.isFocused())) await win.hide();
  else {
    await win.show();
    await win.unminimize();
    await win.setFocus();
  }
}

/** Registers the show/hide hotkey; returns the error text when another app already owns the shortcut. */
export async function applyHotkey(svc: Services): Promise<string | undefined> {
  if (!inTauri) return undefined;
  const hotkey = await svc.store.getSetting(HOTKEY_SETTING, z.string(), DEFAULT_HOTKEY);
  await unregisterAll();
  if (!hotkey) return undefined;
  try {
    await register(hotkey, (event) => {
      if (event.state === "Pressed") void toggleWindow();
    });
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

export async function startDesktopIntegration(svc: Services) {
  if (!inTauri) return;
  await applyHotkey(svc);
  await listen<string>("tray://action", async (event) => {
    if (event.payload === "refresh") await svc.scheduler.runAll();
    if (event.payload === "pause") {
      svc.scheduler.setPaused(!svc.scheduler.isPaused());
      await updateTray(svc);
      await svc.queryClient.invalidateQueries({ queryKey: ["jobs"] });
    }
  });
}
