import { describe, expect, it } from "vitest";
import type { RunResult } from "@/engine/io";
import { fetchProject } from "@/services/projects";
import { listBranches, listRepos, runRepoAction, switchBranch, syncRepo } from "@/services/repos";
import { memoryIo, ok } from "../support/memory-io";
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
    expect(gitCalls).toEqual(["fetch --prune --quiet --multiple origin", "pull --ff-only", "push"]);
    expect(message).toBe("Synced app: pulled 3, pushed 1.");
  });

  it("fast-forwards a fork's default branch to upstream and pushes it to the fork", async () => {
    const { gitCalls } = await runSync(
      [status("main", "origin/main", 0, 0), status("main", "origin/main", 2, 0)],
      "https://github.com/them/app.git",
      2,
    );
    expect(gitCalls).toEqual([
      "fetch --prune --quiet --multiple origin upstream",
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

  it("deletes branches whose upstream is gone, except the current one", async () => {
    const { io, svc, close, group } = await repoFixture();
    const report = {
      ...projectReport([]),
      git: {
        branch: "gone-current",
        upstream: undefined,
        ahead: 0,
        behind: 0,
        changed: 0,
        untracked: 0,
        conflicted: 0,
      },
      branches: [
        { name: "gone-a", lastCommit: new Date(), upstreamGone: true, ahead: 0 },
        { name: "gone-current", lastCommit: new Date(), upstreamGone: true, ahead: 0 },
        { name: "live", lastCommit: new Date(), upstreamGone: false, ahead: 0 },
      ],
    };
    expect(await runRepoAction(svc, { ...group, report }, "prune")).toBe("Deleted gone-a.");
    close();
    expect(io.runs.filter((r) => r.args[0] === "branch").map((r) => r.args.join(" "))).toEqual(["branch -d gone-a"]);
  });

  it("keeps pruning when one branch isn't fully merged", async () => {
    const { io, svc, close, group } = await repoFixture((args) =>
      args.join(" ") === "branch -d squashed"
        ? { code: 1, stdout: "", stderr: "error: the branch 'squashed' is not fully merged" }
        : ok(),
    );
    const report = {
      ...projectReport([]),
      branches: [
        { name: "squashed", lastCommit: new Date(), upstreamGone: true, ahead: 0 },
        { name: "merged", lastCommit: new Date(), upstreamGone: true, ahead: 0 },
      ],
    };
    await runRepoAction(svc, { ...group, report }, "prune").catch(() => undefined);
    close();
    expect(io.runs.map((r) => r.args.join(" "))).toContain("branch -d merged");
  });
});

describe("syncRepo failures", () => {
  it("stops with git's message when the branch diverged", async () => {
    const io = memoryIo(repoFiles, {
      run: (program, args) => {
        if (program !== "git") return ok();
        if (args[0] === "status") return status("main", "origin/main", 1, 1);
        if (args[0] === "remote" && args.length === 1) return ok("origin\n");
        if (args[0] === "pull")
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

const goneBranch = (name: string) => ({ name, lastCommit: new Date(), upstreamGone: true, ahead: 0 });

describe("prune messages", () => {
  it.for([
    [[], [], "No merged branches to delete."],
    [["a", "b"], [], "Deleted 2 merged branches."],
    [["a"], ["s"], "Deleted a. Kept s: not fully merged."],
    [[], ["s", "t"], "Kept s, t: not fully merged."],
  ] as const)("deleted %j, kept %j says %s", async ([deleted, kept, message]) => {
    const { svc, close, group } = await repoFixture((args) =>
      args[0] === "branch" && kept.some((name) => args.includes(name))
        ? { code: 1, stdout: "", stderr: "not merged" }
        : ok(),
    );
    const report = { ...projectReport([]), branches: [...deleted, ...kept].map(goneBranch) };
    expect(await runRepoAction(svc, { ...group, report }, "prune")).toBe(message);
    close();
  });
});
