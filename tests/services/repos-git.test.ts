import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Services } from "@/services/context";
import { readReport, refreshProject } from "@/services/projects";
import {
  deleteBranchEverywhere,
  deleteBranches,
  listBranchDetails,
  listBranches,
  switchBranch,
  syncRepo,
} from "@/services/repos";
import { nodeIo } from "../support/node-io";
import { testServices } from "../support/services";

const stateOf = async (svc: Services) =>
  Object.fromEntries(
    (await listBranchDetails(svc, "p1")).branches.map((b) => [
      b.name,
      { merged: b.merged, current: b.current, isDefault: b.isDefault },
    ]),
  );

// Real git against throwaway repositories: what these pin is git's own behaviour, which a fake Io can't show.
describe("branches and sync on real repositories", { timeout: 30_000 }, () => {
  let base: string;
  let env: Record<string, string>;
  let cleanups: (() => Promise<void> | void)[] = [];

  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", args, { cwd, env: { ...process.env, ...env }, encoding: "utf8", stdio: "pipe" }).trim();

  const commit = (cwd: string, file: string) => {
    writeFileSync(join(cwd, file), file);
    git(cwd, "add", "--all");
    git(cwd, "commit", "-m", `add ${file}`);
  };

  /** A remote with `main` and `shared`, and a clone of it holding a package. */
  function originAndClone() {
    git(base, "init", "--quiet", "--bare", "-b", "main", "origin.git");
    git(base, "clone", "--quiet", "origin.git", "seed");
    const seed = join(base, "seed");
    writeFileSync(join(seed, "package.json"), JSON.stringify({ name: "app" }));
    commit(seed, "a");
    git(seed, "push", "--quiet", "origin", "main");
    git(seed, "switch", "--quiet", "-c", "shared");
    commit(seed, "b");
    git(seed, "push", "--quiet", "origin", "shared");
    git(seed, "switch", "--quiet", "main");
    git(base, "clone", "--quiet", "origin.git", "work");
    return { seed, work: join(base, "work") };
  }

  /** A clone of a fork, whose `upstream` remote also has every branch. */
  function forkClone() {
    const { seed } = originAndClone();
    git(base, "init", "--quiet", "--bare", "-b", "main", "fork.git");
    git(seed, "push", "--quiet", join(base, "fork.git"), "main", "shared");
    git(base, "clone", "--quiet", "fork.git", "forked");
    const work = join(base, "forked");
    // A file:// URL: a bare POSIX path isn't a URL, so fork detection misses it off Windows.
    git(work, "remote", "add", "upstream", pathToFileURL(join(base, "origin.git")).href);
    git(work, "fetch", "--quiet", "upstream");
    return { seed, work };
  }

  /** A clone holding a merged branch, a squash-merged one and an experiment nobody merged. */
  function branchesInEveryState() {
    const { seed, work } = originAndClone();
    git(seed, "switch", "--quiet", "-c", "squashed");
    commit(seed, "s1");
    commit(seed, "s2");
    git(seed, "switch", "--quiet", "main");
    git(seed, "merge", "--quiet", "--squash", "squashed");
    git(seed, "commit", "-m", "squash merge");
    git(seed, "push", "--quiet", "origin", "main", "squashed");
    git(work, "fetch", "--quiet");
    git(work, "merge", "--quiet", "--ff-only", "origin/main");
    git(work, "branch", "squashed", "origin/squashed");
    git(work, "branch", "merged", "HEAD~1");
    git(work, "switch", "--quiet", "-c", "experiment");
    commit(work, "idea");
    git(work, "switch", "--quiet", "main");
    return { work };
  }

  async function open(path: string) {
    const io = nodeIo(env);
    const { svc, close } = await testServices(io);
    await svc.store.addProject({
      id: "p1",
      name: "app",
      remote: "github.com/me/app",
      path: path.replaceAll("\\", "/"),
    });
    cleanups.push(async () => {
      await io.settled();
      close();
    });
    await refreshProject(svc, "p1");
    return svc;
  }

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "tidra-git-"));
    const config = join(base, "gitconfig");
    writeFileSync(config, "[user]\n  name = Test\n  email = test@example.com\n");
    env = { GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: "1", HOME: base.replaceAll("\\", "/") };
    cleanups = [];
  });

  afterEach(async () => {
    for (const cleanup of cleanups) await cleanup();
    rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it("switches to a branch that only exists on origin and shows it", async () => {
    const { work } = originAndClone();
    const svc = await open(work);
    expect(await listBranches(svc, "p1")).toEqual([
      { name: "main", remote: false, onOrigin: true, isDefault: true },
      { name: "shared", remote: true, onOrigin: true, isDefault: false },
    ]);
    await switchBranch(svc, "p1", "shared");
    expect(git(work, "branch", "--show-current")).toBe("shared");
    expect((await readReport(svc, "p1"))?.git?.branch).toBe("shared");
  });

  it("deletes a branch here and on origin", async () => {
    const { work } = originAndClone();
    const svc = await open(work);
    git(work, "switch", "--quiet", "shared");
    git(work, "switch", "--quiet", "main");
    expect(await deleteBranchEverywhere(svc, "p1", "shared")).toBe("Deleted shared here and on origin.");
    expect(git(work, "branch", "--list", "shared")).toBe("");
    expect(git(join(work, "..", "origin.git"), "branch", "--list", "shared")).toBe("");
  });

  it("creates a branch from HEAD and carries uncommitted changes along", async () => {
    const { work } = originAndClone();
    const svc = await open(work);
    writeFileSync(join(work, "edit"), "work in progress");
    await switchBranch(svc, "p1", "fix/new", { create: true });
    const report = await readReport(svc, "p1");
    expect(report?.git).toMatchObject({ branch: "fix/new", untracked: 1 });
  });

  it("surfaces git's message when a change would be overwritten", async () => {
    const { work } = originAndClone();
    const svc = await open(work);
    writeFileSync(join(work, "b"), "conflicts with the file on shared");
    await expect(switchBranch(svc, "p1", "shared")).rejects.toThrow("would be overwritten");
    expect(git(work, "branch", "--show-current")).toBe("main");
  });

  it("switches a fork to a branch that origin and upstream both have", async () => {
    const { work } = forkClone();
    const svc = await open(work);
    await switchBranch(svc, "p1", "shared");
    expect(git(work, "branch", "--show-current")).toBe("shared");
  });

  it("lists a branch by its name when a tag has the same name", async () => {
    const { work } = originAndClone();
    git(work, "branch", "1.0");
    git(work, "update-ref", "refs/tags/1.0", "HEAD");
    const svc = await open(work);
    expect((await listBranches(svc, "p1")).map((branch) => branch.name)).toContain("1.0");
  });

  describe("deleting branches", () => {
    it("tells merged branches, squash merges included, from unmerged ones", async () => {
      const { work } = branchesInEveryState();
      const svc = await open(work);
      expect(await stateOf(svc)).toEqual({
        main: { merged: true, current: true, isDefault: true },
        merged: { merged: true, current: false, isDefault: false },
        squashed: { merged: true, current: false, isDefault: false },
        experiment: { merged: false, current: false, isDefault: false },
      });
    });

    it("deletes an unmerged branch and shows it gone", async () => {
      const { work } = branchesInEveryState();
      const svc = await open(work);
      expect(await deleteBranches(svc, "p1", ["experiment"])).toBe("Deleted experiment.");
      expect(git(work, "branch", "--list", "experiment")).toBe("");
      expect((await readReport(svc, "p1"))?.branches.map((b) => b.name)).not.toContain("experiment");
    });

    it("deletes several at once, but never the checked-out branch", async () => {
      const { work } = branchesInEveryState();
      const svc = await open(work);
      expect(await deleteBranches(svc, "p1", ["main", "merged", "squashed", "experiment"])).toBe("Deleted 3 branches.");
      expect(git(work, "branch", "--format=%(refname:short)")).toBe("main");
    });

    it("leaves copies on the remote alone", async () => {
      const { work } = branchesInEveryState();
      const svc = await open(work);
      await deleteBranches(svc, "p1", ["squashed"]);
      expect(git(work, "ls-remote", "origin", "refs/heads/squashed")).not.toBe("");
    });

    it("says why when a branch can't be deleted", async () => {
      const { work } = branchesInEveryState();
      git(work, "worktree", "add", "--quiet", join(base, "elsewhere"), "experiment");
      const svc = await open(work);
      await expect(deleteBranches(svc, "p1", ["experiment"])).rejects.toThrow("Couldn't delete experiment");
      expect(await deleteBranches(svc, "p1", ["experiment", "merged"])).toMatch(/^Deleted merged\. Kept experiment: /);
    });
  });

  it("pulls what origin has", async () => {
    const { seed, work } = originAndClone();
    commit(seed, "c");
    git(seed, "push", "--quiet", "origin", "main");
    const svc = await open(work);
    expect(await syncRepo(svc, "p1")).toBe("Synced app: pulled 1.");
    expect(git(work, "rev-parse", "HEAD")).toBe(git(seed, "rev-parse", "HEAD"));
  });

  it("pushes what origin lacks", async () => {
    const { work } = originAndClone();
    commit(work, "c");
    const svc = await open(work);
    expect(await syncRepo(svc, "p1")).toBe("Synced app: pushed 1.");
    expect(git(work, "rev-parse", "HEAD")).toBe(git(join(base, "origin.git"), "rev-parse", "main"));
  });

  it("pushes the branch it's on, not the default one", async () => {
    const { seed, work } = originAndClone();
    git(work, "switch", "--quiet", "shared");
    commit(work, "mine");
    const svc = await open(work);
    expect(await syncRepo(svc, "p1")).toBe("Synced app: pushed 1.");
    expect(git(seed, "ls-remote", "origin", "refs/heads/shared").split("\t")[0]).toBe(git(work, "rev-parse", "HEAD"));
  });

  it("stops on a diverged branch and leaves both sides alone", async () => {
    const { seed, work } = originAndClone();
    commit(seed, "theirs");
    git(seed, "push", "--quiet", "origin", "main");
    commit(work, "mine");
    const head = git(work, "rev-parse", "HEAD");
    const remote = git(seed, "rev-parse", "HEAD");
    const svc = await open(work);
    await expect(syncRepo(svc, "p1")).rejects.toThrow(/fast-forward/i);
    expect(git(work, "rev-parse", "HEAD")).toBe(head);
    expect(git(join(base, "origin.git"), "rev-parse", "main")).toBe(remote);
  });

  it("publishes a branch that has no upstream", async () => {
    const { work } = originAndClone();
    git(work, "switch", "--quiet", "-c", "feature/new");
    const svc = await open(work);
    expect(await syncRepo(svc, "p1")).toBe("Synced app: published the branch.");
    expect(git(work, "rev-parse", "--abbrev-ref", "@{u}")).toBe("origin/feature/new");
  });

  it("fast-forwards a fork's default branch to upstream and pushes it to the fork", async () => {
    const { seed, work } = forkClone();
    commit(seed, "upstream-work");
    git(seed, "push", "--quiet", "origin", "main");
    const svc = await open(work);
    expect(await syncRepo(svc, "p1")).toBe("Synced app: took 1 from upstream, pushed 1.");
    expect(git(join(base, "fork.git"), "rev-parse", "main")).toBe(git(seed, "rev-parse", "HEAD"));
  });
});
