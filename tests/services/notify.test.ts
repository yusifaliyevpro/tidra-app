import { describe, expect, it, vi } from "vitest";
import { setTrayAttention } from "@/core/native";
import type { Finding } from "@/engine/advisories";
import { notifySecurity } from "@/services/jobs";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  notify,
  NOTIFY_SETTING,
  updateTray,
} from "@/services/notify";
import { securityKey } from "@/services/security";
import { writeSnapshot } from "@/services/snapshot";
import { memoryIo } from "../support/memory-io";
import { testServices } from "../support/services";

vi.mock("@/core/native", () => ({ setTrayAttention: vi.fn<() => Promise<void>>(async () => undefined) }));

const trayDot = () => vi.mocked(setTrayAttention).mock.lastCall?.[0];

const finding = (id: string, severity: Finding["severity"], name = "undici"): Finding => ({
  id,
  aliases: [],
  summary: id,
  severity,
  name,
  version: "1.0.0",
  dev: false,
  direct: false,
  url: `https://osv.dev/${id}`,
});

async function setup() {
  const { svc, close } = await testServices(memoryIo());
  await svc.store.addProject({ id: "p1", name: "web", remote: null, path: "/web" });
  const scan = (findings: Finding[]) =>
    writeSnapshot(svc, securityKey("p1"), { projectId: "p1", findings, scanned: 10, updatedAt: "2026-11-01" });
  return { svc, close, scan };
}

describe("notifySecurity", () => {
  it("records what is already there on the first scan and clears the old per-advisory backlog", async () => {
    const { svc, close, scan } = await setup();
    await notify(svc, "advisory", { key: "old", title: "old", body: "", delivery: "in-app" });
    await scan([finding("A", "critical"), finding("B", "high")]);
    await notifySecurity(svc);
    const items = await listNotifications(svc);
    close();
    expect(items).toEqual([]);
  });

  it("groups only new high and critical advisories into one notification per project", async () => {
    const { svc, close, scan } = await setup();
    await scan([finding("A", "high")]);
    await notifySecurity(svc);
    await scan([finding("A", "high"), finding("B", "critical", "ws"), finding("C", "high"), finding("D", "moderate")]);
    await notifySecurity(svc);
    await notifySecurity(svc);
    const items = await listNotifications(svc);
    close();
    expect(items.map((n) => [n.title, n.body])).toEqual([["web: 2 new advisories", "In ws, undici"]]);
  });
});

describe("notify", () => {
  it("records each key once", async () => {
    const { svc, close } = await setup();
    await notify(svc, "ci", { key: "o/r:1", title: "first", body: "b" });
    await notify(svc, "ci", { key: "o/r:1", title: "duplicate", body: "b" });
    await notify(svc, "deploy", { key: "vercel:2", title: "second", body: "b", route: "/deploys" });
    const list = await listNotifications(svc);
    close();
    expect(
      list.map((n) => [n.key, n.title, n.read]).toSorted((a, b) => String(a[0]).localeCompare(String(b[0]))),
    ).toEqual([
      ["ci:o/r:1", "first", false],
      ["deploy:vercel:2", "second", false],
    ]);
  });

  it("records nothing for kinds the user turned off", async () => {
    const { svc, close } = await setup();
    await svc.store.setSetting(NOTIFY_SETTING, { ci: false });
    await notify(svc, "ci", { key: "x", title: "t", body: "b" });
    await notify(svc, "major", { key: "y", title: "t", body: "b" });
    const list = await listNotifications(svc);
    close();
    expect(list.map((n) => n.key)).toEqual(["major:y"]);
  });

  it("marks one or every notification read", async () => {
    const { svc, close } = await setup();
    await notify(svc, "ci", { key: "a", title: "t", body: "b" });
    await notify(svc, "ci", { key: "b", title: "t", body: "b" });
    await markNotificationRead(svc, "ci:a");
    expect((await listNotifications(svc)).filter((n) => n.read).map((n) => n.key)).toEqual(["ci:a"]);
    await markAllNotificationsRead(svc);
    expect((await listNotifications(svc)).every((n) => n.read)).toBe(true);
    close();
  });
});

describe("updateTray", () => {
  it("shows the dot only while a notification is unread, whatever the advisories", async () => {
    const { svc: preview, close, scan } = await setup();
    const svc = { ...preview, preview: false };
    vi.mocked(setTrayAttention).mockClear();
    await scan([finding("A", "critical")]);
    await updateTray(svc);
    expect(trayDot()).toBe(false);
    await notify(svc, "advisory", { key: "a", title: "t", body: "b", delivery: "in-app" });
    expect(trayDot()).toBe(true);
    await notify(svc, "ci", { key: "b", title: "t", body: "b", delivery: "in-app" });
    await markNotificationRead(svc, "advisory:a");
    expect(trayDot()).toBe(true);
    await markAllNotificationsRead(svc);
    expect(trayDot()).toBe(false);
    close();
  });
});
