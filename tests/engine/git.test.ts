import { describe, expect, it } from "vitest";
import { githubSlug, isClean, normalizeRemote, parseBranches, parseStatus } from "@/engine/git";

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
