import * as z from "@zod/mini";
import type { Release } from "@/engine/changelog";
import { fetchWithRetry } from "@/engine/registry";

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly rateLimited = false,
  ) {
    super(message);
    this.name = "GitHubError";
  }
}

const ReleaseSchema = z.looseObject({
  tag_name: z.string(),
  name: z.nullish(z.string()),
  body: z.nullish(z.string()),
  draft: z.boolean(),
  prerelease: z.boolean(),
  published_at: z.nullish(z.string()),
  html_url: z.string(),
});
const Releases = z.compile(z.array(ReleaseSchema));

const NotificationSchema = z.looseObject({
  id: z.string(),
  reason: z.string(),
  unread: z.boolean(),
  updated_at: z.string(),
  subject: z.looseObject({ title: z.string(), type: z.string(), url: z.nullish(z.string()) }),
  repository: z.looseObject({ full_name: z.string(), html_url: z.string() }),
});
const Notifications = z.compile(z.array(NotificationSchema));
export type GitHubNotification = z.infer<typeof NotificationSchema>;

const RunSchema = z.looseObject({
  id: z.number(),
  name: z.nullish(z.string()),
  display_title: z.nullish(z.string()),
  status: z.nullish(z.string()),
  conclusion: z.nullish(z.string()),
  head_branch: z.nullish(z.string()),
  event: z.string(),
  html_url: z.string(),
  created_at: z.string(),
  run_number: z.number(),
});
const Runs = z.compile(z.looseObject({ workflow_runs: z.array(RunSchema) }));
export type WorkflowRun = z.infer<typeof RunSchema>;

const JobSchema = z.looseObject({
  id: z.number(),
  name: z.string(),
  conclusion: z.nullish(z.string()),
  steps: z.optional(
    z.array(z.looseObject({ name: z.string(), conclusion: z.nullish(z.string()), number: z.number() })),
  ),
});
const Jobs = z.compile(z.looseObject({ jobs: z.array(JobSchema) }));
export type WorkflowJob = z.infer<typeof JobSchema>;

const RepoSchema = z.compile(
  z.looseObject({
    full_name: z.string(),
    default_branch: z.string(),
    stargazers_count: z.number(),
    open_issues_count: z.number(),
    html_url: z.string(),
  }),
);
export type RepoInfo = z.infer<typeof RepoSchema>;

const PullSchema = z.looseObject({
  number: z.number(),
  title: z.string(),
  url: z.string(),
  isDraft: z.boolean(),
  updatedAt: z.string(),
  repository: z.looseObject({ nameWithOwner: z.string() }),
  author: z.nullish(z.looseObject({ login: z.string() })),
  mergeable: z.optional(z.string()),
  commits: z.optional(
    z.looseObject({
      nodes: z.array(
        z.looseObject({
          commit: z.looseObject({ statusCheckRollup: z.nullish(z.looseObject({ state: z.string() })) }),
        }),
      ),
    }),
  ),
});
export type PullRequest = z.infer<typeof PullSchema>;

const GraphQlBody = z.compile(
  z.looseObject({
    data: z.nullish(z.record(z.string(), z.unknown())),
    errors: z.optional(z.array(z.looseObject({ message: z.string() }))),
  }),
);
const TagName = z.compile(z.looseObject({ tag_name: z.string() }));
const CommitSha = z.compile(z.looseObject({ sha: z.string() }));
const CreatedPull = z.compile(z.looseObject({ html_url: z.string() }));
const PullSearch = z.compile(z.looseObject({ nodes: z.array(z.union([PullSchema, z.looseObject({})])) }));

export type CheckState = "success" | "failure" | "pending" | "none";

export function checkState(pull: PullRequest): CheckState {
  const state = pull.commits?.nodes[0]?.commit.statusCheckRollup?.state;
  if (!state) return "none";
  if (state === "SUCCESS") return "success";
  if (state === "FAILURE" || state === "ERROR") return "failure";
  return "pending";
}

export function toRelease(raw: z.infer<typeof ReleaseSchema>): Release {
  return {
    tag: raw.tag_name,
    name: raw.name ?? raw.tag_name,
    body: raw.body ?? "",
    draft: raw.draft,
    prerelease: raw.prerelease,
    publishedAt: raw.published_at ?? undefined,
    url: raw.html_url,
  };
}

const PULL_FIELDS = `... on PullRequest {
  number title url isDraft updatedAt mergeable
  repository { nameWithOwner }
  author { login }
  commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
}`;

export function createGitHub(options: { fetch: typeof globalThis.fetch; token?: string }) {
  const API = "https://api.github.com";
  const headers = (extra: HeadersInit | undefined) => {
    const merged = new Headers(extra);
    merged.set("accept", "application/vnd.github+json");
    merged.set("x-github-api-version", "2022-11-28");
    if (options.token) merged.set("authorization", `Bearer ${options.token}`);
    return merged;
  };

  async function request(path: string, init: RequestInit = {}): Promise<Response> {
    const response = await fetchWithRetry(options.fetch, path.startsWith("http") ? path : `${API}${path}`, {
      ...init,
      headers: headers(init.headers),
    });
    if (!response.ok) {
      const limited = response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0";
      const text = await response.text().catch(() => "");
      const message = limited
        ? "GitHub rate limit reached. Add a token in Settings to raise it."
        : `GitHub ${response.status}: ${/"message":"([^"]+)"/.exec(text)?.[1] ?? response.statusText}`;
      throw new GitHubError(message, response.status, limited);
    }
    return response;
  }

  async function json<S extends z.ZodMiniType>(path: string, schema: S, init?: RequestInit): Promise<z.input<S>> {
    const data: unknown = await (await request(path, init)).json();
    if (!z.validate(schema, data)) throw new GitHubError(`Unexpected response from ${path}`, 200);
    return data;
  }

  async function graphql(query: string, variables: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    if (!options.token) throw new GitHubError("A GitHub token is required for this view.", 401);
    const body = await json("/graphql", GraphQlBody, { method: "POST", body: JSON.stringify({ query, variables }) });
    if (body.errors?.length && !body.data) throw new GitHubError(body.errors[0]?.message ?? "GraphQL error", 200);
    return body.data ?? {};
  }

  async function searchPulls(query: string, first = 50): Promise<PullRequest[]> {
    const data = await graphql(
      `query($q: String!, $first: Int!) { search(query: $q, type: ISSUE, first: $first) { nodes { ${PULL_FIELDS} } } }`,
      { q: query, first },
    );
    const search = data.search;
    if (!z.validate(PullSearch, search)) return [];
    return search.nodes.filter((node): node is PullRequest => "number" in node);
  }

  return {
    hasToken: Boolean(options.token),
    request,
    graphql,

    releases: async (owner: string, repo: string) =>
      (await json(`/repos/${owner}/${repo}/releases?per_page=50`, Releases)).map(toRelease),

    /** Latest release tag and the commit it points at, for SHA-pinned workflow actions. */
    async latestRelease(owner: string, repo: string): Promise<{ tag: string; sha?: string } | undefined> {
      const release = await json(`/repos/${owner}/${repo}/releases/latest`, TagName).catch((error: unknown) => {
        if (error instanceof GitHubError && error.status === 404) return undefined;
        throw error;
      });
      if (!release) return undefined;
      const commit = await json(`/repos/${owner}/${repo}/commits/${encodeURIComponent(release.tag_name)}`, CommitSha);
      return { tag: release.tag_name, sha: commit.sha };
    },

    repo: (owner: string, repo: string) => json(`/repos/${owner}/${repo}`, RepoSchema),

    notifications: () => json("/notifications?per_page=50", Notifications),
    markNotificationRead: (id: string) => request(`/notifications/threads/${id}`, { method: "PATCH" }),

    reviewRequests: () => searchPulls("is:pr is:open archived:false review-requested:@me"),
    myPulls: () => searchPulls("is:pr is:open archived:false author:@me"),
    botPulls: (repos: string[]) =>
      repos.length === 0
        ? Promise.resolve([])
        : searchPulls(
            `is:pr is:open archived:false author:app/dependabot author:app/renovate ${repos.map((r) => `repo:${r}`).join(" ")}`,
            100,
          ),
    mergePull: (repo: string, number: number, method: "squash" | "merge" | "rebase") =>
      request(`/repos/${repo}/pulls/${number}/merge`, {
        method: "PUT",
        body: JSON.stringify({ merge_method: method }),
      }),
    createPull: (repo: string, input: { title: string; head: string; base: string; body: string }) =>
      json(`/repos/${repo}/pulls`, CreatedPull, { method: "POST", body: JSON.stringify(input) }),

    workflowRuns: async (repo: string, branch?: string) =>
      (
        await json(
          `/repos/${repo}/actions/runs?per_page=10${branch ? `&branch=${encodeURIComponent(branch)}` : ""}`,
          Runs,
        )
      ).workflow_runs,
    runJobs: async (repo: string, runId: number) =>
      (await json(`/repos/${repo}/actions/runs/${runId}/jobs`, Jobs)).jobs,
    jobLog: async (repo: string, jobId: number) => (await request(`/repos/${repo}/actions/jobs/${jobId}/logs`)).text(),
    rerunFailed: (repo: string, runId: number) =>
      request(`/repos/${repo}/actions/runs/${runId}/rerun-failed-jobs`, { method: "POST" }),
  };
}

export type GitHub = ReturnType<typeof createGitHub>;

/** Keeps only the failing step's section of a job log, which is what you actually read. */
export function failingSection(log: string, maxLines = 400): string {
  const lines = log.split(/\r?\n/).map((line) => line.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z /, ""));
  const errorIndex = lines.findIndex((line) => line.startsWith("##[error]"));
  if (errorIndex < 0) return lines.slice(-maxLines).join("\n");
  let start = errorIndex;
  while (start > 0 && !lines[start]?.startsWith("##[group]")) start--;
  return lines.slice(start, Math.min(lines.length, start + maxLines)).join("\n");
}
