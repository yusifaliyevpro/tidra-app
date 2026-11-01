import { invoke } from "@tauri-apps/api/core";

const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ["INPUT", "TEXTAREA"].includes(target.tagName) || !!target.closest("[data-selectable]"));

/** Browser shortcuts a desktop app shouldn't have: reload, print, find, save, view source, history. */
function isBrowserShortcut(event: KeyboardEvent): boolean {
  const key = event.key.toLowerCase();
  if (["f3", "f5", "f7", "browserback", "browserforward"].includes(key)) return true;
  if (event.altKey && (key === "arrowleft" || key === "arrowright")) return true;
  if (!(event.ctrlKey || event.metaKey)) return false;
  if (["r", "p", "f", "g", "s", "u", "j", "o", "n", "+", "-", "=", "0"].includes(key)) return true;
  // Devtools stay reachable in dev builds.
  return !import.meta.env.DEV && event.shiftKey && ["i", "c"].includes(key);
}

/** Makes the webview behave like a window rather than a page. Only used inside the desktop app. */
export function installNativeFeel() {
  window.addEventListener(
    "keydown",
    (event) => {
      if (isBrowserShortcut(event)) event.preventDefault();
    },
    { capture: true },
  );
  // The browser menu (Back, Reload, Inspect) makes no sense here; text fields keep copy and paste.
  window.addEventListener("contextmenu", (event) => {
    if (import.meta.env.DEV && event.shiftKey) return;
    if (!isEditable(event.target)) event.preventDefault();
  });
  // Mouse back and forward buttons would navigate the webview's history.
  window.addEventListener("mouseup", (event) => {
    if (event.button === 3 || event.button === 4) event.preventDefault();
  });
}

/** Background promise failures surface once as a toast instead of disappearing into the console. */
export function reportUnhandledErrors(show: (message: string) => void) {
  let last = "";
  let lastAt = 0;
  window.addEventListener("unhandledrejection", (event) => {
    const reason: unknown = event.reason;
    console.error(reason);
    const message = reason instanceof Error ? reason.message : String(reason);
    if (message === last && Date.now() - lastAt < 10_000) return;
    last = message;
    lastAt = Date.now();
    show(message);
  });
}

/** Shows the window after the first frame with final fonts, so it never opens blank or reflows. */
export async function revealWindow() {
  await document.fonts.ready;
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  await invoke("app_ready");
}
