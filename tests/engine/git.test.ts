import { describe, expect, it } from "vitest";
import { createGit, githubSlug, isClean, normalizeRemote, parseBranches, parseStatus } from "@/engine/git";
import type { RunResult } from "@/engine/io";
import { memoryIo, ok } from "../support/memory-io";

describe("parseStatus", () => {
  it("reads branch, upstream, ahead/behind and change counts", () => {
    const status = parseStatus(
      [
        "# branch.oid 1234abcd",
        "# branch.head main",
        "# branch.upstream origin/main",
        "# branch.ab +2 -1",
        "1 .M N... 100644 100644 100644 a b package.json",
        "2 R. N... 100644 100644 100644 a b R100 new.ts\told.ts",
        "u UU N... 100644 100644 100644 100644 a b c conflict.ts",
        "? scratch.txt",
      ].join("\n"),
    );
    expect(status).toEqual({
      branch: "main",
      upstream: "origin/main",
      ahead: 2,
      behind: 1,
      changed: 2,
      untracked: 1,
      conflicted: 1,
    });
    expect(isClean(status)).toBe(false);
  });

  it("handles detached heads and branches without upstream", () => {
    const status = parseStatus("# branch.oid abc\n# branch.head (detached)\n");
    expect(status.branch).toBeUndefined();
    expect(status.upstream).toBeUndefined();
    expect(isClean(status)).toBe(true);
  });
});

describe("remotes", () => {
  it("normalizes ssh, scp-style and https remotes to one key", () => {
    for (const url of [
      "git@github.com:Owner/Repo.git",
      "https://github.com/owner/repo",
      "https://github.com/owner/repo.git/",
      "ssh://git@github.com/owner/repo.git",
      "git+https://github.com/owner/repo.git",
    ]) {
      expect(normalizeRemote(url)).toBe("github.com/owner/repo");
    }
  });

  it("extracts GitHub owner and repo", () => {
    expect(githubSlug("github:vitejs/vite")).toEqual({ owner: "vitejs", repo: "vite" });
    expect(githubSlug("https://github.com/facebook/react/tree/main/packages/react")).toEqual({
      owner: "facebook",
      repo: "react",
    });
    expect(githubSlug("https://gitlab.com/a/b")).toBeUndefined();
    expect(githubSlug(undefined)).toBeUndefined();
  });
});

describe("parseBranches", () => {
  it("reads last commit time and upstream tracking", () => {
    const branches = parseBranches("main|1761900000|\nold-feature|1700000000|[gone]\nwip|1761000000|[ahead 3]\n");
    expect(branches.map((b) => [b.name, b.upstreamGone, b.ahead])).toEqual([
      ["main", false, 0],
      ["old-feature", true, 0],
      ["wip", false, 3],
    ]);
    expect(branches[0]?.lastCommit.toISOString()).toBe("2025-10-31T08:40:00.000Z");
  });
});

describe("parseStatus edge cases", () => {
  it("counts renames as changes and reports conflicts separately", () => {
    const status = parseStatus(
      "# branch.oid abc\n# branch.head feature/x\n# branch.upstream origin/feature/x\n# branch.ab +2 -1\n1 M. N... 100644 100644 100644 a b f1\n2 R. N... 100644 100644 100644 a b R100 new\told\nu UU N... 1 2 3 4 a b c conflict\n? untracked\n! ignored\n",
    );
    expect(status).toEqual({
      branch: "feature/x",
      upstream: "origin/feature/x",
      ahead: 2,
      behind: 1,
      changed: 2,
      untracked: 1,
      conflicted: 1,
    });
    expect(isClean(status)).toBe(false);
  });

  it("reads CRLF output and an empty repository", () => {
    expect(parseStatus("# branch.oid (initial)\r\n# branch.head main\r\n")).toMatchObject({
      branch: "main",
      changed: 0,
    });
    expect(parseStatus("")).toMatchObject({ branch: undefined, ahead: 0, behind: 0 });
  });
});

describe("normalizeRemote and githubSlug edge cases", () => {
  it.for([
    ["ssh://git@github.com:22/o/r.git", "github.com/o/r"],
    ["https://x-access-token:abc@github.com/o/r.git", "github.com/o/r"],
    ["https://GitHub.com/O/R", "github.com/o/r"],
    ["git@github.com:o/r.git/", "github.com/o/r"],
    ["git@gitlab.com:group/sub/r.git", "gitlab.com/group/sub/r"],
  ])("normalizes %s", ([url, expected]) => {
    expect(normalizeRemote(url ?? "")).toBe(expected);
  });

  it("returns undefined for things that aren't remotes", () => {
    expect(normalizeRemote("")).toBeUndefined();
    expect(normalizeRemote("o/r")).toBeUndefined();
  });

  it("only gives a slug for GitHub", () => {
    expect(githubSlug("git@gitlab.com:group/r.git")).toBeUndefined();
    expect(githubSlug(undefined)).toBeUndefined();
    expect(githubSlug("github:Owner/Repo")).toEqual({ owner: "owner", repo: "repo" });
  });

  it("drops .git before a #ref", () => {
    expect(githubSlug("git+https://github.com/o/r.git#main")).toEqual({ owner: "o", repo: "r" });
  });
});

describe("parseBranches edge cases", () => {
  it("reads ahead counts next to behind and skips blank lines", () => {
    expect(parseBranches("feat|1700000001|[ahead 3, behind 1]\n\n")).toEqual([
      { name: "feat", lastCommit: new Date(1_700_000_001_000), upstreamGone: false, ahead: 3 },
    ]);
  });
});

const gitIo = (handler: (args: string[]) => RunResult) =>
  memoryIo({}, { run: (program, args) => (program === "git" ? handler(args) : ok()) });

it("runs git in the checkout without prompting for credentials", async () => {
  const io = memoryIo({}, { run: async (_p, _a, options) => ok(JSON.stringify(options?.env)) });
  const env = JSON.parse(await createGit(io, "/repo").run(["status"]));
  expect(env).toMatchObject({ GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" });
  expect(io.runs[0]).toMatchObject({ program: "git", cwd: "/repo" });
});

describe("createGit", () => {
  it("throws a GitError naming the command and git's message", async () => {
    const git = createGit(
      gitIo(() => ({ code: 128, stdout: "", stderr: "fatal: not a git repository\n" })),
      "/x",
    );
    await expect(git.run(["status"])).rejects.toThrow("git status failed: fatal: not a git repository");
  });

  it("returns undefined for a missing origin and its default branch", async () => {
    const git = createGit(
      gitIo(() => ({ code: 2, stdout: "", stderr: "" })),
      "/x",
    );
    expect(await git.remoteUrl()).toBeUndefined();
    expect(await git.defaultBranch()).toBeUndefined();
  });

  it("strips origin/ from the default branch", async () => {
    const git = createGit(
      gitIo(() => ok("origin/main\n")),
      "/x",
    );
    expect(await git.defaultBranch()).toBe("main");
  });

  it("reads full commit messages, bodies included, oldest first", async () => {
    const git = createGit(
      gitIo(() => ok("chore: one\n\n- a 1 → 2\n\x1e\nfix: two\n\x1e\n")),
      "/x",
    );
    expect(await git.messagesSince("origin/main")).toEqual(["chore: one\n\n- a 1 → 2", "fix: two"]);
  });

  it("does nothing when there is no origin or upstream to fetch", async () => {
    const io = gitIo((args) => (args[0] === "remote" ? ok("someone-else\n") : ok()));
    expect(await createGit(io, "/x").fetch()).toBe("");
    expect(io.runs.map((r) => r.args[0])).toEqual(["remote"]);
  });

  it("compares a fork with upstream/HEAD, falling back to main and master", async () => {
    const io = gitIo((args) => {
      const line = args.join(" ");
      if (line === "remote get-url upstream") return ok("https://github.com/them/app.git\n");
      if (line === "rev-list --count HEAD..upstream/master") return ok("4\n");
      if (line.startsWith("rev-list")) return { code: 128, stdout: "", stderr: "" };
      if (line === "rev-parse --abbrev-ref upstream/master") return ok("upstream/master\n");
      return ok();
    });
    expect(await createGit(io, "/x").fork()).toEqual({
      remote: "github.com/them/app",
      behind: 4,
      ref: "upstream/master",
    });
  });

  it("reports a fork without a fetched upstream branch", async () => {
    const io = gitIo((args) =>
      args.join(" ") === "remote get-url upstream"
        ? ok("git@github.com:them/app.git\n")
        : { code: 128, stdout: "", stderr: "" },
    );
    expect(await createGit(io, "/x").fork()).toEqual({ remote: "github.com/them/app" });
  });
});

describe("restore", () => {
  it("skips untracked paths and restores the rest", async () => {
    const io = gitIo((args) =>
      args.includes("lock.json") ? { code: 1, stdout: "", stderr: "error: pathspec 'lock.json' did not match" } : ok(),
    );
    await createGit(io, "/x").restore(["package.json", "lock.json", "other.json"]);
    expect(io.runs.map((r) => r.args.join(" "))).toEqual([
      "checkout -- package.json",
      "checkout -- lock.json",
      "checkout -- other.json",
    ]);
  });

  it("still fails for real errors", async () => {
    const io = gitIo(() => ({ code: 128, stdout: "", stderr: "fatal: index.lock exists" }));
    await expect(createGit(io, "/x").restore(["a"])).rejects.toThrow("index.lock exists");
  });
});

describe("status", () => {
  it("doesn't take git's index lock", async () => {
    let env: Record<string, string> | undefined;
    const io = memoryIo(
      {},
      {
        run: (_program, _args, options) => {
          env = options?.env;
          return ok("# branch.head main\n");
        },
      },
    );
    await createGit(io, "/x").status();
    expect(env?.GIT_OPTIONAL_LOCKS).toBe("0");
  });
});
