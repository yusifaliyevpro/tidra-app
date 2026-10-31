import { openUrl } from "@tauri-apps/plugin-opener";
import { inTauri } from "@/core/native";

export function openExternal(url: string) {
  if (inTauri) void openUrl(url);
  else window.open(url, "_blank", "noopener");
}

/** Links inside rendered Markdown open in the system browser instead of navigating the app window. */
export function handleMarkdownLinkClick(event: MouseEvent) {
  const anchor = event.target instanceof Element ? event.target.closest(".markdown a") : null;
  if (!(anchor instanceof HTMLAnchorElement) || !anchor.href) return;
  event.preventDefault();
  openExternal(anchor.href);
}
