import { describe, expect, it } from "vitest";
import { pullTarget, updateBranchPlan } from "@/services/pull-requests";
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
