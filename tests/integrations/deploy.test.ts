import { describe, expect, it } from "vitest";
import { SECRET_KEYS } from "@/core/secrets";
import { cloudflare, DEPLOY_PROVIDERS, netlify, vercel } from "@/integrations/deploy";

type Route = (url: string, headers: Headers) => Response;

function fetcher(route: Route) {
  const urls: string[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    urls.push(request.url);
    return route(request.url, request.headers);
  };
  return { fetch, urls };
}

const noRetry = (status: number) => new Response("{}", { status });

describe("deploy providers", () => {
  it("each need their secrets and ask nothing without them", async () => {
    const { fetch, urls } = fetcher(() => Response.json({}));
    for (const provider of DEPLOY_PROVIDERS) expect(await provider.latest(fetch, {})).toEqual([]);
    expect(await cloudflare.latest(fetch, { [SECRET_KEYS.cloudflare]: "t" })).toEqual([]);
    expect(urls).toEqual([]);
  });
});

const deployment = (uid: string, name: string, extra: object = {}) => ({
  uid,
  name,
  url: `${name}-${uid}.vercel.app`,
  readyState: "READY",
  created: 1_793_000_000_000,
  ...extra,
});

describe("vercel", () => {
  it("keeps the newest deployment per project and reads the GitHub source", async () => {
    const { fetch } = fetcher((_url, headers) => {
      expect(headers.get("authorization")).toBe("Bearer vt");
      return Response.json({
        deployments: [
          deployment("d2", "web", {
            state: "BUILDING",
            meta: { githubOrg: "Me", githubRepo: "Web", githubCommitRef: "main", githubCommitMessage: "fix" },
          }),
          deployment("d1", "web"),
          deployment("d3", "docs", { readyState: "ERROR" }),
        ],
      });
    });
    expect(await vercel.latest(fetch, { [SECRET_KEYS.vercel]: "vt" })).toEqual([
      {
        provider: "vercel",
        id: "d2",
        project: "web",
        state: "building",
        url: "https://web-d2.vercel.app",
        branch: "main",
        message: "fix",
        createdAt: new Date(1_793_000_000_000).toISOString(),
        remote: "github.com/me/web",
      },
      expect.objectContaining({ id: "d3", project: "docs", state: "error", remote: undefined }),
    ]);
  });

  it("treats unknown states as queued and missing URLs as none", async () => {
    const { fetch } = fetcher(() =>
      Response.json({ deployments: [deployment("d", "x", { readyState: "WEIRD", url: null })] }),
    );
    expect(await vercel.latest(fetch, { [SECRET_KEYS.vercel]: "t" })).toMatchObject([
      { state: "queued", url: undefined },
    ]);
  });

  it("names the host when the API refuses", async () => {
    const { fetch } = fetcher(() => noRetry(401));
    await expect(vercel.latest(fetch, { [SECRET_KEYS.vercel]: "t" })).rejects.toThrow("api.vercel.com returned 401");
  });

  it("returns nothing for an unexpected answer", async () => {
    const { fetch } = fetcher(() => Response.json({ nope: true }));
    expect(await vercel.latest(fetch, { [SECRET_KEYS.vercel]: "t" })).toEqual([]);
  });
});

const site = (id: string, repo?: string) => ({
  id,
  name: `site-${id}`,
  ssl_url: `https://${id}.netlify.app`,
  build_settings: { repo_url: repo ?? null },
});

describe("netlify", () => {
  it("reads each site's latest deploy and maps its state and repo", async () => {
    const { fetch } = fetcher((url) =>
      url.includes("/sites?")
        ? Response.json([site("a", "https://github.com/Me/A"), site("b")])
        : url.includes("/sites/a/")
          ? Response.json([
              { id: "da", state: "processing", created_at: "2026-11-01T00:00:00Z", branch: "main", title: "t" },
            ])
          : Response.json([]),
    );
    expect(await netlify.latest(fetch, { [SECRET_KEYS.netlify]: "nt" })).toEqual([
      {
        provider: "netlify",
        id: "da",
        project: "site-a",
        state: "building",
        url: "https://a.netlify.app",
        branch: "main",
        message: "t",
        createdAt: "2026-11-01T00:00:00Z",
        remote: "github.com/me/a",
      },
    ]);
  });

  it("keeps the other sites when one site's deploys can't be read", async () => {
    const { fetch } = fetcher((url) =>
      url.includes("/sites?")
        ? Response.json([site("a"), site("b")])
        : url.includes("/sites/a/")
          ? noRetry(404)
          : Response.json([{ id: "db", state: "ready", created_at: "2026-11-01T00:00:00Z" }]),
    );
    expect((await netlify.latest(fetch, { [SECRET_KEYS.netlify]: "t" })).map((d) => d.project)).toEqual(["site-b"]);
  });
});

const project = (stage: { status: string; name: string } | undefined, extra: object = {}) => ({
  name: "pages",
  subdomain: "pages.pages.dev",
  source: { config: { owner: "Me", repo_name: "Pages" } },
  latest_deployment: {
    id: "c1",
    url: null,
    created_on: "2026-11-01T00:00:00Z",
    latest_stage: stage,
    deployment_trigger: { metadata: { branch: "main", commit_message: "ship" } },
  },
  ...extra,
});

describe("cloudflare", () => {
  it.for([
    [{ status: "success", name: "deploy" }, "ready"],
    [{ status: "success", name: "build" }, "building"],
    [{ status: "active", name: "build" }, "building"],
    [{ status: "idle", name: "queued" }, "queued"],
    [{ status: "failure", name: "build" }, "error"],
    [{ status: "canceled", name: "build" }, "canceled"],
    [undefined, "queued"],
  ] as const)("maps stage %j to %s", async ([stage, state]) => {
    const { fetch } = fetcher(() => Response.json({ result: [project(stage)] }));
    const [first] = await cloudflare.latest(fetch, {
      [SECRET_KEYS.cloudflare]: "t",
      [SECRET_KEYS.cloudflareAccount]: "acc",
    });
    expect(first?.state).toBe(state);
  });

  it("falls back to the project subdomain and reads the GitHub source", async () => {
    const { fetch, urls } = fetcher(() =>
      Response.json({
        result: [project({ status: "success", name: "deploy" }), { name: "empty", latest_deployment: null }],
      }),
    );
    expect(
      await cloudflare.latest(fetch, { [SECRET_KEYS.cloudflare]: "t", [SECRET_KEYS.cloudflareAccount]: "acc" }),
    ).toEqual([
      {
        provider: "cloudflare",
        id: "c1",
        project: "pages",
        state: "ready",
        url: "https://pages.pages.dev",
        branch: "main",
        message: "ship",
        createdAt: "2026-11-01T00:00:00Z",
        remote: "github.com/me/pages",
      },
    ]);
    expect(urls).toEqual(["https://api.cloudflare.com/client/v4/accounts/acc/pages/projects"]);
  });
});
