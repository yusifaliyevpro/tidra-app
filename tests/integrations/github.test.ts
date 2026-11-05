import { describe, expect, it } from "vitest";
import type { CachedResponse } from "@/engine/registry";
import {
  checkState,
  createGitHub,
  failingSection,
  GitHubError,
  runFailed,
  type PullRequest,
} from "@/integrations/github";

describe("rateLimit", () => {
  it("reads the REST budget from the body of /rate_limit", async () => {
    const urls: string[] = [];
    const github = createGitHub({
      token: "t",
      fetch: async (input) => {
        urls.push(new Request(input).url);
        return Response.json(
          {
            resources: {
              core: { limit: 5000, used: 61, remaining: 4939, reset: 1_793_000_000 },
              graphql: { limit: 5000, used: 0, remaining: 5000, reset: 1_793_000_500 },
            },
          },
          { headers: { "x-ratelimit-resource": "core", "x-ratelimit-remaining": "4900" } },
        );
      },
    });
    expect(await github.rateLimit()).toEqual({ limit: 5000, remaining: 4939 });
    expect(urls).toEqual(["https://api.github.com/rate_limit"]);
  });
});

type Call = { url: string; method: string; headers: Headers; body: string | null };

function fakeGitHub(respond: (call: Call) => Response, token: string | null = "t") {
  const calls: Call[] = [];
  const store = new Map<string, CachedResponse>();
  const cache = {
    get: async (key: string) => store.get(key),
    set: async (key: string, value: CachedResponse) => void store.set(key, value),
  };
  const github = createGitHub({
    token: token ?? undefined,
    cache,
    fetch: async (input, init) => {
      const request = new Request(input, init);
      const call = {
        url: request.url,
        method: request.method,
        headers: request.headers,
        body: (await request.text()) || null,
      };
      calls.push(call);
      return respond(call);
    },
  });
  return { github, calls, store };
}

describe("GitHub requests", () => {
  it("sends the token, the API version and JSON accept headers", async () => {
    const { github, calls } = fakeGitHub(() =>
      Response.json({
        full_name: "o/r",
        default_branch: "main",
        stargazers_count: 1,
        open_issues_count: 0,
        html_url: "u",
      }),
    );
    await github.repo("o", "r");
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer t");
    expect(calls[0]?.headers.get("x-github-api-version")).toBe("2022-11-28");
    expect(calls[0]?.headers.get("accept")).toBe("application/vnd.github+json");
  });

  it("sends no authorization without a token", async () => {
    const { github, calls } = fakeGitHub(() => Response.json([]), null);
    expect(github.hasToken).toBe(false);
    await github.releases("o", "r");
    expect(calls[0]?.headers.has("authorization")).toBe(false);
  });

  it("revalidates GETs with the cached ETag and reuses the body on 304", async () => {
    let round = 0;
    const { github, calls } = fakeGitHub(() =>
      round++ === 0 ? Response.json([], { headers: { etag: '"e1"' } }) : new Response(null, { status: 304 }),
    );
    await github.releases("o", "r");
    expect(await github.releases("o", "r")).toEqual([]);
    expect(calls[1]?.headers.get("if-none-match")).toBe('"e1"');
  });

  it("explains failures with GitHub's own message", async () => {
    const { github } = fakeGitHub(() => Response.json({ message: "Bad credentials" }, { status: 401 }));
    await expect(github.repo("o", "r")).rejects.toThrow("GitHub 401: Bad credentials");
  });

  it("marks an exhausted rate limit and says how to raise it", async () => {
    const { github } = fakeGitHub(() => new Response("{}", { status: 403, headers: { "x-ratelimit-remaining": "0" } }));
    const error = await github.repo("o", "r").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GitHubError);
    expect(error).toMatchObject({ status: 403, rateLimited: true, message: expect.stringContaining("rate limit") });
  });

  it("rejects answers that don't have the expected shape", async () => {
    const { github } = fakeGitHub(() => Response.json({ unexpected: true }));
    await expect(github.repo("o", "r")).rejects.toThrow("Unexpected response from /repos/o/r");
  });
});

describe("GitHub endpoints", () => {
  it("maps releases, using the tag when there is no name", async () => {
    const { github } = fakeGitHub(() =>
      Response.json([
        {
          tag_name: "v1.0.0",
          name: null,
          body: null,
          draft: false,
          prerelease: false,
          published_at: null,
          html_url: "u",
        },
      ]),
    );
    expect(await github.releases("o", "r")).toEqual([
      { tag: "v1.0.0", name: "v1.0.0", body: "", draft: false, prerelease: false, publishedAt: undefined, url: "u" },
    ]);
  });

  it("returns no latest release for repos without releases", async () => {
    const { github } = fakeGitHub(() => Response.json({ message: "Not Found" }, { status: 404 }));
    expect(await github.latestRelease("o", "r")).toBeUndefined();
  });

  it("resolves the latest release's tag to its commit", async () => {
    const { github, calls } = fakeGitHub((call) =>
      call.url.endsWith("/releases/latest") ? Response.json({ tag_name: "v4.2.0" }) : Response.json({ sha: "abc" }),
    );
    expect(await github.latestRelease("o", "r")).toEqual({ tag: "v4.2.0", sha: "abc" });
    expect(calls[1]?.url).toBe("https://api.github.com/repos/o/r/commits/v4.2.0");
  });

  it("reads branch heads, or gives up past one page", async () => {
    const heads = [{ ref: "refs/heads/feature/x", object: { sha: "a" } }];
    expect(await fakeGitHub(() => Response.json(heads)).github.branchHeads("o/r")).toEqual(
      new Map([["feature/x", "a"]]),
    );
    const many = Array.from({ length: 100 }, (_, i) => ({ ref: `refs/heads/b${i}`, object: { sha: "s" } }));
    expect(await fakeGitHub(() => Response.json(many)).github.branchHeads("o/r")).toBeUndefined();
  });

  it("encodes the head of branch pull request lookups", async () => {
    const { github, calls } = fakeGitHub(() => Response.json([]));
    await github.pullsForBranch("o/r", "me:feature/a+b");
    expect(calls[0]?.url).toBe("https://api.github.com/repos/o/r/pulls?state=all&per_page=5&head=me%3Afeature%2Fa%2Bb");
  });

  it("posts new pull requests and patches existing ones", async () => {
    const { github, calls } = fakeGitHub(() => Response.json({ html_url: "https://github.com/o/r/pull/1" }));
    await github.createPull("o/r", { title: "t", head: "me:b", base: "main", body: "x" });
    await github.updatePull("o/r", 1, { body: "y" });
    expect(calls.map((c) => [c.method, c.url, JSON.parse(c.body ?? "{}")])).toEqual([
      ["POST", "https://api.github.com/repos/o/r/pulls", { title: "t", head: "me:b", base: "main", body: "x" }],
      ["PATCH", "https://api.github.com/repos/o/r/pulls/1", { body: "y" }],
    ]);
  });

  it("asks nothing when there are no repos to search bot pull requests in", async () => {
    const { github, calls } = fakeGitHub(() => Response.json({}));
    expect(await github.botPulls([])).toEqual([]);
    expect(calls).toEqual([]);
  });
});

describe("GitHub GraphQL", () => {
  it("needs a token", async () => {
    await expect(fakeGitHub(() => Response.json({}), null).github.myPulls()).rejects.toThrow("token is required");
  });

  it("raises GraphQL errors that came without data", async () => {
    const { github } = fakeGitHub(() => Response.json({ errors: [{ message: "Something broke" }] }));
    await expect(github.myPulls()).rejects.toThrow("Something broke");
  });

  it("keeps pull requests and drops other search hits", async () => {
    const pull = {
      number: 1,
      title: "t",
      url: "u",
      isDraft: false,
      updatedAt: "2026-11-01T00:00:00Z",
      repository: { nameWithOwner: "o/r" },
      author: { login: "me" },
      commits: { nodes: [{ commit: { statusCheckRollup: { state: "FAILURE" } } }] },
    };
    const { github } = fakeGitHub(() => Response.json({ data: { search: { nodes: [pull, {}] } } }));
    const pulls = await github.reviewRequests();
    expect(pulls.map((p) => p.number)).toEqual([1]);
    expect(pulls[0] && checkState(pulls[0])).toBe("failure");
  });
});

const withState = (state?: string): PullRequest => ({
  number: 1,
  title: "t",
  url: "u",
  isDraft: false,
  updatedAt: "2026-11-01T00:00:00Z",
  repository: { nameWithOwner: "o/r" },
  commits: { nodes: state ? [{ commit: { statusCheckRollup: { state } } }] : [] },
});

it.for([
  ["SUCCESS", "success"],
  ["FAILURE", "failure"],
  ["ERROR", "failure"],
  ["PENDING", "pending"],
  ["EXPECTED", "pending"],
  [undefined, "none"],
])("maps %s to %s", ([state, expected]) => {
  expect(checkState(withState(state))).toBe(expected);
});

describe("failingSection", () => {
  it("keeps the failing step's group, without timestamps", () => {
    const log = [
      "2026-11-01T00:00:00.0000000Z ##[group]Install",
      "2026-11-01T00:00:01.0000000Z ok",
      "2026-11-01T00:00:02.0000000Z ##[endgroup]",
      "2026-11-01T00:00:03.0000000Z ##[group]Test",
      "2026-11-01T00:00:04.0000000Z FAIL a.test.ts",
      "2026-11-01T00:00:05.0000000Z ##[error]Process completed with exit code 1.",
    ].join("\n");
    expect(failingSection(log)).toBe("##[group]Test\nFAIL a.test.ts\n##[error]Process completed with exit code 1.");
  });

  it("returns the end of the log when nothing is marked as an error", () => {
    expect(failingSection("a\nb\nc", 2)).toBe("b\nc");
  });

  it("always includes the error line", () => {
    const log = ["##[group]Build", ...Array.from({ length: 500 }, (_, i) => `line ${i}`), "##[error]Build failed"].join(
      "\n",
    );
    expect(failingSection(log)).toContain("##[error]Build failed");
  });
});

describe("runFailed", () => {
  it.for([
    ["failure", true],
    ["timed_out", true],
    ["startup_failure", true],
    ["success", false],
    ["cancelled", false],
    ["skipped", false],
    [null, false],
  ] as const)("%s → %s", ([conclusion, failed]) => {
    expect(runFailed({ conclusion })).toBe(failed);
  });
});

describe("releases paging", () => {
  it("asks for later pages only past the first", async () => {
    const { github, calls } = fakeGitHub(() => Response.json([]));
    await github.releases("o", "r");
    await github.releases("o", "r", 2);
    expect(calls.map((c) => c.url)).toEqual([
      "https://api.github.com/repos/o/r/releases?per_page=50",
      "https://api.github.com/repos/o/r/releases?per_page=50&page=2",
    ]);
  });
});
