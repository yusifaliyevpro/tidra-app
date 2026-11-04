import { describe, expect, it, vi } from "vitest";
import { emptyConfig, parseNpmrc } from "@/engine/npmrc";
import { createRegistryClient, fetchWithRetry, type CachedResponse } from "@/engine/registry";
import { headersOf, jsonResponse, packument } from "../support/memory-io";

const noSleep = { sleep: () => Promise.resolve(), baseDelayMs: 1 };
const react = packument("react", { "19.3.1": {} }, { latest: "19.3.1" });

describe("fetchWithRetry", () => {
  it("retries 5xx and 429 then returns the success", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(new Response("", { status: 429, headers: { "retry-after": "0" } }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const response = await fetchWithRetry(fetcher, "https://x.dev", {}, noSleep);
    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("does not retry a 404", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("", { status: 404 }));
    expect((await fetchWithRetry(fetcher, "https://x.dev", {}, noSleep)).status).toBe(404);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("gives up after the last attempt on network errors", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("offline"));
    await expect(fetchWithRetry(fetcher, "https://x.dev", {}, { ...noSleep, attempts: 3 })).rejects.toThrow("offline");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("leaves no timers behind", async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("offline"));
      await expect(fetchWithRetry(fetcher, "https://x.dev", {}, noSleep)).rejects.toThrow("offline");
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("createRegistryClient", () => {
  it("asks for abbreviated metadata on the packument route only", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => jsonResponse(react));
    const client = createRegistryClient({ io: { fetch: fetcher }, npm: emptyConfig(), retry: noSleep });
    await client.abbreviated("react");
    await client.full("react");
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://registry.npmjs.org/react");
    expect(headersOf(fetcher.mock.calls[0]).get("accept")).toContain("application/vnd.npm.install-v1+json");
    expect(headersOf(fetcher.mock.calls[1]).get("accept")).toBe("application/json");
  });

  it("dedupes concurrent requests for the same package", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => jsonResponse(react));
    const client = createRegistryClient({ io: { fetch: fetcher }, npm: emptyConfig() });
    await Promise.all([client.abbreviated("react"), client.abbreviated("react")]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("returns null for packages that do not exist", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("", { status: 404 }));
    const client = createRegistryClient({ io: { fetch: fetcher }, npm: emptyConfig() });
    expect(await client.abbreviated("nope")).toBeNull();
  });

  it("sends scoped-registry credentials", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(packument("@acme/ui", { "1.0.0": {} }, { latest: "1.0.0" })));
    const npm = parseNpmrc("@acme:registry=https://npm.acme.dev/\n//npm.acme.dev/:_authToken=t", {});
    await createRegistryClient({ io: { fetch: fetcher }, npm }).abbreviated("@acme/ui");
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://npm.acme.dev/@acme%2fui");
    expect(headersOf(fetcher.mock.calls[0]).get("authorization")).toBe("Bearer t");
  });

  it("revalidates with ETags and reuses the cached body on 304", async () => {
    const store = new Map<string, CachedResponse>();
    const cache = {
      get: async (k: string) => store.get(k),
      set: async (k: string, v: CachedResponse) => void store.set(k, v),
    };
    const first = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(react, { headers: { etag: '"v1"' } }));
    await createRegistryClient({ io: { fetch: first }, npm: emptyConfig(), cache }).abbreviated("react");

    const second = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 304 }));
    const result = await createRegistryClient({ io: { fetch: second }, npm: emptyConfig(), cache }).abbreviated(
      "react",
    );
    expect(headersOf(second.mock.calls[0]).get("if-none-match")).toBe('"v1"');
    expect(result?.["dist-tags"].latest).toBe("19.3.1");
  });

  it("rejects documents that are not packuments", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ error: "nope" }));
    await expect(createRegistryClient({ io: { fetch: fetcher }, npm: emptyConfig() }).abbreviated("x")).rejects.toThrow(
      "unexpected registry response",
    );
  });
});

describe("createRegistryClient caching", () => {
  it("keeps only the fields Tidra reads, so huge documents stay small in the cache", async () => {
    const store = new Map<string, CachedResponse>();
    const cache = {
      get: async (k: string) => store.get(k),
      set: async (k: string, v: CachedResponse) => void store.set(k, v),
    };
    const doc = {
      name: "react",
      readme: "x".repeat(10_000),
      "dist-tags": { latest: "19.3.1" },
      versions: {
        "19.3.1": {
          version: "19.3.1",
          peerDependencies: { scheduler: "^1" },
          dist: { tarball: "https://x", integrity: "sha512" },
        },
      },
    };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(doc, { headers: { etag: '"v1"' } }));
    await createRegistryClient({ io: { fetch: fetcher }, npm: emptyConfig(), cache }).abbreviated("react");
    const body = store.get("abbr:react")?.body ?? "";
    expect(body).not.toContain("tarball");
    expect(body).not.toContain("readme");
    expect(JSON.parse(body).versions["19.3.1"].peerDependencies).toEqual({ scheduler: "^1" });
  });

  it("asks again once an earlier answer expired, so new releases show up", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => jsonResponse(react));
    const client = createRegistryClient({ io: { fetch: fetcher }, npm: emptyConfig() });
    await client.abbreviated("react");
    await client.abbreviated("react");
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    await client.abbreviated("react");
    expect(fetcher).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("reads dist-tags from their own small endpoint, and gives up quietly where it is missing", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ latest: "19.3.1", canary: "19.4.0-canary.1" }))
      .mockResolvedValueOnce(new Response("", { status: 404 }));
    const client = createRegistryClient({ io: { fetch: fetcher }, npm: emptyConfig(), retry: noSleep });
    expect(await client.distTags("@scope/react")).toEqual({ latest: "19.3.1", canary: "19.4.0-canary.1" });
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://registry.npmjs.org/-/package/@scope%2freact/dist-tags");
    expect(await client.distTags("private")).toBeUndefined();
  });

  it("downloads package documents through the native trimming fetch when there is one", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const fetchPackument = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => jsonResponse(react));
    const client = createRegistryClient({ io: { fetch, fetchPackument }, npm: emptyConfig() });
    expect((await client.abbreviated("react"))?.name).toBe("react");
    expect(fetch).not.toHaveBeenCalled();
  });
});
