import * as z from "@zod/mini";
import { fetchWithRetry } from "@/engine/registry";

const SearchSchema = z.compile(
  z.looseObject({
    objects: z.array(
      z.looseObject({
        package: z.looseObject({
          name: z.string(),
          version: z.string(),
          description: z.optional(z.string()),
          date: z.optional(z.string()),
          links: z.optional(z.looseObject({ repository: z.optional(z.string()), npm: z.optional(z.string()) })),
        }),
      }),
    ),
  }),
);

const RangeSchema = z.compile(
  z.looseObject({ downloads: z.array(z.looseObject({ day: z.string(), downloads: z.number() })) }),
);

export interface PublishedPackage {
  name: string;
  version: string;
  description?: string;
  publishedAt?: string;
  repository?: string;
}

export async function packagesByMaintainer(fetcher: typeof fetch, username: string): Promise<PublishedPackage[]> {
  const url = `https://registry.npmjs.org/-/v1/search?text=maintainer:${encodeURIComponent(username)}&size=250`;
  const data: unknown = await (await fetchWithRetry(fetcher, url, {})).json();
  if (!z.validate(SearchSchema, data)) return [];
  return data.objects.map(({ package: p }) => ({
    name: p.name,
    version: p.version,
    description: p.description,
    publishedAt: p.date,
    repository: p.links?.repository,
  }));
}

/** Daily downloads for the last 30 days; the npm API answers scoped names one at a time. */
export async function dailyDownloads(fetcher: typeof fetch, name: string): Promise<number[]> {
  const response = await fetchWithRetry(fetcher, `https://api.npmjs.org/downloads/range/last-month/${name}`, {});
  if (!response.ok) return [];
  const data: unknown = await response.json();
  return z.validate(RangeSchema, data) ? data.downloads.map((d) => d.downloads) : [];
}

export const weeklyTotal = (daily: number[]) => daily.slice(-7).reduce((sum, n) => sum + n, 0);
