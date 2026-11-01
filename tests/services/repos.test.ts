import { describe, expect, it } from "vitest";
import { listBranches, switchBranch, syncRepo } from "@/services/repos";
import { memoryIo, ok } from "../support/memory-io";
import { testServices } from "../support/services";

const repoFiles = { "/code/app/package.json": JSON.stringify({ name: "app" }) };

const git = (program: string, args: string[]) => {
  if (program !== "git") return ok();
  const line = args.join(" ");
  if (line.includes("refs/heads")) return ok("main\nfeature/a\n");
  if (line.includes("refs/remotes/origin")) return ok("origin/HEAD\norigin\norigin/main\norigin/feature/b\n");
  if (args[0] === "status") return ok("# branch.oid a\n# branch.head main\n");
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

async function runSync(statuses: ReturnType<typeof ok>[], upstreamRemote?: string, upstreamBehind = 0) {
  let call = 0;
  const io = memoryIo(repoFiles, {
    run: (program, args) => {
      if (program !== "git") return ok();
      const line = args.join(" ");
      if (args[0] === "status") return statuses[Math.min(call++, statuses.length - 1)] ?? ok();
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

describe("syncRepo", () => {
  it("pulls what origin has, then pushes what it lacks", async () => {
    const { message, gitCalls } = await runSync([
      status("main", "origin/main", 1, 3),
      status("main", "origin/main", 1, 0),
    ]);
    expect(gitCalls).toEqual(["fetch --all --prune", "pull --ff-only", "push"]);
    expect(message).toBe("Synced app: pulled 3, pushed 1.");
  });

  it("fast-forwards a fork's default branch to upstream and pushes it to the fork", async () => {
    const { gitCalls } = await runSync(
      [status("main", "origin/main", 0, 0), status("main", "origin/main", 2, 0)],
      "https://github.com/them/app.git",
      2,
    );
    expect(gitCalls).toEqual(["fetch --all --prune", "merge --ff-only upstream/main", "push"]);
  });

  it("publishes a branch that has no upstream yet", async () => {
    const { gitCalls } = await runSync([status("feature/x", undefined, 0, 0)]);
    expect(gitCalls).toEqual(["fetch --all --prune", "push --set-upstream origin feature/x"]);
  });

  it("says so when there is nothing to do", async () => {
    const { message } = await runSync([status("main", "origin/main", 0, 0)]);
    expect(message).toBe("app is in sync.");
  });
});
