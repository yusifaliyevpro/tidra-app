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
    .replace(/#.*$/, "")
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

export interface ForkInfo {
  /** Normalized URL of the `upstream` remote, the repo this one was forked from. */
  remote: string;
  /** Commits on upstream's default branch that this checkout does not have yet. */
  behind?: number;
  /** The upstream ref compared against, e.g. `upstream/main`. */
  ref?: string;
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

const FETCH_LIMIT_MS = 2 * 60_000;
// A pre-push hook can run a whole test suite.
const PUSH_LIMIT_MS = 10 * 60_000;

/** The fetch running in each checkout: two at once can fail with "cannot lock ref", and the second adds nothing. */
const runningFetches = new WeakMap<Io, Map<string, Promise<string>>>();

export function createGit(io: Io, cwd: string) {
  const raw = (args: string[], options: Omit<RunOptions, "cwd"> = {}) =>
    io.run("git", args, { ...options, cwd, env: { GIT_TERMINAL_PROMPT: "0", LC_ALL: "C", ...options.env } });
  const run = async (args: string[], options?: Omit<RunOptions, "cwd">) => {
    const result = await raw(args, options);
    if (result.code !== 0) throw new GitError(args, result);
    return result.stdout.trim();
  };

  const startFetch = async (options?: Omit<RunOptions, "cwd">) => {
    const remotes = (await run(["remote"])).split(/\r?\n/);
    const wanted = ["origin", "upstream"].filter((name) => remotes.includes(name));
    if (wanted.length === 0) return "";
    const signal = options?.signal ?? AbortSignal.timeout(FETCH_LIMIT_MS);
    const jobs = wanted.length > 1 ? [`--jobs=${wanted.length}`] : [];
    return run(["fetch", "--prune", "--quiet", "--multiple", ...jobs, ...wanted], { ...options, signal }).catch(
      (error: unknown) => {
        if (signal.aborted) throw new Error("git fetch didn't finish in time. Check your connection.");
        throw error;
      },
    );
  };

  /** origin and a fork's upstream only: `--all` fails when any other remote is gone (a contributor's deleted fork). */
  const fetch = (options?: Omit<RunOptions, "cwd">): Promise<string> => {
    const running = runningFetches.get(io) ?? new Map<string, Promise<string>>();
    runningFetches.set(io, running);
    // Join the fetch already running; if it fails (a background time limit, say), this caller still gets its own try.
    const current = running.get(cwd);
    if (current) return current.catch(() => fetch(options));
    const started = startFetch(options).finally(() => running.delete(cwd));
    running.set(cwd, started);
    return started;
  };

  return {
    raw,
    run,
    // Status would otherwise refresh the index under index.lock, failing a switch or commit running at that moment.
    status: async () =>
      parseStatus(await run(["status", "--porcelain=v2", "--branch"], { env: { GIT_OPTIONAL_LOCKS: "0" } })),
    remoteUrl: async () => {
      const result = await raw(["remote", "get-url", "origin"]);
      return result.code === 0 ? result.stdout.trim() : undefined;
    },
    /** The `upstream` remote of a fork, compared with the last fetched upstream default branch. */
    fork: async (): Promise<ForkInfo | undefined> => {
      const url = await raw(["remote", "get-url", "upstream"]);
      const remote = url.code === 0 ? normalizeRemote(url.stdout) : undefined;
      if (!remote) return undefined;
      for (const ref of ["upstream/HEAD", "upstream/main", "upstream/master"]) {
        const count = await raw(["rev-list", "--count", `HEAD..${ref}`]);
        if (count.code === 0) {
          const head = await raw(["rev-parse", "--abbrev-ref", ref]);
          return { remote, behind: Number(count.stdout.trim()), ref: head.code === 0 ? head.stdout.trim() : ref };
        }
      }
      return { remote };
    },
    // lstrip, not short: `short` turns a branch into `heads/1.0` when a tag has the same name.
    branches: async () =>
      parseBranches(
        await run([
          "for-each-ref",
          "--format=%(refname:lstrip=2)|%(committerdate:unix)|%(upstream:track)",
          "refs/heads",
        ]),
      ),
    switchCreate: (name: string) => run(["switch", "-c", name]),
    // On a fork, `git switch` refuses a branch that origin and upstream both have unless told which one to prefer.
    switchTo: (name: string) =>
      run(["switch", name], {
        env: { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "checkout.defaultRemote", GIT_CONFIG_VALUE_0: "origin" },
      }),
    deleteBranch: (name: string) => run(["branch", "-D", name]),
    /** Local branches whose every commit is already in `base`. */
    mergedInto: async (base: string) =>
      (await run(["for-each-ref", "--merged", base, "--format=%(refname:lstrip=2)", "refs/heads"]))
        .split(/\r?\n/)
        .filter(Boolean),
    /** A squash merge shares no commits with its branch, so this compares the branch's whole change with `base`. */
    squashMerged: async (base: string, branch: string) => {
      const ref = `refs/heads/${branch}`;
      const mergeBase = await raw(["merge-base", base, ref]);
      if (mergeBase.code !== 0) return false;
      const squashed = await raw(["commit-tree", `${ref}^{tree}`, "-p", mergeBase.stdout.trim(), "-m", "squash"], {
        env: {
          GIT_AUTHOR_NAME: "Tidra",
          GIT_AUTHOR_EMAIL: "tidra@localhost",
          GIT_COMMITTER_NAME: "Tidra",
          GIT_COMMITTER_EMAIL: "tidra@localhost",
        },
      });
      if (squashed.code !== 0) return false;
      const cherry = await raw(["cherry", base, squashed.stdout.trim()]);
      return cherry.code === 0 && cherry.stdout.startsWith("-");
    },
    add: (paths: string[]) => run(["add", "--", ...paths]),
    commit: (message: string) => run(["commit", "-m", message]),
    headSha: () => run(["rev-parse", "HEAD"]),
    push: (branch: string) =>
      run(["push", "--set-upstream", "origin", branch], { signal: AbortSignal.timeout(PUSH_LIMIT_MS) }),
    fetch,
    pull: () => run(["pull", "--ff-only"], { signal: AbortSignal.timeout(FETCH_LIMIT_MS) }),
    /** A pull right after a fetch, without connecting to the remote a second time. */
    fastForward: () => run(["merge", "--ff-only", "@{u}"]),
    /** origin's default branch as last fetched, e.g. `main`. */
    defaultBranch: async () => {
      const result = await raw(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
      return result.code === 0 ? result.stdout.trim().replace(/^origin\//, "") : undefined;
    },
    /** Full commit messages on HEAD that `base` does not have, oldest first. */
    messagesSince: async (base: string) =>
      (await run(["log", "--reverse", "--format=%B%x1e", `${base}..HEAD`]))
        .split("\x1e")
        .map((message) => message.trim())
        .filter(Boolean),
    pushCurrent: () => run(["push"], { signal: AbortSignal.timeout(PUSH_LIMIT_MS) }),
    deleteRemoteBranch: (name: string) =>
      run(["push", "origin", "--delete", name], { signal: AbortSignal.timeout(PUSH_LIMIT_MS) }),
    /** Tracked files that differ from HEAD, relative to this folder. */
    changedPaths: async () => (await run(["diff", "--name-only", "--relative", "HEAD"])).split(/\r?\n/).filter(Boolean),
    /** One path at a time: git rejects the whole list when any path is untracked (a gitignored lockfile). */
    restore: async (paths: string[]) => {
      for (const path of paths) {
        const args = ["checkout", "--", path];
        const result = await raw(args);
        if (result.code !== 0 && !result.stderr.includes("did not match")) throw new GitError(args, result);
      }
    },
  };
}

export type Git = ReturnType<typeof createGit>;
