import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import { inTauri } from "@/core/native";
import type { Io } from "@/engine/io";
import { toastError } from "./toast";

/** Opens a web page in the default browser; a refusal shows as a toast instead of a click that does nothing. */
export function openExternal(url: string) {
  if (inTauri) openUrl(url).catch(toastError);
  else window.open(url, "_blank", "noopener");
}

export function openFolder(path: string) {
  openPath(path).catch(toastError);
}

export function openInVsCode(io: Io, path: string) {
  io.run("code", [path])
    .then((result) => {
      if (result.code !== 0) toastError(new Error("VS Code did not open. Is `code` on PATH?"));
    })
    .catch(toastError);
}

/** Links inside rendered Markdown open in the system browser instead of navigating the app window. */
export function handleMarkdownLinkClick(event: MouseEvent) {
  const anchor = event.target instanceof Element ? event.target.closest(".markdown a") : null;
  if (!(anchor instanceof HTMLAnchorElement) || !anchor.href) return;
  event.preventDefault();
  openExternal(anchor.href);
}
