import { getCurrentWindow } from "@tauri-apps/api/window";
import { inTauri } from "@/core/native";

export const THEME_SETTING = "theme";
export const THEMES = ["system", "dark", "light"] as const;
export type ThemeChoice = (typeof THEMES)[number];

export function resolveTheme(choice: ThemeChoice, prefersDark: boolean): "dark" | "light" {
  if (choice === "system") return prefersDark ? "dark" : "light";
  return choice;
}

const darkQuery = () => window.matchMedia("(prefers-color-scheme: dark)");
let current: ThemeChoice = "system";
let watching = false;

function paint() {
  document.documentElement.dataset.theme = resolveTheme(current, darkQuery().matches);
}

/** Sets the page theme and, in the desktop app, the window theme so Mica behind the sidebar matches. */
export function applyTheme(choice: ThemeChoice) {
  current = choice;
  paint();
  if (!watching) {
    watching = true;
    darkQuery().addEventListener("change", () => current === "system" && paint());
  }
  if (inTauri) void getCurrentWindow().setTheme(choice === "system" ? null : choice);
}
