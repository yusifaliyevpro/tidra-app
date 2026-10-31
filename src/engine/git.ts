import type { Io, RunOptions, RunResult } from "./io";

export interface GitStatus {
  branch: string | undefined;
  upstream: string | undefined;
  ahead: number;
  behind: number;
  /** Tracked files with staged or unstaged changes. */
  changed: number;
  untracked: number;
  conflicted: number;
}

export const isClean = (status: GitStatus) => status.changed === 0 && status.untracked === 0;

/** Parses `git status --porcelain=v2 --branch`. */
export function parseStatus(output: string): GitStatus {
  const status: GitStatus = {
    branch: undefined,
    upstream: undefined,
    ahead: 0,
    behind: 0,
    changed: 0,
    untracked: 0,
    conflicted: 0,
  };
  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith("# branch.head ")) {
      const head = line.slice(14);
      status.branch = head === "(detached)" ? undefined : head;
    } else if (line.startsWith("# branch.upstream ")) status.upstream = line.slice(18);
    else if (line.startsWith("# branch.ab ")) {
      const match = /\+(\d+) -(\d+)/.exec(line);
      status.ahead = Number(match?.[1] ?? 0);
      status.behind = Number(match?.[2] ?? 0);
    } else if (line.startsWith("1 ") || line.startsWith("2 ")) status.changed++;
    else if (line.startsWith("u ")) status.conflicted++;
    else if (line.startsWith("? ")) status.untracked++;
  }
  return status;
}

/** `git@github.com:o/r.git`, `https://github.com/o/r`, `ssh://git@github.com/o/r` → `github.com/o/r`. */
export function normalizeRemote(url: string): string | undefined {
  const trimmed = url
    .trim()
    .replace(/\/$/, "")
    .replace(/\.git$/, "");
  const scp = /^[\w.-]+@([\w.-]+):(.+)$/.exec(trimmed);
  if (scp) return `${scp[1]}/${scp[2]}`.toLowerCase();
  try {
    const parsed = new URL(trimmed.replace(/^git\+/, ""));
    return `${parsed.hostname}${parsed.pathname}`.toLowerCase();
  } catch {
    return undefined;
  }
}

export function githubSlug(url: string | undefined): { owner: string; repo: string } | undefined {
  const normalized = url ? normalizeRemote(url.replace(/^github:/, "https://github.com/")) : undefined;
  const match = normalized ? /^github\.com\/([^/]+)\/([^/#]+)/.exec(normalized) : null;
  return match?.[1] && match[2] ? { owner: match[1], repo: match[2] } : undefined;
}

export interface BranchInfo {
  name: string;
  lastCommit: Date;
  upstreamGone: boolean;
  ahead: number;
}

/** Parses `git for-each-ref --format=%(refname:short)|%(committerdate:unix)|%(upstream:track) refs/heads`. */
export function parseBranches(output: string): BranchInfo[] {
  return output
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [name = "", date = "0", track = ""] = line.split("|");
      return {
        name,
        lastCommit: new Date(Number(date) * 1000),
        upstreamGone: track.includes("gone"),
        ahead: Number(/ahead (\d+)/.exec(track)?.[1] ?? 0),
      };
    });
}

export class GitError extends Error {
  constructor(
    readonly args: string[],
    readonly result: RunResult,
  ) {
    super(`git ${args.join(" ")} failed: ${(result.stderr || result.stdout).trim() || `exit ${result.code}`}`);
    this.name = "GitError";
  }
}

export function createGit(io: Io, cwd: string) {
  const raw = (args: string[], options: Omit<RunOptions, "cwd"> = {}) =>
    io.run("git", args, { ...options, cwd, env: { GIT_TERMINAL_PROMPT: "0", LC_ALL: "C", ...options.env } });
  const run = async (args: string[], options?: Omit<RunOptions, "cwd">) => {
    const result = await raw(args, options);
    if (result.code !== 0) throw new GitError(args, result);
    return result.stdout.trim();
  };

  return {
    raw,
    run,
    status: async () => parseStatus(await run(["status", "--porcelain=v2", "--branch"])),
    remoteUrl: async () => {
      const result = await raw(["remote", "get-url", "origin"]);
      return result.code === 0 ? result.stdout.trim() : undefined;
    },
    branches: async () =>
      parseBranches(
        await run(["for-each-ref", "--format=%(refname:short)|%(committerdate:unix)|%(upstream:track)", "refs/heads"]),
      ),
    switchCreate: (name: string) => run(["switch", "-c", name]),
    switchTo: (name: string) => run(["switch", name]),
    deleteBranch: (name: string) => run(["branch", "-D", name]),
    add: (paths: string[]) => run(["add", "--", ...paths]),
    commit: (message: string) => run(["commit", "-m", message]),
    headSha: () => run(["rev-parse", "HEAD"]),
    push: (branch: string) => run(["push", "--set-upstream", "origin", branch]),
    fetch: () => run(["fetch", "--all", "--prune"]),
    restore: (paths: string[]) => run(["checkout", "--", ...paths]),
    stash: () => run(["stash", "push", "--include-untracked", "-m", "tidra: before dependency update"]),
  };
}

export type Git = ReturnType<typeof createGit>;
