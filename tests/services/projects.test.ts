import { describe, expect, it } from "vitest";
import { checkCommands, refreshProject } from "@/services/projects";
import { jsonResponse, memoryIo, packument } from "../support/memory-io";
import { testServices } from "../support/services";

describe("refreshProject", () => {
  it("reuses registry answers while the workspace fingerprint is unchanged, unless forced", async () => {
    let requests = 0;
    const io = memoryIo(
      {
        "/web/package.json": JSON.stringify({ name: "web", dependencies: { a: "^1.0.0" } }),
        "/web/package-lock.json": JSON.stringify({
          lockfileVersion: 3,
          packages: { "": {}, "node_modules/a": { version: "1.0.0" } },
        }),
      },
      {
        fetch: async () => {
          requests++;
          return jsonResponse(packument("a", { "1.0.0": {}, "1.1.0": {} }, { latest: "1.1.0" }));
        },
      },
    );
    const { svc, close } = await testServices(io);
    await svc.store.addProject({ id: "p1", name: "web", remote: null, path: "/web" });

    const first = await refreshProject(svc, "p1");
    const afterFirst = requests;
    const second = await refreshProject(svc, "p1");
    const afterSecond = requests;
    await new Promise((resolve) => setTimeout(resolve, 5));
    const forced = await refreshProject(svc, "p1", { force: true });
    close();

    expect(first?.outdated.map((e) => e.latest)).toEqual(["1.1.0"]);
    expect(afterFirst).toBeGreaterThan(0);
    expect(afterSecond).toBe(afterFirst);
    expect(second?.outdated).toEqual(first?.outdated);
    expect(second?.checkedAt).toBe(first?.checkedAt);
    expect(forced?.checkedAt).not.toBe(first?.checkedAt);
  });
});

describe("checkCommands", () => {
  it("returns the project's own check commands, run from the workspace root", async () => {
    const io = memoryIo({ "/web/package.json": JSON.stringify({ name: "web", scripts: { check: "greenly" } }) });
    const { svc, close } = await testServices(io);
    await svc.store.addProject({ id: "p1", name: "web", remote: null, path: "/web" });
    const detected = await checkCommands(svc, "p1");
    await svc.store.updateProject("p1", { checks: ["pnpm tsc", "pnpm test"] });
    const custom = await checkCommands(svc, "p1");
    close();
    expect(detected).toEqual({ cwd: "/web", commands: [{ program: "npm", args: ["run", "check"] }] });
    expect(custom.commands.map((c) => [c.program, ...c.args].join(" "))).toEqual(["pnpm tsc", "pnpm test"]);
  });
});
