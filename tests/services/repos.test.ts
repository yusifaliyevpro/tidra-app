import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { projectPaths } from "@/core/db/schema";
import { SECRET_KEYS } from "@/core/secrets";
import type { RunResult } from "@/engine/io";
import { readCi, refreshCi } from "@/services/github-feed";
import { fetchProject, readReport, refreshProject, reportKey } from "@/services/projects";
import { refreshRepos } from "@/services/repo-refresh";
import { listBranches, listRepos, runRepoAction, switchBranch, syncRepo } from "@/services/repos";
import { writeSnapshot } from "@/services/snapshot";
import { jsonResponse, memoryIo, ok } from "../support/memory-io";
import { projectReport, testServices } from "../support/services";

const repoFiles = { "/code/app/package.json": JSON.stringify({ name: "app" }) };

const git = (program: string, args: string[]) => {
  if (program !== "git") return ok();
  const line = args.join(" ");
  if (line.includes("refs/heads")) return ok("main\nfeature/a\n");
  if (line.includes("refs/remotes/origin")) return ok("origin/HEAD\norigin\norigin/main\norigin/feature/b\n");
  if (args[0] === "status") return ok("# branch.oid a\n# branch.head main\n");
  if (line === "remote") return ok("origin\n");
  return ok();
};

async function withProject() {
  const io = memoryIo(repoFiles, { run: git });
  const { svc, close } = await testServices(io);
  await svc.store.addProject({ id: "p1", name: "app", remote: "github.com/me/app", path: "/code/app" });
  return { io, svc, close };
}

describe("listBranches", () => {
  it("lists local branches first, then origin branches without a local copy", async () => {
    const { svc, close } = await withProject();
    const branches = await listBranches(svc, "p1");
    close();
    expect(branches).toEqual([
      { name: "main", remote: false },
      { name: "feature/a", remote: false },
      { name: "feature/b", remote: true },
    ]);
  });
});

describe("switchBranch", () => {
  it("switches the repo checkout, creating the branch when asked", async () => {
    const { io, svc, close } = await withProject();
    await switchBranch(svc, "p1", "feature/b");
    await switchBranch(svc, "p1", "fix/new", { create: true });
    await new Promise((resolve) => setTimeout(resolve, 20));
    close();
    const switches = io.runs.filter((r) => r.args[0] === "switch").map((r) => [r.args.join(" "), r.cwd]);
    expect(switches).toEqual([
      ["switch feature/b", "/code/app"],
      ["switch -c fix/new", "/code/app"],
    ]);
  });
});

const status = (branch: string, upstream: string | undefined, ahead: number, behind: number) =>
  ok(
    [`# branch.head ${branch}`, upstream ? `# branch.upstream ${upstream}` : "", `# branch.ab +${ahead} -${behind}`]
      .filter(Boolean)
      .join("\n"),
  );

async function runSync(
  statuses: ReturnType<typeof ok>[],
  upstreamRemote?: string,
  upstreamBehind = 0,
  otherRemotes: string[] = [],
) {
  let call = 0;
  const io = memoryIo(repoFiles, {
    run: (program, args) => {
      if (program !== "git") return ok();
      const line = args.join(" ");
      if (args[0] === "status") return statuses[Math.min(call++, statuses.length - 1)] ?? ok();
      if (line === "remote") return ok(["origin", ...(upstreamRemote ? ["upstream"] : []), ...otherRemotes].join("\n"));
      if (line === "remote get-url upstream")
        return upstreamRemote ? ok(`${upstreamRemote}\n`) : { code: 2, stdout: "", stderr: "" };
      if (line === "rev-list --count HEAD..upstream/HEAD") return ok(`${upstreamBehind}\n`);
      if (line === "rev-parse --abbrev-ref upstream/HEAD") return ok("upstream/main\n");
      if (line === "rev-list --count HEAD..upstream/main") return ok(`${upstreamBehind}\n`);
      return ok();
    },
  });
  const { svc, close } = await testServices(io);
  await svc.store.addProject({ id: "p1", name: "app", remote: "github.com/me/app", path: "/code/app" });
  const message = await syncRepo(svc, "p1");
  close();
  const gitCalls = io.runs.map((r) => r.args.join(" ")).filter((line) => /^(fetch|merge|pull|push)/.test(line));
  return { message, gitCalls };
}

describe("fetchProject", () => {
  it("fetches after a branch switch so commits waiting upstream show up", async () => {
    const { io, svc, close } = await withProject();
    await switchBranch(svc, "p1", "feature/b");
    await new Promise((resolve) => setTimeout(resolve, 20));
    close();
    const lines = io.runs.map((r) => r.args.join(" "));
    expect(lines.indexOf("fetch --prune --quiet --multiple origin")).toBeGreaterThan(lines.indexOf("switch feature/b"));
  });

  it("skips a checkout fetched in the last few minutes unless forced", async () => {
    const { io, svc, close } = await withProject();
    expect(await fetchProject(svc, "p1", { force: true })).toBe(true);
    expect(await fetchProject(svc, "p1")).toBe(false);
    close();
    expect(io.runs.filter((r) => r.args[0] === "fetch")).toHaveLength(1);
  });
});

describe("syncRepo", () => {
  it("pulls what origin has, then pushes what it lacks", async () => {
    const { message, gitCalls } = await runSync([
      status("main", "origin/main", 1, 3),
      status("main", "origin/main", 1, 0),
    ]);
    expect(gitCalls).toEqual(["fetch --prune --quiet --multiple origin", "merge --ff-only @{u}", "push"]);
    expect(message).toBe("Synced app: pulled 3, pushed 1.");
  });

  it("fast-forwards a fork's default branch to upstream and pushes it to the fork", async () => {
    const { gitCalls } = await runSync(
      [status("main", "origin/main", 0, 0), status("main", "origin/main", 2, 0)],
      "https://github.com/them/app.git",
      2,
    );
    expect(gitCalls).toEqual([
      "fetch --prune --quiet --multiple --jobs=2 origin upstream",
      "merge --ff-only upstream/main",
      "push",
    ]);
  });

  it("publishes a branch that has no upstream yet", async () => {
    const { gitCalls } = await runSync([status("feature/x", undefined, 0, 0)]);
    expect(gitCalls).toEqual(["fetch --prune --quiet --multiple origin", "push --set-upstream origin feature/x"]);
  });

  it("fetches only origin and upstream, so a deleted contributor fork can't fail the sync", async () => {
    const { gitCalls } = await runSync([status("main", "origin/main", 0, 0)], undefined, 0, ["old-fork"]);
    expect(gitCalls).toEqual(["fetch --prune --quiet --multiple origin"]);
  });

  it("says so when there is nothing to do", async () => {
    const { message } = await runSync([status("main", "origin/main", 0, 0)]);
    expect(message).toBe("app is in sync.");
  });
});

describe("listRepos", () => {
  it("groups a monorepo's packages under the repo and keeps single-package repos by name", async () => {
    const { svc, close } = await testServices(memoryIo({}));
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
    await svc.store.addProject({ id: "s", name: "solo", remote: "gitlab.com/me/solo", path: "/solo" });
    await svc.store.addProject({ id: "l", name: "local", remote: null, path: "/local" });
    const repos = await listRepos(svc);
    close();
    expect(repos.map((r) => [r.key, r.label, r.github, r.root, r.projects.map((p) => p.id).toSorted()])).toEqual([
      ["/local", "local", undefined, "/local", ["l"]],
      ["github.com/me/mono", "mono", "me/mono", "/mono", ["a", "w"]],
      ["gitlab.com/me/solo", "solo", undefined, "/solo", ["s"]],
    ]);
  });
});

async function repoFixture(run: (args: string[]) => RunResult = () => ok()) {
  const io = memoryIo(repoFiles, { run: (program, args) => (program === "git" ? run(args) : ok()) });
  const { svc, close } = await testServices(io);
  await svc.store.addProject({ id: "p1", name: "app", remote: "github.com/me/app", path: "/code/app" });
  const [group] = await listRepos(svc);
  if (!group) throw new Error("no repo");
  return { io, svc, close, group };
}

describe("runRepoAction", () => {
  it("pulls and pushes the checkout and says so", async () => {
    const { io, svc, close, group } = await repoFixture();
    expect(await runRepoAction(svc, group, "pull")).toBe("Pulled app.");
    expect(await runRepoAction(svc, group, "push")).toBe("Pushed app.");
    close();
    expect(io.runs.map((r) => r.args.join(" "))).toEqual(expect.arrayContaining(["pull --ff-only", "push"]));
  });

  it("refuses a repo without a folder on this device", async () => {
    const { svc, close, group } = await repoFixture();
    await expect(runRepoAction(svc, { ...group, root: undefined }, "pull")).rejects.toThrow("no folder on this device");
    close();
  });
});

const ghRepo = (fullName: string) =>
  jsonResponse({
    full_name: fullName,
    default_branch: "main",
    stargazers_count: 0,
    open_issues_count: 0,
    html_url: "u",
  });

/** Two GitHub repos whose CI turns from passing to failing between two reads. */
async function twoReposWithCi() {
  let conclusion = "success";
  const ciRequests: string[] = [];
  const io = memoryIo(
    { "/code/app/package.json": "{}", "/code/lib/package.json": "{}" },
    {
      run: git,
      fetch: async (input, init) => {
        const url = new Request(input, init).url;
        const repo = /\/repos\/(me\/\w+)/.exec(url)?.[1] ?? "";
        if (url.endsWith(`/repos/${repo}`)) return ghRepo(repo);
        if (url.includes("/pulls")) return jsonResponse([]);
        ciRequests.push(repo);
        return jsonResponse({
          workflow_runs: [
            {
              id: 1,
              name: "CI",
              head_branch: "main",
              status: "completed",
              conclusion,
              event: "push",
              html_url: "u",
              created_at: "2026-11-01T00:00:00Z",
              run_number: 1,
            },
          ],
        });
      },
    },
  );
  const { svc, close } = await testServices(io);
  await svc.setSecret(SECRET_KEYS.github, "ghp_test");
  await svc.store.addProject({ id: "a", name: "app", remote: "github.com/me/app", path: "/code/app" });
  await svc.store.addProject({ id: "l", name: "lib", remote: "github.com/me/lib", path: "/code/lib" });
  await refreshCi(svc);
  conclusion = "failure";
  ciRequests.length = 0;
  const conclusions = async () =>
    Object.fromEntries((await readCi(svc))?.entries.map((e) => [e.repo, e.runs[0]?.conclusion]) ?? []);
  return { io, svc, close, ciRequests, conclusions, repos: await listRepos(svc) };
}

describe("refreshRepos", () => {
  it("fetches every repo and refreshes their CI", async () => {
    const { io, svc, close, conclusions, repos } = await twoReposWithCi();
    await refreshRepos(svc, repos);
    const fetched = io.runs.filter((r) => r.args[0] === "fetch").map((r) => r.cwd);
    const ci = await conclusions();
    close();
    expect(fetched).toEqual(expect.arrayContaining(["/code/app", "/code/lib"]));
    expect(fetched).toHaveLength(2);
    expect(ci).toEqual({ "me/app": "failure", "me/lib": "failure" });
  });

  it("refreshes only one repo's CI and keeps the others as they were", async () => {
    const { svc, close, ciRequests, conclusions, repos } = await twoReposWithCi();
    const app = repos.find((r) => r.github === "me/app");
    if (!app) throw new Error("no app repo");
    await refreshRepos(svc, [app]);
    const ci = await conclusions();
    close();
    expect(ciRequests).toEqual(["me/app"]);
    expect(ci).toEqual({ "me/app": "failure", "me/lib": "success" });
  });
});

describe("syncRepo failures", () => {
  it("stops with git's message when the branch diverged", async () => {
    const io = memoryIo(repoFiles, {
      run: (program, args) => {
        if (program !== "git") return ok();
        if (args[0] === "status") return status("main", "origin/main", 1, 1);
        if (args[0] === "remote" && args.length === 1) return ok("origin\n");
        if (args[0] === "merge")
          return { code: 128, stdout: "", stderr: "fatal: Not possible to fast-forward, aborting." };
        return ok();
      },
    });
    const { svc, close } = await testServices(io);
    await svc.store.addProject({ id: "p1", name: "app", remote: "github.com/me/app", path: "/code/app" });
    await expect(syncRepo(svc, "p1")).rejects.toThrow("Not possible to fast-forward");
    close();
    expect(io.runs.some((r) => r.args[0] === "push")).toBe(false);
  });
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const within = (work: Promise<unknown>, ms = 300) => Promise.race([work.then(() => true), sleep(ms).then(() => false)]);

/** A repo with a dependency and a registry that answers only when told to, like a slow network. */
async function slowRegistryRepo(statusExtra = "") {
  const gate = Promise.withResolvers<void>();
  let branch = "main";
  const io = memoryIo(
    { "/code/app/package.json": JSON.stringify({ name: "app", dependencies: { react: "^19.0.0" } }) },
    {
      run: (program, args) => {
        if (program !== "git") return ok();
        if (args[0] === "switch") branch = args.at(-1) ?? branch;
        if (args[0] === "status") return ok(`# branch.head ${branch}\n${statusExtra}`);
        if (args.join(" ") === "remote") return ok("origin\n");
        return ok();
      },
      fetch: async () => {
        await gate.promise;
        return jsonResponse({}, { status: 404 });
      },
    },
  );
  const { svc, close } = await testServices(io);
  await svc.store.addProject({ id: "p1", name: "app", remote: "github.com/me/app", path: "/code/app" });
  await writeSnapshot(svc, reportKey("p1"), projectReport([]));
  return { io, svc, close, openRegistry: () => gate.resolve() };
}

describe("branch switch speed", () => {
  it("finishes and shows the new branch without waiting for the registry", async () => {
    const { svc, close, openRegistry } = await slowRegistryRepo();
    const switching = switchBranch(svc, "p1", "feature/b");
    const finished = await within(switching);
    const shown = (await readReport(svc, "p1"))?.git?.branch;
    openRegistry();
    await switching;
    await sleep(20);
    close();
    expect([finished, shown]).toEqual([true, "feature/b"]);
  });

  it("has refreshed the screen by the time it reports success", async () => {
    const { svc, close } = await withProject();
    const invalidate = vi.spyOn(svc.queryClient, "invalidateQueries");
    await switchBranch(svc, "p1", "feature/b");
    const refreshed = invalidate.mock.calls.some(([filters]) => filters?.queryKey?.[0] === "report");
    await sleep(20);
    close();
    expect(refreshed).toBe(true);
  });

  it("doesn't read the reports of other repositories", async () => {
    const { svc, close } = await withProject();
    await svc.store.addProject({ id: "other", name: "other", remote: "github.com/me/other", path: "/code/other" });
    await writeSnapshot(svc, reportKey("other"), projectReport([]));
    const query = vi.spyOn(svc.driver, "query");
    await switchBranch(svc, "p1", "feature/b");
    await sleep(20);
    close();
    expect(query.mock.calls.some(([, params]) => JSON.stringify(params).includes("report:other"))).toBe(false);
  });

  it("relists branches once the follow-up fetch finishes", async () => {
    const order: string[] = [];
    const io = memoryIo(repoFiles, {
      run: (program, args) => {
        if (program === "git" && args[0] === "fetch") order.push("fetch");
        return git(program, args);
      },
    });
    const { svc, close } = await testServices(io);
    await svc.store.addProject({ id: "p1", name: "app", remote: "github.com/me/app", path: "/code/app" });
    vi.spyOn(svc, "invalidate").mockImplementation((...keys) => {
      if (keys.some((key) => key[0] === "branches")) order.push("branches");
    });
    await switchBranch(svc, "p1", "feature/b");
    await sleep(20);
    close();
    expect(order.at(-1)).toBe("branches");
  });
});

describe("sync speed", () => {
  it("doesn't go back to the network to pull what it just fetched", async () => {
    const { gitCalls } = await runSync([status("main", "origin/main", 1, 3), status("main", "origin/main", 1, 0)]);
    expect(gitCalls.filter((line) => /^(fetch|pull|push)/.test(line))).toHaveLength(2);
  });

  it("fetches a fork's two remotes side by side", async () => {
    const { gitCalls } = await runSync([status("main", "origin/main", 0, 0)], "https://github.com/them/app.git");
    expect(gitCalls[0]).toMatch(/--jobs=?\d/);
  });

  it("finishes without waiting for the registry", async () => {
    const { svc, close, openRegistry } = await slowRegistryRepo("# branch.upstream origin/main\n# branch.ab +0 -2\n");
    const syncing = syncRepo(svc, "p1");
    const finished = await within(syncing);
    openRegistry();
    await syncing;
    close();
    expect(finished).toBe(true);
  });
});

const manifest = (dep: string) => JSON.stringify({ name: "app", dependencies: { [dep]: "^1.0.0" } });

describe("sync and other git work on the same checkout", () => {
  it("never runs two fetches at once", async () => {
    let running = 0;
    let most = 0;
    const io = memoryIo(repoFiles, {
      run: async (program, args) => {
        if (program === "git" && args[0] === "fetch") {
          most = Math.max(most, ++running);
          await sleep(30);
          running--;
        }
        return git(program, args);
      },
    });
    const { svc, close } = await testServices(io);
    await svc.store.addProject({ id: "p1", name: "app", remote: "github.com/me/app", path: "/code/app" });
    await Promise.all([fetchProject(svc, "p1", { force: true }), syncRepo(svc, "p1")]);
    close();
    expect(most).toBe(1);
  });

  it("keeps the new branch when an older refresh finishes last", async () => {
    const gate = Promise.withResolvers<void>();
    let branch = "main";
    const io = memoryIo(
      { "/code/app/package.json": manifest("slow-package") },
      {
        run: (program, args) => {
          if (program !== "git") return ok();
          if (args[0] === "switch") {
            branch = args.at(-1) ?? branch;
            io.files.set("/code/app/package.json", manifest("quick-package"));
          }
          if (args[0] === "status") return ok(`# branch.head ${branch}\n`);
          if (args.join(" ") === "remote") return ok("origin\n");
          return ok();
        },
        fetch: async (input) => {
          if (new Request(input).url.includes("slow-package")) await gate.promise;
          return jsonResponse({}, { status: 404 });
        },
      },
    );
    const { svc, close } = await testServices(io);
    await svc.store.addProject({ id: "p1", name: "app", remote: "github.com/me/app", path: "/code/app" });
    const background = refreshProject(svc, "p1");
    await sleep(20);
    await switchBranch(svc, "p1", "feature/b");
    await sleep(20);
    gate.resolve();
    await background;
    const shown = (await readReport(svc, "p1"))?.git?.branch;
    close();
    expect(shown).toBe("feature/b");
  });

  it("gives up on a fetch that hangs", async () => {
    const signals: (AbortSignal | undefined)[] = [];
    const io = memoryIo(repoFiles, {
      run: (program, args, options) => {
        if (program === "git" && args[0] === "fetch") signals.push(options?.signal);
        return git(program, args);
      },
    });
    const { svc, close } = await testServices(io);
    await svc.store.addProject({ id: "p1", name: "app", remote: "github.com/me/app", path: "/code/app" });
    await syncRepo(svc, "p1");
    close();
    expect(signals[0]).toBeDefined();
  });

  it("updates the open pull request's description after pushing", async () => {
    const methods: string[] = [];
    const pull = {
      number: 3,
      html_url: "https://github.com/me/app/pull/3",
      state: "open",
      title: "chore(deps): bump oxfmt 0.75.0 → 0.76.0",
      body: "<!-- tidra:commits -->\n- old\n<!-- /tidra:commits -->",
      merged_at: null,
    };
    const io = memoryIo(repoFiles, {
      run: (program, args) => {
        if (program !== "git") return ok();
        if (args[0] === "status") return status("feature/x", "origin/feature/x", 1, 0);
        if (args.join(" ") === "remote") return ok("origin\n");
        if (args.join(" ") === "remote get-url upstream") return { code: 2, stdout: "", stderr: "" };
        if (args[0] === "log") return ok("chore(deps): bump 2 dependencies\n\n- oxfmt 0.75.0 → 0.76.0\n\x1e\n");
        return ok();
      },
      fetch: async (input, init) => {
        const url = new Request(input, init).url;
        methods.push(init?.method ?? "GET");
        if (url.endsWith("/repos/me/app"))
          return jsonResponse({
            full_name: "me/app",
            default_branch: "main",
            stargazers_count: 0,
            open_issues_count: 0,
            html_url: "u",
          });
        return jsonResponse(url.includes("/pulls?state=all") ? [pull] : {});
      },
    });
    const { svc, close } = await testServices(io);
    await svc.setSecret(SECRET_KEYS.github, "ghp_test");
    await svc.store.addProject({ id: "p1", name: "app", remote: "github.com/me/app", path: "/code/app" });
    await syncRepo(svc, "p1");
    await vi.waitFor(() => expect(methods).toContain("PATCH"));
    close();
  });
});

async function twoPackages(first: string, second: string) {
  const io = memoryIo(
    {
      [`${first}/apps/api/package.json`]: JSON.stringify({ name: "api" }),
      [`${second}/apps/web/package.json`]: JSON.stringify({ name: "web" }),
    },
    { run: git },
  );
  const { svc, close } = await testServices(io);
  const remote = "github.com/me/mono";
  await svc.store.addProject({ id: "a", name: "api", remote, subdir: "apps/api", path: `${first}/apps/api` });
  await svc.store.addProject({ id: "w", name: "web", remote, subdir: "apps/web", path: `${second}/apps/web` });
  return { io, svc, close };
}

describe("repos with packages in different places", () => {
  it("finds the checkout when another package has no folder on this device", async () => {
    const { svc, close } = await twoPackages("/mono", "/mono");
    await svc.store.db.delete(projectPaths).where(eq(projectPaths.projectId, "a"));
    const [repo] = await listRepos(svc);
    close();
    expect(repo?.root).toBe("/mono");
  });

  it("switches the checkout the project is in when the repo is cloned twice", async () => {
    const { io, svc, close } = await twoPackages("/one", "/two");
    await switchBranch(svc, "w", "feature/b");
    await sleep(20);
    close();
    expect(io.runs.find((run) => run.args[0] === "switch")?.cwd).toBe("/two");
  });
});
