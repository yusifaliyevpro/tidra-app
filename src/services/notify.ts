import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import * as z from "@zod/mini";
import { notifications } from "@/core/db/schema";
import type { Services } from "./context";

export const NOTIFICATION_KINDS = {
  advisory: "New advisory that would fail CI",
  ci: "CI failing on a default branch",
  major: "New major release of a dependency",
  deploy: "Failed deploy",
} as const;

export type NotificationKind = keyof typeof NOTIFICATION_KINDS;

const PrefsSchema = z.record(z.string(), z.boolean());
export const NOTIFY_SETTING = "notifications";

export const readNotifyPrefs = (svc: Services) => svc.store.getSetting(NOTIFY_SETTING, PrefsSchema, {});

/** Sends a native notification once per `key`; later calls with the same key are no-ops. */
export async function notify(
  svc: Services,
  kind: NotificationKind,
  input: { key: string; title: string; body: string; route?: string },
): Promise<void> {
  const prefs = await readNotifyPrefs(svc);
  if (prefs[kind] === false) return;
  const inserted = await svc.store.db
    .insert(notifications)
    .values({
      key: `${kind}:${input.key}`,
      title: input.title,
      body: input.body,
      route: input.route,
      createdAt: new Date().toISOString(),
    })
    .onConflictDoNothing()
    .returning({ key: notifications.key });
  if (inserted.length === 0 || svc.preview) return;
  let granted = await isPermissionGranted();
  if (!granted) granted = (await requestPermission()) === "granted";
  if (granted) sendNotification({ title: input.title, body: input.body });
}
