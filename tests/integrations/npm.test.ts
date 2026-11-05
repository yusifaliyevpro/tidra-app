import { describe, expect, it } from "vitest";
import { dailyDownloads, packagesByMaintainer, weeklyTotal } from "@/integrations/npm";

const fetchJson = (body: unknown, status = 200) => {
  const urls: string[] = [];
  const fetch = async (input: RequestInfo | URL) => {
    urls.push(new Request(input).url);
    return Response.json(body, { status });
  };
  return { fetch, urls };
};

describe("packagesByMaintainer", () => {
  it("searches by maintainer and maps each package", async () => {
    const { fetch, urls } = fetchJson({
      objects: [
        {
          package: {
            name: "a",
            version: "1.0.0",
            description: "d",
            date: "2026-11-01T00:00:00Z",
            links: { repository: "https://github.com/me/a" },
          },
        },
        { package: { name: "b", version: "2.0.0" } },
      ],
    });
    expect(await packagesByMaintainer(fetch, "me & you")).toEqual([
      {
        name: "a",
        version: "1.0.0",
        description: "d",
        publishedAt: "2026-11-01T00:00:00Z",
        repository: "https://github.com/me/a",
      },
      { name: "b", version: "2.0.0", description: undefined, publishedAt: undefined, repository: undefined },
    ]);
    expect(urls).toEqual(["https://registry.npmjs.org/-/v1/search?text=maintainer:me%20%26%20you&size=250"]);
  });

  it("returns nothing for an unexpected answer", async () => {
    expect(await packagesByMaintainer(fetchJson({ error: "x" }).fetch, "me")).toEqual([]);
  });
});

describe("dailyDownloads", () => {
  it("reads one number per day, for scoped names too", async () => {
    const { fetch, urls } = fetchJson({
      downloads: [
        { day: "2026-11-01", downloads: 3 },
        { day: "2026-11-02", downloads: 5 },
      ],
    });
    expect(await dailyDownloads(fetch, "@scope/a")).toEqual([3, 5]);
    expect(urls).toEqual(["https://api.npmjs.org/downloads/range/last-month/@scope/a"]);
  });

  it("returns nothing for unpublished packages", async () => {
    expect(await dailyDownloads(fetchJson({ error: "not found" }, 404).fetch, "nope")).toEqual([]);
  });
});

describe("weeklyTotal", () => {
  it("sums the last seven days", () => {
    expect(weeklyTotal([100, 1, 1, 1, 1, 1, 1, 1])).toBe(7);
    expect(weeklyTotal([])).toBe(0);
  });
});
