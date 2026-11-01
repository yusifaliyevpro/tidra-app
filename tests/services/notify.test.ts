import { describe, expect, it } from "vitest";
import type { Finding } from "@/engine/advisories";
import { notifySecurity } from "@/services/jobs";
import { listNotifications, notify } from "@/services/notify";
import { securityKey } from "@/services/security";
import { writeSnapshot } from "@/services/snapshot";
import { memoryIo } from "../support/memory-io";
import { testServices } from "../support/services";

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
