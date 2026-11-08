import { describe, expect, it } from "vitest";
import { attribute, buildTimeline, changelogFor, readWatchedPackages, setPackageWatched } from "@/services/changelogs";
import { jsonResponse, memoryIo, packument } from "../support/memory-io";
import { testServices } from "../support/services";

const expo = {
  packages: new Map([
    ["expo-router", ["mobile"]],
    ["@expo/ui", ["mobile", "web"]],
  ]),
  watched: false,
};

describe("attribute", () => {
  it("keeps monorepo releases only for packages you use", () => {
    expect(attribute("expo-router@58.0.29", expo)).toEqual({ packageName: "expo-router", usedBy: ["mobile"] });
    expect(attribute("expo-template-tabs@58.0.31", expo)).toBeUndefined();
  });

  it("shows every release of a watched repo", () => {
    expect(attribute("expo-template-tabs@58.0.31", { ...expo, watched: true })).toEqual({
      packageName: "expo-template-tabs",
      usedBy: [],
    });
  });

  it("gives plain tags to every package from the repo", () => {
    expect(attribute("v5.0.0", expo)).toEqual({ packageName: undefined, usedBy: ["mobile", "web"] });
    const single = { packages: new Map([["vite", ["web"]]]), watched: false };
    expect(attribute("v8.0.0", single)).toEqual({ packageName: "vite", usedBy: ["web"] });
  });
});

const NOW = Date.now();
const daysAgo = (days: number) => new Date(NOW - days * 86_400_000).toISOString();

const ghRelease = (tag: string, extra: object = {}) => ({
  tag_name: tag,
  name: tag,
  body: `notes ${tag}`,
  draft: false,
  prerelease: false,
  published_at: daysAgo(1),
  html_url: `https://github.com/o/r/releases/tag/${tag}`,
  ...extra,
});

interface Routes {
  packument?: object | null;
  releases?: (url: string) => Response;
  raw?: (url: string) => Response;
}

async function changelogServices(routes: Routes) {
  const requests: string[] = [];
  const io = memoryIo(
    {},
    {
      fetch: async (input) => {
        const url = new Request(input).url;
        requests.push(url);
        if (url.startsWith("https://registry.npmjs.org/")) {
          return routes.packument === null ? new Response("", { status: 404 }) : jsonResponse(routes.packument ?? {});
        }
        if (url.startsWith("https://api.github.com/")) return routes.releases?.(url) ?? jsonResponse([]);
        return routes.raw?.(url) ?? new Response("", { status: 404 });
      },
    },
  );
  const { svc, close } = await testServices(io);
  return { svc, close, requests };
}

const pkgDoc = (name: string, repository = "git+https://github.com/o/r.git") => ({
  ...packument(name, { "1.0.0": {}, "1.1.0": {}, "2.0.0": {} }, { latest: "2.0.0" }),
  repository: { type: "git", url: repository },
});

describe("changelogFor", () => {
  it("uses GitHub releases between the installed and target versions", async () => {
    const { svc, close } = await changelogServices({
      packument: pkgDoc("a"),
      releases: () => jsonResponse([ghRelease("v2.0.0"), ghRelease("v1.1.0"), ghRelease("v1.0.0")]),
    });
    const result = await changelogFor(svc, "a", "1.0.0", "2.0.0");
    close();
    expect(result).toMatchObject({ source: "releases", rateLimited: false, repo: { owner: "o", repo: "r" } });
    expect(result.entries.map((e) => [e.version, e.breaking])).toEqual([
      ["1.1.0", false],
      ["2.0.0", true],
    ]);
  });

  it("falls back to CHANGELOG.md when the repo has no matching releases", async () => {
    const { svc, close, requests } = await changelogServices({
      packument: pkgDoc("a"),
      raw: (url) =>
        url.endsWith("/HEAD/CHANGELOG.md")
          ? new Response("## 2.0.0\n- big\n## 1.1.0\n- small\n## 1.0.0\n- first\n")
          : new Response("", { status: 404 }),
    });
    const result = await changelogFor(svc, "a", "1.0.0", "2.0.0");
    close();
    expect(result.source).toBe("changelog");
    expect(result.entries.map((e) => e.body)).toEqual(["- small", "- big"]);
    expect(requests).toContain("https://raw.githubusercontent.com/o/r/HEAD/CHANGELOG.md");
  });

  it("finds nothing for packages without a GitHub repository", async () => {
    const { svc, close } = await changelogServices({ packument: pkgDoc("a", "https://gitlab.com/o/r") });
    expect(await changelogFor(svc, "a", "1.0.0", "2.0.0")).toEqual({ entries: [], source: "none", rateLimited: false });
    close();
  });

  it("reports a GitHub rate limit while still trying the changelog file", async () => {
    const { svc, close } = await changelogServices({
      packument: pkgDoc("a"),
      releases: () => new Response("{}", { status: 403, headers: { "x-ratelimit-remaining": "0" } }),
    });
    const result = await changelogFor(svc, "a", "1.0.0", "2.0.0");
    close();
    expect(result).toMatchObject({ source: "none", rateLimited: true });
  });

  it("finds a release beyond the first page of GitHub releases", async () => {
    const canaries = Array.from({ length: 50 }, (_, i) => ghRelease(`v2.1.0-canary.${50 - i}`, { prerelease: true }));
    const { svc, close } = await changelogServices({
      packument: pkgDoc("a"),
      releases: (url) => (url.includes("page=2") ? jsonResponse([ghRelease("v2.0.0")]) : jsonResponse(canaries)),
    });
    const result = await changelogFor(svc, "a", "1.1.0", "2.0.0");
    close();
    expect(result.entries.map((e) => e.version)).toEqual(["2.0.0"]);
  });
});

describe("watched packages", () => {
  it("adds once, keeps the list sorted and removes", async () => {
    const { svc, close } = await testServices();
    await setPackageWatched(svc, "zod", true);
    await setPackageWatched(svc, "astro", true);
    await setPackageWatched(svc, "zod", true);
    expect(await readWatchedPackages(svc)).toEqual(["astro", "zod"]);
    await setPackageWatched(svc, "zod", false);
    expect(await readWatchedPackages(svc)).toEqual(["astro"]);
    close();
  });
});

describe("buildTimeline", () => {
  it("lists recent releases of watched repos and packages, newest first, flagging majors", async () => {
    const { svc, close } = await changelogServices({
      packument: pkgDoc("vite", "https://github.com/vitejs/vite"),
      releases: (url) =>
        url.includes("/repos/me/tool/")
          ? jsonResponse([
              ghRelease("v3.0.0", { published_at: daysAgo(2) }),
              ghRelease("v2.9.0", { published_at: daysAgo(90) }),
            ])
          : jsonResponse([
              ghRelease("v8.1.0", { published_at: daysAgo(1) }),
              ghRelease("v9.0.0-beta.1", { prerelease: true }),
              ghRelease("v8.0.9", { draft: true }),
            ]),
    });
    await svc.store.watchRepo("me", "tool");
    await setPackageWatched(svc, "vite", true);
    const timeline = await buildTimeline(svc, new Map([["vite", ["web", "docs"]]]));
    close();
    expect(timeline.errors).toEqual([]);
    expect(timeline.items.map((i) => [i.repo, i.tag, i.major, i.packageName, i.usedBy])).toEqual([
      ["vitejs/vite", "v8.1.0", false, "vite", ["web", "docs"]],
      ["me/tool", "v3.0.0", true, undefined, []],
    ]);
  });

  it("collects errors per repo and stops asking GitHub once rate limited", async () => {
    const { svc, close, requests } = await changelogServices({
      releases: () => new Response("{}", { status: 403, headers: { "x-ratelimit-remaining": "0" } }),
    });
    for (const repo of ["one", "two", "three", "four", "five", "six"]) await svc.store.watchRepo("a", repo);
    const timeline = await buildTimeline(svc, new Map());
    close();
    // Four repos are asked at once; the ones still queued when the limit shows up never ask.
    expect(timeline.items).toEqual([]);
    expect(timeline.errors).toHaveLength(4);
    expect(requests.filter((url) => url.startsWith("https://api.github.com/"))).toHaveLength(4);
  });
});

describe("changelogFor paging and registries", () => {
  it("stops paging once it reaches the installed version", async () => {
    const page = Array.from({ length: 49 }, (_, i) => ghRelease(`v1.2.${50 - i}`));
    const { svc, close, requests } = await changelogServices({
      packument: pkgDoc("a"),
      releases: () => jsonResponse([...page, ghRelease("v1.0.0")]),
    });
    await changelogFor(svc, "a", "1.0.0", "2.0.0");
    close();
    expect(requests.filter((url) => url.includes("/releases"))).toHaveLength(1);
  });

  it("keeps what it has when a later page fails", async () => {
    const page = Array.from({ length: 50 }, (_, i) => ghRelease(`v1.2.${50 - i}`));
    const { svc, close } = await changelogServices({
      packument: pkgDoc("a"),
      releases: (url) => (url.includes("page=2") ? new Response("{}", { status: 404 }) : jsonResponse(page)),
    });
    const result = await changelogFor(svc, "a", "1.0.0", "2.0.0");
    close();
    expect(result.entries).toHaveLength(50);
  });

  it("finds nothing, without failing, for a package the public registry refuses", async () => {
    const io = memoryIo({}, { fetch: async () => new Response("", { status: 401 }) });
    const { svc, close } = await testServices(io);
    expect(await changelogFor(svc, "@private/a", "1.0.0", "2.0.0")).toEqual({
      entries: [],
      source: "none",
      rateLimited: false,
    });
    close();
  });
});
