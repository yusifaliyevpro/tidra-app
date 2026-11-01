import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";

/** Quietly looks for a new Tidra release at launch and every few hours; a failed check just means "no update". */
export async function checkSilently(): Promise<Update | null> {
  try {
    return (await check()) ?? null;
  } catch {
    return null;
  }
}

/** Whole-number download progress from the updater's events, or undefined while the size is unknown. */
export function progressTracker() {
  let total = 0;
  let received = 0;
  return (event: DownloadEvent): number | undefined => {
    if (event.event === "Started") total = event.data.contentLength ?? 0;
    else if (event.event === "Progress") received += event.data.chunkLength;
    else return 100;
    return total > 0 ? Math.min(99, Math.floor((received / total) * 100)) : undefined;
  };
}
