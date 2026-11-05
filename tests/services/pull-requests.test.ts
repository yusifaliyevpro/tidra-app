import { describe, expect, it } from "vitest";
import { runs } from "@/core/db/schema";
import { SECRET_KEYS } from "@/core/secrets";
import {
  commitAndPushProject,
  commitProject,
  hasUnpushed,
  isTidraBranch,
  openPullRequest,
  pullTarget,
  updateBranchPlan,
} from "@/services/pull-requests";
import { jsonResponse, memoryIo, ok } from "../support/memory-io";
import { testServices } from "../support/services";

const onBranch = (branch: string) => (program: string, args: string[]) =>
  program === "git" && args[0] === "status" ? ok(`# branch.oid a\n# branch.head ${branch}\n`) : ok();

describe("updateBranchPlan", () => {
  it("keeps adding to an update branch that has no merged pull request", async () => {
    const io = memoryIo({}, { run: onBranch("tidra/deps-20261031-1437") });
    const { svc, close } = await testServices(io);
    const plan = await updateBranchPlan(svc, { path: "/r", remote: null, updateOnBranch: true }, "tidra/deps-new");
    close();
    expect(plan).toEqual({});
    expect(io.runs.some((r) => r.args[0] === "switch")).toBe(false);
  });

  it("starts a new branch from anywhere else", async () => {
    const { svc, close } = await testServices(memoryIo({}, { run: onBranch("main") }));
    const plan = await updateBranchPlan(svc, { path: "/r", remote: null, updateOnBranch: true }, "tidra/deps-new");
    close();
    expect(plan).toEqual({ branch: "tidra/deps-new" });
  });

  it("stays on the current branch when branches are off", async () => {
    const { svc, close } = await testServices(memoryIo({}, { run: onBranch("main") }));
    const plan = await updateBranchPlan(svc, { path: "/r", remote: null, updateOnBranch: false }, "tidra/deps-new");
    close();
    expect(plan).toEqual({});
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

  it("uses an update's message only once", async () => {
    const { io, svc, close } = await stoppedUpdate("chore(deps): bump react 19.2.0 → 19.3.1");
    await commitProject(svc, "p1");
    const second = await commitProject(svc, "p1");
    close();
    expect(second).toBe("chore(deps): update dependencies");
    expect(io.runs.filter((r) => r.args[0] === "commit")).toHaveLength(2);
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

  it("refreshes the project only after the push, so the screen never shows the half-done state", async () => {
    const { io, svc, close } = await stoppedUpdate("chore(deps): bump 2 dependencies");
    await commitAndPushProject(svc, "p1");
    close();
    const git = io.runs.map((r) => r.args.join(" "));
    const commit = git.findIndex((l) => l.startsWith("commit -m"));
    const push = git.indexOf("push --set-upstream origin tidra/deps-1");
    expect(git.slice(commit, push).some((l) => l.startsWith("for-each-ref"))).toBe(false);
  });
});

describe("openPullRequest", () => {
  const COMMITS = "chore(deps): bump 2 dependencies\n\n- oxfmt 0.75.0 → 0.76.0\n- vite 8.3.4 → 8.3.5\n\x1e\n";

  async function repoWithPulls(branch: string, existing: object[] = [], token = true) {
    const requests: { method: string; url: string; body?: unknown }[] = [];
    const io = memoryIo(
      {},
      {
        run: (program, args) => {
          if (program !== "git") return ok();
          if (args[0] === "status") return ok(`# branch.oid a\n# branch.head ${branch}\n`);
          if (args.join(" ") === "remote get-url upstream") return { code: 2, stdout: "", stderr: "" };
          if (args[0] === "log") return ok(COMMITS);
          return ok();
        },
        fetch: async (input, init) => {
          const url = new Request(input, init).url;
          const method = init?.method ?? "GET";
          requests.push({ method, url, body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
          if (url.endsWith("/repos/me/app"))
            return jsonResponse({
              full_name: "me/app",
              default_branch: "main",
              stargazers_count: 0,
              open_issues_count: 0,
              html_url: "u",
            });
          if (url.includes("/pulls?state=all")) return jsonResponse(existing);
          return jsonResponse({ html_url: "https://github.com/me/app/pull/7" });
        },
      },
    );
    const { svc, close } = await testServices(io);
    if (token) await svc.setSecret(SECRET_KEYS.github, "ghp_test");
    await svc.store.addProject({ id: "p1", name: "app", remote: "github.com/me/app", path: "/app" });
    return { io, svc, close, requests };
  }

  it("pushes the branch and opens a pull request listing every package", async () => {
    const { io, svc, close, requests } = await repoWithPulls("tidra/deps-1");
    const result = await openPullRequest(svc, "p1");
    close();
    expect(result).toEqual({ url: "https://github.com/me/app/pull/7", created: true });
    expect(io.runs.map((r) => r.args.join(" "))).toContain("push --set-upstream origin tidra/deps-1");
    const created = requests.find((r) => r.method === "POST");
    expect(created?.body).toEqual({
      title: "chore(deps): bump 2 dependencies",
      head: "me:tidra/deps-1",
      base: "main",
      body: "<!-- tidra:commits -->\n- oxfmt 0.75.0 → 0.76.0\n- vite 8.3.4 → 8.3.5\n<!-- /tidra:commits -->",
    });
  });

  it("refreshes the description of the pull request that is already open", async () => {
    const open = {
      number: 3,
      html_url: "https://github.com/me/app/pull/3",
      state: "open",
      title: "chore(deps): bump oxfmt 0.75.0 → 0.76.0",
      body: "Tested.\n\n<!-- tidra:commits -->\n- old\n<!-- /tidra:commits -->",
      merged_at: null,
    };
    const { svc, close, requests } = await repoWithPulls("tidra/deps-1", [open]);
    const result = await openPullRequest(svc, "p1");
    close();
    expect(result).toEqual({ url: "https://github.com/me/app/pull/3", created: false });
    const patch = requests.find((r) => r.method === "PATCH");
    expect(patch?.url).toBe("https://api.github.com/repos/me/app/pulls/3");
    expect(patch?.body).toEqual({
      title: "chore(deps): bump 2 dependencies",
      body: "Tested.\n\n<!-- tidra:commits -->\n- oxfmt 0.75.0 → 0.76.0\n- vite 8.3.4 → 8.3.5\n<!-- /tidra:commits -->",
    });
  });

  it("refuses to open one from the default branch", async () => {
    const { svc, close } = await repoWithPulls("main");
    await expect(openPullRequest(svc, "p1")).rejects.toThrow(
      "You're on main. Switch to the branch with your changes first.",
    );
    close();
  });

  it("needs a GitHub token", async () => {
    const { svc, close } = await repoWithPulls("tidra/deps-1", [], false);
    await expect(openPullRequest(svc, "p1")).rejects.toThrow("Add a GitHub token in Settings to open pull requests.");
    close();
  });
});

describe("updateBranchPlan after a merged pull request", () => {
  it("starts again from the freshly pulled default branch", async () => {
    const io = memoryIo(
      {},
      {
        run: (program, args) => {
          if (program !== "git") return ok();
          if (args[0] === "status") return ok("# branch.oid a\n# branch.head tidra/deps-old\n");
          if (args.join(" ") === "remote get-url upstream") return { code: 2, stdout: "", stderr: "" };
          if (args[0] === "symbolic-ref") return ok("origin/main\n");
          return ok();
        },
        fetch: async () =>
          jsonResponse([
            { number: 1, html_url: "u", state: "closed", title: "t", body: null, merged_at: "2026-11-01T00:00:00Z" },
          ]),
      },
    );
    const { svc, close } = await testServices(io);
    await svc.setSecret(SECRET_KEYS.github, "ghp_test");
    const plan = await updateBranchPlan(
      svc,
      { path: "/r", remote: "github.com/me/app", updateOnBranch: true },
      "tidra/deps-new",
    );
    close();
    expect(plan).toEqual({ branch: "tidra/deps-new" });
    expect(io.runs.map((r) => r.args.join(" "))).toEqual(expect.arrayContaining(["switch main", "pull --ff-only"]));
  });
});

const gitStatus = (branch: string | undefined, upstream: string | undefined, ahead: number) => ({
  branch,
  upstream,
  ahead,
  behind: 0,
  changed: 0,
  untracked: 0,
  conflicted: 0,
});

describe("hasUnpushed and isTidraBranch", () => {
  it("counts commits ahead of upstream and Tidra branches that were never pushed", () => {
    expect(hasUnpushed(gitStatus("main", "origin/main", 2))).toBe(true);
    expect(hasUnpushed(gitStatus("main", "origin/main", 0))).toBe(false);
    expect(hasUnpushed(gitStatus("tidra/deps-1", undefined, 0))).toBe(true);
    expect(hasUnpushed(gitStatus("feature", undefined, 0))).toBe(false);
    expect(hasUnpushed(gitStatus(undefined, undefined, 3))).toBe(false);
    expect(hasUnpushed(undefined)).toBe(false);
  });

  it("knows Tidra's own branches", () => {
    expect(isTidraBranch("tidra/actions-20261101-1200")).toBe(true);
    expect(isTidraBranch("feature/tidra")).toBe(false);
    expect(isTidraBranch(undefined)).toBe(false);
  });
});
