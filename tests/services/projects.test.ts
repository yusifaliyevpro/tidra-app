import { describe, expect, it } from "vitest";
import { SECRET_KEYS } from "@/core/secrets";
import {
  addProject,
  checkCommands,
  readAllReports,
  refreshAllProjects,
  refreshProject,
  remotesUnchanged,
} from "@/services/projects";
import { jsonResponse, memoryIo, ok, packument } from "../support/memory-io";
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

describe("refreshAllProjects", () => {
  it("fetches each checkout once and reads its git state only after that fetch", async () => {
    const io = memoryIo(
      {
        "/mono/apps/web/package.json": JSON.stringify({ name: "web" }),
        "/mono/apps/api/package.json": JSON.stringify({ name: "api" }),
      },
      { run: (_program, args) => (args.join(" ") === "remote" ? ok("origin\n") : ok()) },
    );
    const { svc, close } = await testServices(io);
    await svc.store.addProject({
      id: "w",
      name: "web",
      remote: "github.com/me/mono",
      subdir: "apps/web",
      path: "/mono/apps/web",
    });
    await svc.store.addProject({
      id: "a",
      name: "api",
      remote: "github.com/me/mono",
      subdir: "apps/api",
      path: "/mono/apps/api",
    });
    await refreshAllProjects(svc);
    close();
    const lines = io.runs.map((r) => r.args[0]);
    expect(lines.filter((l) => l === "fetch")).toHaveLength(1);
    expect(lines.filter((l) => l === "status")).toHaveLength(1);
    expect(lines.indexOf("status")).toBeGreaterThan(lines.indexOf("fetch"));
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

describe("remotesUnchanged", () => {
  const heads = [
    { ref: "refs/heads/main", object: { sha: "aaa" } },
    { ref: "refs/heads/feature", object: { sha: "bbb" } },
  ];

  async function check(localRefs: string, token = true) {
    const io = memoryIo(
      {},
      {
        run: (_program, args) => {
          if (args[0] === "config") return ok("remote.origin.url git@github.com:me/app.git\n");
          if (args[0] === "for-each-ref") return ok(localRefs);
          return ok();
        },
        fetch: async () => jsonResponse(heads),
      },
    );
    const { svc, close } = await testServices(io);
    if (token) await svc.setSecret(SECRET_KEYS.github, "ghp_test");
    const result = await remotesUnchanged(svc, "/code/app");
    close();
    return result;
  }

  it("skips the fetch when every branch on GitHub matches the local remote refs", async () => {
    expect(await check("origin/HEAD aaa\norigin/main aaa\norigin/feature bbb\n")).toBe(true);
  });

  it("fetches when a branch moved, appeared or was deleted on GitHub", async () => {
    expect(await check("origin/main aaa\norigin/feature old\n")).toBe(false);
    expect(await check("origin/main aaa\n")).toBe(false);
    expect(await check("origin/main aaa\norigin/feature bbb\norigin/gone ccc\n")).toBe(false);
  });

  it("fetches when there is no GitHub token to ask with", async () => {
    expect(await check("origin/main aaa\norigin/feature bbb\n", false)).toBe(false);
  });
});

const gitRemote = (remote?: string) => (_program: string, args: string[]) =>
  args.join(" ") === "remote get-url origin" && remote ? ok(`${remote}\n`) : { code: 2, stdout: "", stderr: "" };

it("names the project after its manifest and records the remote and folder inside the repo", async () => {
  const io = memoryIo(
    { "/mono/.git/HEAD": "ref", "/mono/apps/web/package.json": JSON.stringify({ name: "@me/web" }) },
    { run: gitRemote("git@github.com:me/mono.git") },
  );
  const { svc, close } = await testServices(io);
  const id = await addProject(svc, "/mono/apps/web");
  const project = await svc.store.getProject(id);
  close();
  expect(project).toMatchObject({
    name: "@me/web",
    remote: "github.com/me/mono",
    subdir: "apps/web",
    path: "/mono/apps/web",
  });
});

describe("addProject", () => {
  it("falls back to the folder name for an unparsable manifest", async () => {
    const { svc, close } = await testServices(
      memoryIo({ "/code/my-app/package.json": "{ broken" }, { run: gitRemote() }),
    );
    const project = await svc.store.getProject(await addProject(svc, "/code/my-app"));
    close();
    expect(project).toMatchObject({ name: "my-app", remote: null, subdir: "" });
  });

  it("refuses a folder without package.json", async () => {
    const { svc, close } = await testServices(memoryIo({}, { run: gitRemote() }));
    await expect(addProject(svc, "/empty")).rejects.toThrow("No package.json in this folder.");
    close();
  });

  it("reuses the project for the same folder, whatever its slashes", async () => {
    const { svc, close } = await testServices(memoryIo({ "/code/app/package.json": "{}" }, { run: gitRemote() }));
    const first = await addProject(svc, "/code/app");
    const second = await addProject(svc, String.raw`\code\app`);
    const all = await svc.store.listProjects();
    close();
    expect(second).toBe(first);
    expect(all).toHaveLength(1);
  });

  it("links a project synced from another device by its remote and subfolder", async () => {
    const io = memoryIo({ "/here/app/package.json": "{}" }, { run: gitRemote("https://github.com/me/app.git") });
    const { svc, close } = await testServices(io);
    await svc.store.addProject({ id: "synced", name: "app", remote: "github.com/me/app", path: "/elsewhere/app" });
    const id = await addProject(svc, "/here/app");
    const project = await svc.store.getProject(id);
    close();
    expect(id).toBe("synced");
    expect(project?.path).toBe("/here/app");
  });
});

describe("refreshProject reports", () => {
  it("keeps git state and explains the problem when the manifest can't be read", async () => {
    const io = memoryIo(
      { "/web/package.json": "{ broken" },
      { run: (_p, args) => (args[0] === "status" ? ok("# branch.oid a\n# branch.head main\n") : ok()) },
    );
    const { svc, close } = await testServices(io);
    await svc.store.addProject({ id: "p1", name: "web", remote: null, path: "/web" });
    const report = await refreshProject(svc, "p1");
    close();
    expect(report).toMatchObject({ outdated: [], error: "No readable package.json in /web", git: { branch: "main" } });
  });

  it("returns nothing for an unknown project", async () => {
    const { svc, close } = await testServices();
    expect(await refreshProject(svc, "missing")).toBeUndefined();
    close();
  });

  it("lists direct dependencies of every importer for search and security", async () => {
    const io = memoryIo({
      "/web/package.json": JSON.stringify({
        dependencies: { a: "^1.0.0" },
        devDependencies: { b: "2.0.0" },
        peerDependencies: { c: "*" },
      }),
    });
    const { svc, close } = await testServices(io);
    await svc.store.addProject({ id: "p1", name: "web", remote: null, path: "/web" });
    const report = await refreshProject(svc, "p1");
    const all = await readAllReports(svc);
    close();
    expect(report?.dependencies).toEqual([
      { name: "a", spec: "^1.0.0", importer: ".", field: "dependencies" },
      { name: "b", spec: "2.0.0", importer: ".", field: "devDependencies" },
    ]);
    expect(all.map(({ project, report: r }) => [project.id, r?.projectId])).toEqual([["p1", "p1"]]);
  });
});

describe("addProject with a byte-order mark", () => {
  it("still reads the manifest's name", async () => {
    const io = memoryIo({ "/code/x/package.json": '\uFEFF{ "name": "from-manifest" }' });
    const { svc, close } = await testServices(io);
    const project = await svc.store.getProject(await addProject(svc, "/code/x"));
    close();
    expect(project?.name).toBe("from-manifest");
  });
});
