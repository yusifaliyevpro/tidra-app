import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import * as z from "@zod/mini";
import { desc, eq } from "drizzle-orm";
import { notifications } from "@/core/db/schema";
import { setTrayAttention } from "@/core/native";
import type { Services } from "./context";

export const NOTIFICATION_KINDS = {
  advisory: "New high or critical advisory",
  ci: "CI failing on a default branch",
  major: "New major release of a watched repo",
  deploy: "Failed deploy",
} as const;

export type NotificationKind = keyof typeof NOTIFICATION_KINDS;

const PrefsSchema = z.record(z.string(), z.boolean());
export const NOTIFY_SETTING = "notifications";

export const readNotifyPrefs = (svc: Services) => svc.store.getSetting(NOTIFY_SETTING, PrefsSchema, {});

/** New notifications are collected for a moment and sent as at most two desktop notifications. */
const FLUSH_DELAY_MS = 4000;
let pending = { urgent: 0, other: 0 };
let flushTimer: ReturnType<typeof setTimeout> | undefined;

async function push(svc: Services, body: string) {
  if (svc.preview) return;
  let granted = await isPermissionGranted();
  if (!granted) granted = (await requestPermission()) === "granted";
  if (granted) sendNotification({ title: "Tidra", body });
}

function flush(svc: Services) {
  const { urgent, other } = pending;
  pending = { urgent: 0, other: 0 };
  if (urgent > 0) void push(svc, "You have new high security advisories").catch(() => undefined);
  if (other > 0)
    void push(svc, `You have ${other} new ${other === 1 ? "notification" : "notifications"}`).catch(() => undefined);
}

/** How a new notification reaches the desktop: grouped as high advisories, counted, or not at all. */
export type Delivery = "urgent" | "summary" | "in-app";

function queue(svc: Services, delivery: Delivery) {
  if (delivery === "in-app") return;
  pending[delivery === "urgent" ? "urgent" : "other"]++;
  clearTimeout(flushTimer);
  flushTimer = setTimeout(() => flush(svc), FLUSH_DELAY_MS);
}

/**
 * Records an in-app notification once per `key`. The desktop only ever gets grouped messages: one for new high
 * advisories, one counting everything else.
 */
export async function notify(
  svc: Services,
  kind: NotificationKind,
  input: { key: string; title: string; body: string; route?: string; delivery?: Delivery },
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
  if (inserted.length === 0) return;
  await svc.queryClient.invalidateQueries({ queryKey: ["notifications"] });
  await updateTray(svc);
  queue(svc, input.delivery ?? "summary");
}

export const listNotifications = (svc: Services) =>
  svc.store.db.select().from(notifications).orderBy(desc(notifications.createdAt)).limit(100);

export async function markNotificationRead(svc: Services, key: string) {
  await svc.store.db.update(notifications).set({ read: true }).where(eq(notifications.key, key));
  await svc.queryClient.invalidateQueries({ queryKey: ["notifications"] });
  await updateTray(svc);
}

export async function markAllNotificationsRead(svc: Services) {
  await svc.store.db.update(notifications).set({ read: true }).where(eq(notifications.read, false));
  await svc.queryClient.invalidateQueries({ queryKey: ["notifications"] });
  await updateTray(svc);
}

export async function hasUnreadNotifications(svc: Services) {
  const rows = await svc.store.db
    .select({ key: notifications.key })
    .from(notifications)
    .where(eq(notifications.read, false))
    .limit(1);
  return rows.length > 0;
}

/** The tray dot means unread notifications: what the user has already seen never keeps it on. */
export async function updateTray(svc: Services) {
  if (svc.preview) return;
  await setTrayAttention(await hasUnreadNotifications(svc), svc.scheduler.isPaused()).catch(() => undefined);
}
