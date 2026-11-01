import { describe, expect, it } from "vitest";
import { runs } from "@/core/db/schema";
import { commitAndPushProject, commitProject, pullTarget, updateBranchPlan } from "@/services/pull-requests";
import { memoryIo, ok } from "../support/memory-io";
import { testServices } from "../support/services";

const onBranch = (branch: string) => (program: string, args: string[]) =>
  program === "git" && args[0] === "status" ? ok(`# branch.oid a\n# branch.head ${branch}\n`) : ok();

describe("updateBranchPlan", () => {
  it("keeps adding to an update branch that has no merged pull request", async () => {
    const io = memoryIo({}, { run: onBranch("tidra/deps-20261031-1437") });
    const { svc, close } = await testServices(io);
    const plan = await updateBranchPlan(svc, { path: "/r", remote: null, updateOnBranch: true }, "tidra/deps-new");
    close();
    expect(plan).toEqual({ continueBranch: true });
    expect(io.runs.some((r) => r.args[0] === "switch")).toBe(false);
  });

  it("starts a new branch from anywhere else", async () => {
    const { svc, close } = await testServices(memoryIo({}, { run: onBranch("main") }));
    const plan = await updateBranchPlan(svc, { path: "/r", remote: null, updateOnBranch: true }, "tidra/deps-new");
    close();
    expect(plan).toEqual({ branch: "tidra/deps-new", continueBranch: false });
  });

  it("stays on the current branch when branches are off", async () => {
    const { svc, close } = await testServices(memoryIo({}, { run: onBranch("main") }));
    const plan = await updateBranchPlan(svc, { path: "/r", remote: null, updateOnBranch: false }, "tidra/deps-new");
    close();
    expect(plan).toEqual({ continueBranch: false });
  });
});

const remotes = (upstream?: string) => (_program: string, args: string[]) => {
  if (args.join(" ") === "remote get-url upstream")
    return upstream
      ? ok(`${upstream}
`)
      : { code: 2, stdout: "", stderr: "" };
  return { code: 1, stdout: "", stderr: "" };
};

describe("pullTarget", () => {
  it("targets the upstream repo of a fork, with the branch from the fork as head", async () => {
    const { svc, close } = await testServices(memoryIo({}, { run: remotes("git@github.com:the-jk-labs/omicron.git") }));
    const target = await pullTarget(svc, "/r", "github.com/yusifaliyevpro/omicron");
    close();
    expect(target).toEqual({ repo: "the-jk-labs/omicron", remote: "upstream", headOwner: "yusifaliyevpro" });
  });

  it("targets origin when there is no upstream remote", async () => {
    const { svc, close } = await testServices(memoryIo({}, { run: remotes() }));
    const target = await pullTarget(svc, "/r", "github.com/me/app");
    close();
    expect(target).toEqual({ repo: "me/app", remote: "origin", headOwner: "me" });
  });
});

async function stoppedUpdate(message: string) {
  const io = memoryIo(
    { "/r/package.json": JSON.stringify({ name: "r" }) },
    {
      run: (program, args) =>
        program === "git" && args[0] === "status"
          ? ok("# branch.oid a\n# branch.head tidra/deps-1\n1 .M N... 100644 100644 100644 a b package.json\n")
          : ok(),
    },
  );
  const { svc, close } = await testServices(io);
  await svc.store.addProject({ id: "p1", name: "r", remote: null, path: "/r" });
  await svc.store.db.insert(runs).values({
    id: "run1",
    projectId: "p1",
    kind: "update",
    title: "Update react",
    startedAt: "2026-11-01T10:00:00.000Z",
    ok: false,
    result: { ok: false, failedStep: "checks", message, changes: [], touched: [] },
  });
  return { io, svc, close };
}

describe("commitProject", () => {
  it("commits everything with the message of the update that stopped at its checks", async () => {
    const { io, svc, close } = await stoppedUpdate("chore(deps): bump react 19.2.0 → 19.3.1");
    const subject = await commitProject(svc, "p1");
    close();
    const git = io.runs.map((r) => r.args.join(" "));
    expect(subject).toBe("chore(deps): bump react 19.2.0 → 19.3.1");
    expect(git).toContain("add --all");
    expect(git).toContain("commit -m chore(deps): bump react 19.2.0 → 19.3.1");
  });

  it("pushes right after committing for Commit & Push", async () => {
    const { io, svc, close } = await stoppedUpdate("chore(deps): bump 2 dependencies");
    await commitAndPushProject(svc, "p1");
    close();
    const git = io.runs.map((r) => r.args.join(" "));
    expect(git.indexOf("push --set-upstream origin tidra/deps-1")).toBeGreaterThan(
      git.findIndex((l) => l.startsWith("commit -m")),
    );
  });
});
