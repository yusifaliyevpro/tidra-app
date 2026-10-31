import * as z from "@zod/mini";
import type { Io } from "./io";
import { createLimit } from "./limit";
import { authHeaderFor, packumentUrl, type NpmConfig } from "./npmrc";

const Repository = z.union([
  z.string(),
  z.looseObject({ url: z.optional(z.string()), directory: z.optional(z.string()) }),
]);

const VersionMeta = z.looseObject({
  deprecated: z.optional(z.union([z.string(), z.boolean()])),
  engines: z.optional(z.unknown()),
  peerDependencies: z.optional(z.record(z.string(), z.string())),
  repository: z.optional(Repository),
});

const PackumentSchema = z.compile(
  z.looseObject({
    name: z.string(),
    "dist-tags": z.record(z.string(), z.string()),
    versions: z.record(z.string(), VersionMeta),
    time: z.optional(z.record(z.string(), z.string())),
    repository: z.optional(Repository),
  }),
);

export type Packument = z.infer<typeof PackumentSchema>;
export type VersionInfo = z.infer<typeof VersionMeta>;

export interface CachedResponse {
  etag?: string;
  body: string;
}

/** Persistence for conditional requests; the app backs this with SQLite, tests with a Map. */
export interface HttpCache {
  get(key: string): Promise<CachedResponse | undefined>;
  set(key: string, value: CachedResponse): Promise<void>;
}

export class RegistryError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "RegistryError";
  }
}

export interface FetchRetryOptions {
  attempts?: number;
  timeoutMs?: number;
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);
const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** fetch with a per-attempt timeout and exponential backoff on network errors, 429 and 5xx. */
export async function fetchWithRetry(
  fetcher: typeof globalThis.fetch,
  url: string,
  init: RequestInit,
  { attempts = 3, timeoutMs = 15_000, baseDelayMs = 300, sleep = defaultSleep }: FetchRetryOptions = {},
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(url, { ...init, signal: controller.signal });
      if (!RETRYABLE.has(response.status) || attempt === attempts - 1) return response;
      const retryAfter = Number(response.headers.get("retry-after"));
      lastError = new RegistryError(`HTTP ${response.status}`, response.status);
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoff(baseDelayMs, attempt));
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) await sleep(backoff(baseDelayMs, attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new RegistryError(String(lastError));
}

function backoff(base: number, attempt: number): number {
  return base * 2 ** attempt + Math.floor(Math.random() * base);
}

export interface RegistryClient {
  /** Abbreviated metadata: versions, dist-tags, deprecation, engines and peers. Null when the package does not exist. */
  abbreviated(name: string): Promise<Packument | null>;
  /** Full metadata, adding publish times and repository links. */
  full(name: string): Promise<Packument | null>;
}

export function createRegistryClient(options: {
  io: Pick<Io, "fetch">;
  npm: NpmConfig;
  cache?: HttpCache;
  concurrency?: number;
  retry?: FetchRetryOptions;
}): RegistryClient {
  const limit = createLimit(options.concurrency ?? 8);
  const inflight = new Map<string, Promise<Packument | null>>();

  const load = (name: string, full: boolean): Promise<Packument | null> => {
    const key = `${full ? "full" : "abbr"}:${name}`;
    const existing = inflight.get(key);
    if (existing) return existing;
    const promise = limit(() => request(name, full, key));
    inflight.set(key, promise);
    return promise;
  };

  const request = async (name: string, full: boolean, key: string): Promise<Packument | null> => {
    const url = packumentUrl(options.npm, name);
    const headers: Record<string, string> = {
      // The abbreviated document is only valid on the packument route; never send it to `/latest`.
      accept: full ? "application/json" : "application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8",
    };
    const auth = authHeaderFor(options.npm, url);
    if (auth) headers.authorization = auth;
    const cached = await options.cache?.get(key);
    if (cached?.etag) headers["if-none-match"] = cached.etag;

    const response = await fetchWithRetry(options.io.fetch, url, { headers }, options.retry);
    let body: string;
    if (response.status === 304 && cached) body = cached.body;
    else if (response.status === 404) return null;
    else if (!response.ok) throw new RegistryError(`${name}: HTTP ${response.status}`, response.status);
    else {
      body = await response.text();
      const etag = response.headers.get("etag");
      if (etag) await options.cache?.set(key, { etag, body });
    }
    const data: unknown = JSON.parse(body);
    if (!z.validate(PackumentSchema, data)) throw new RegistryError(`${name}: unexpected registry response`);
    return data;
  };

  return {
    abbreviated: (name) => load(name, false),
    full: (name) => load(name, true),
  };
}
