import * as z from "@zod/mini";
import { SECRET_KEYS, type SecretKey } from "@/core/secrets";
import { normalizeRemote } from "@/engine/git";
import { fetchWithRetry } from "@/engine/registry";

export type DeployState = "ready" | "building" | "queued" | "error" | "canceled";

export interface Deployment {
  provider: string;
  id: string;
  project: string;
  state: DeployState;
  url?: string;
  branch?: string;
  message?: string;
  createdAt: string;
  /** `github.com/owner/repo` when the provider knows the source repo, to match projects automatically. */
  remote?: string;
}

export interface DeployProvider {
  id: string;
  label: string;
  /** Secrets this provider needs, in the order the settings form asks for them. */
  /** `hint` is a few words shown under the label; `url` is where the user creates the value. */
  fields: { key: SecretKey; label: string; hint?: string; url?: string }[];
  /** Latest deployment per site or project. */
  latest(fetcher: typeof fetch, secrets: Partial<Record<SecretKey, string>>): Promise<Deployment[]>;
}

async function getJson(fetcher: typeof fetch, url: string, token: string): Promise<unknown> {
  const response = await fetchWithRetry(fetcher, url, { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`${new URL(url).hostname} returned ${response.status}`);
  return response.json();
}

const VercelSchema = z.compile(
  z.looseObject({
    deployments: z.array(
      z.looseObject({
        uid: z.string(),
        name: z.string(),
        url: z.nullish(z.string()),
        state: z.optional(z.string()),
        readyState: z.optional(z.string()),
        created: z.number(),
        meta: z.optional(z.record(z.string(), z.unknown())),
      }),
    ),
  }),
);

const VERCEL_STATES: Record<string, DeployState> = {
  READY: "ready",
  BUILDING: "building",
  INITIALIZING: "building",
  QUEUED: "queued",
  ERROR: "error",
  CANCELED: "canceled",
};

export const vercel: DeployProvider = {
  id: "vercel",
  label: "Vercel",
  fields: [{ key: SECRET_KEYS.vercel, label: "Access token", url: "https://vercel.com/account/tokens" }],
  async latest(fetcher, secrets) {
    const token = secrets[SECRET_KEYS.vercel];
    if (!token) return [];
    const data = await getJson(fetcher, "https://api.vercel.com/v6/deployments?limit=100", token);
    if (!z.validate(VercelSchema, data)) return [];
    const seen = new Set<string>();
    return data.deployments.flatMap((d) => {
      if (seen.has(d.name)) return [];
      seen.add(d.name);
      const meta = d.meta ?? {};
      const str = (key: string) => (typeof meta[key] === "string" ? meta[key] : undefined);
      const org = str("githubOrg") ?? str("githubCommitOrg");
      const repo = str("githubRepo") ?? str("githubCommitRepo");
      return [
        {
          provider: "vercel",
          id: d.uid,
          project: d.name,
          state: VERCEL_STATES[d.state ?? d.readyState ?? ""] ?? "queued",
          url: d.url ? `https://${d.url}` : undefined,
          branch: str("githubCommitRef"),
          message: str("githubCommitMessage"),
          createdAt: new Date(d.created).toISOString(),
          remote: org && repo ? `github.com/${org}/${repo}`.toLowerCase() : undefined,
        },
      ];
    });
  },
};

const NetlifySchema = z.compile(
  z.array(
    z.looseObject({
      id: z.string(),
      name: z.string(),
      ssl_url: z.nullish(z.string()),
      build_settings: z.optional(z.looseObject({ repo_url: z.nullish(z.string()) })),
    }),
  ),
);
const NetlifyDeploys = z.compile(
  z.array(
    z.looseObject({
      id: z.string(),
      state: z.string(),
      created_at: z.string(),
      deploy_ssl_url: z.nullish(z.string()),
      branch: z.nullish(z.string()),
      title: z.nullish(z.string()),
    }),
  ),
);

const NETLIFY_STATES: Record<string, DeployState> = {
  ready: "ready",
  error: "error",
  building: "building",
  processing: "building",
  uploading: "building",
  enqueued: "queued",
  new: "queued",
};

export const netlify: DeployProvider = {
  id: "netlify",
  label: "Netlify",
  fields: [
    {
      key: SECRET_KEYS.netlify,
      label: "Personal access token",
      url: "https://app.netlify.com/user/applications#personal-access-tokens",
    },
  ],
  async latest(fetcher, secrets) {
    const token = secrets[SECRET_KEYS.netlify];
    if (!token) return [];
    const sites = await getJson(fetcher, "https://api.netlify.com/api/v1/sites?per_page=100", token);
    if (!z.validate(NetlifySchema, sites)) return [];
    const results = await Promise.all(
      sites.map(async (site): Promise<Deployment | undefined> => {
        const deploys = await getJson(
          fetcher,
          `https://api.netlify.com/api/v1/sites/${site.id}/deploys?per_page=1`,
          token,
        );
        const latest = z.validate(NetlifyDeploys, deploys) ? deploys[0] : undefined;
        if (!latest) return undefined;
        const repo = site.build_settings?.repo_url;
        return {
          provider: "netlify",
          id: latest.id,
          project: site.name,
          state: NETLIFY_STATES[latest.state] ?? "queued",
          url: latest.deploy_ssl_url ?? site.ssl_url ?? undefined,
          branch: latest.branch ?? undefined,
          message: latest.title ?? undefined,
          createdAt: latest.created_at,
          remote: repo ? normalizeRemote(repo) : undefined,
        };
      }),
    );
    return results.filter((d): d is Deployment => d !== undefined);
  },
};

const CloudflareSchema = z.compile(
  z.looseObject({
    result: z.array(
      z.looseObject({
        name: z.string(),
        subdomain: z.nullish(z.string()),
        source: z.nullish(
          z.looseObject({
            config: z.optional(z.looseObject({ owner: z.optional(z.string()), repo_name: z.optional(z.string()) })),
          }),
        ),
        latest_deployment: z.nullish(
          z.looseObject({
            id: z.string(),
            url: z.nullish(z.string()),
            created_on: z.string(),
            latest_stage: z.optional(z.looseObject({ status: z.string(), name: z.string() })),
            deployment_trigger: z.optional(
              z.looseObject({
                metadata: z.optional(
                  z.looseObject({ branch: z.nullish(z.string()), commit_message: z.nullish(z.string()) }),
                ),
              }),
            ),
          }),
        ),
      }),
    ),
  }),
);

function cloudflareState(stage: { status: string; name: string } | undefined): DeployState {
  if (!stage) return "queued";
  if (stage.status === "failure") return "error";
  if (stage.status === "canceled") return "canceled";
  if (stage.status === "success" && stage.name === "deploy") return "ready";
  return stage.status === "idle" ? "queued" : "building";
}

export const cloudflare: DeployProvider = {
  id: "cloudflare",
  label: "Cloudflare Pages",
  fields: [
    { key: SECRET_KEYS.cloudflareAccount, label: "Account ID", hint: "In your dashboard URL" },
    {
      key: SECRET_KEYS.cloudflare,
      label: "API token",
      hint: "Cloudflare Pages: Read",
      url: "https://dash.cloudflare.com/profile/api-tokens",
    },
  ],
  async latest(fetcher, secrets) {
    const token = secrets[SECRET_KEYS.cloudflare];
    const account = secrets[SECRET_KEYS.cloudflareAccount];
    if (!token || !account) return [];
    const data = await getJson(
      fetcher,
      `https://api.cloudflare.com/client/v4/accounts/${account}/pages/projects`,
      token,
    );
    if (!z.validate(CloudflareSchema, data)) return [];
    return data.result.flatMap((project) => {
      const latest = project.latest_deployment;
      if (!latest) return [];
      const config = project.source?.config;
      const meta = latest.deployment_trigger?.metadata;
      return [
        {
          provider: "cloudflare",
          id: latest.id,
          project: project.name,
          state: cloudflareState(latest.latest_stage),
          url: latest.url ?? (project.subdomain ? `https://${project.subdomain}` : undefined),
          branch: meta?.branch ?? undefined,
          message: meta?.commit_message ?? undefined,
          createdAt: latest.created_on,
          remote:
            config?.owner && config.repo_name
              ? `github.com/${config.owner}/${config.repo_name}`.toLowerCase()
              : undefined,
        },
      ];
    });
  },
};

/** Registered providers; adding one is a new object here and nothing else. */
export const DEPLOY_PROVIDERS: DeployProvider[] = [vercel, netlify, cloudflare];
