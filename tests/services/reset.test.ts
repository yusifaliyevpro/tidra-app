import * as z from "@zod/mini";
import { describe, expect, it } from "vitest";
import { SECRET_KEYS } from "@/core/secrets";
import { deleteAllData } from "@/services/reset";
import { testServices } from "../support/services";

describe("deleteAllData", () => {
  it("returns the device to a fresh install but keeps the schema", async () => {
    const { svc, close } = await testServices();
    await svc.store.addProject({ id: "p1", name: "web", remote: null, path: "/web" });
    await svc.store.setLocal("onboarded", true);
    await svc.store.setSetting("accent", "#ff0000");
    await svc.setSecret(SECRET_KEYS.github, "ghp_test");

    await deleteAllData(svc);

    expect(await svc.store.listProjects()).toEqual([]);
    expect(await svc.store.getLocal("onboarded", z.boolean(), false)).toBe(false);
    expect(await svc.store.getSetting("accent", z.string(), "default")).toBe("default");
    expect(await svc.secrets.get(SECRET_KEYS.github)).toBeUndefined();
    await svc.store.addProject({ id: "p2", name: "again", remote: null, path: "/again" });
    expect(await svc.store.listProjects()).toHaveLength(1);
    close();
  });
});
