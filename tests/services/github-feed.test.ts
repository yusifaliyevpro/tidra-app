import { describe, expect, it } from "vitest";
import { SECRET_KEYS } from "@/core/secrets";
import type { WorkflowRun } from "@/integrations/github";
import {
  clearNotifications,
  currentRuns,
  readInbox,
  refreshBotPulls,
  refreshCi,
  refreshInbox,
} from "@/services/github-feed";
import { jsonResponse, memoryIo } from "../support/memory-io";
import { testServices } from "../support/services";

const run = (id: number, name: string, branch: string, extra: Partial<WorkflowRun> = {}): WorkflowRun => ({
  id,
  name,
  head_branch: branch,
  status: "completed",
  conclusion: "success",
  event: "push",
  html_url: `https://github.com/o/r/actions/runs/${id}`,
  created_at: "2026-11-01T00:00:00Z",
  run_number: id,
  ...extra,
});

describe("currentRuns", () => {
  it("keeps the newest run per workflow on the default branch and on open pull request branches", () => {
    const runs = [
      run(5, "CI", "main"),
      run(4, "CI", "main"),
      run(3, "Release", "main"),
      run(2, "CI", "feature/open"),
      run(1, "CI", "feature/merged"),
    ];
    expect(currentRuns(runs, "main", new Set(["feature/open"])).map((r) => r.id)).toEqual([5, 3, 2]);
  });

  it("keeps nothing without a default branch or open branches", () => {
    expect(currentRuns([run(1, "CI", "main")], undefined, new Set())).toEqual([]);
  });
});

type Route = (url: string, init?: RequestInit) => Response;

async function withGitHub(route: Route, token = true) {
  const io = memoryIo({}, { fetch: async (input, init) => route(new Request(input, init).url, init) });
  const { svc, close } = await testServices(io);
  if (token) await svc.setSecret(SECRET_KEYS.github, "ghp_test");
  return { svc, close };
}

const notification = (id: string) => ({
  id,
  reason: "mention",
  unread: true,
  updated_at: "2026-11-01T00:00:00Z",
  subject: { title: `t${id}`, type: "Issue", url: null },
  repository: { full_name: "o/r", html_url: "https://github.com/o/r" },
});

describe("refreshInbox", () => {
  it("asks for a token instead of calling GitHub without one", async () => {
    const { svc, close } = await withGitHub(() => jsonResponse({}), false);
    const inbox = await refreshInbox(svc);
    close();
    expect(inbox).toMatchObject({ notifications: [], error: "Add a GitHub token in Settings to see your inbox." });
  });

  it("stores notifications, review requests and own pull requests", async () => {
    const { svc, close } = await withGitHub((url) =>
      url.endsWith("/graphql") ? jsonResponse({ data: { search: { nodes: [] } } }) : jsonResponse([notification("1")]),
    );
    await refreshInbox(svc);
    const inbox = await readInbox(svc);
    close();
    expect(inbox).toMatchObject({ notifications: [{ id: "1" }], reviewRequests: [], myPulls: [] });
    expect(inbox?.error).toBeUndefined();
  });

  it("records GitHub's error instead of throwing", async () => {
    const { svc, close } = await withGitHub(() => jsonResponse({ message: "Bad credentials" }, { status: 401 }));
    const inbox = await refreshInbox(svc);
    close();
    expect(inbox.error).toBe("GitHub 401: Bad credentials");
  });
});

describe("clearNotifications", () => {
  it("marks threads read on GitHub and drops only them from the stored inbox", async () => {
    const calls: string[] = [];
    const { svc, close } = await withGitHub((url, init) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      return url.endsWith("/graphql")
        ? jsonResponse({ data: { search: { nodes: [] } } })
        : jsonResponse([notification("1"), notification("2")]);
    });
    await refreshInbox(svc);
    await clearNotifications(svc, ["1"]);
    const afterOne = await readInbox(svc);
    await clearNotifications(svc, "all");
    const afterAll = await readInbox(svc);
    close();
    expect(afterOne?.notifications.map((n) => n.id)).toEqual(["2"]);
    expect(afterAll?.notifications).toEqual([]);
    expect(calls).toContain("PATCH https://api.github.com/notifications/threads/1");
    expect(calls).toContain("PUT https://api.github.com/notifications");
  });

  it("marks threads done with DELETE", async () => {
    const calls: string[] = [];
    const { svc, close } = await withGitHub((url, init) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      return jsonResponse({});
    });
    await clearNotifications(svc, ["7"], true);
    close();
    expect(calls).toEqual(["DELETE https://api.github.com/notifications/threads/7"]);
  });
});

describe("refreshCi", () => {
  it("records each repo's runs and keeps going when one repo fails", async () => {
    const { svc, close } = await withGitHub((url) => {
      if (url.includes("/repos/me/broken")) return jsonResponse({ message: "Not Found" }, { status: 404 });
      if (url.endsWith("/repos/me/app"))
        return jsonResponse({
          full_name: "me/app",
          default_branch: "main",
          stargazers_count: 0,
          open_issues_count: 0,
          html_url: "u",
        });
      if (url.includes("/pulls")) return jsonResponse([]);
      return jsonResponse({ workflow_runs: [run(1, "CI", "main"), run(2, "CI", "old")] });
    });
    await svc.store.addProject({ id: "a", name: "app", remote: "github.com/me/app", path: "/app" });
    await svc.store.addProject({ id: "b", name: "broken", remote: "github.com/me/broken", path: "/broken" });
    const snapshot = await refreshCi(svc);
    close();
    const byRepo = Object.fromEntries(snapshot.entries.map((e) => [e.repo, e]));
    expect(byRepo["me/app"]).toMatchObject({ defaultBranch: "main", runs: [{ id: 1 }] });
    expect(byRepo["me/broken"]).toMatchObject({ runs: [], error: "GitHub 404: Not Found" });
  });
});

describe("refreshBotPulls", () => {
  it("asks for a token without one, and searches the projects' repos with one", async () => {
    const queries: string[] = [];
    const { svc, close } = await withGitHub((_url, init) => {
      queries.push(String(JSON.parse(typeof init?.body === "string" ? init.body : "{}").variables.q));
      return jsonResponse({ data: { search: { nodes: [] } } });
    });
    await svc.store.addProject({ id: "a", name: "app", remote: "github.com/me/app", path: "/app" });
    expect(await refreshBotPulls(svc)).toMatchObject({ pulls: [] });
    close();
    expect(queries[0]).toContain("author:app/dependabot author:app/renovate repo:me/app");

    const noToken = await withGitHub(() => jsonResponse({}), false);
    expect((await refreshBotPulls(noToken.svc)).error).toContain("Add a GitHub token");
    noToken.close();
  });
});
