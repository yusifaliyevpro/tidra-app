import * as z from "@zod/mini";
import { githubSlug } from "@/engine/git";
import { dailyDownloads, packagesByMaintainer, weeklyTotal, type PublishedPackage } from "@/integrations/npm";
import type { Services } from "./context";
import { readSnapshot, writeSnapshot } from "./snapshot";

export interface PackageStats extends PublishedPackage {
  daily: number[];
  weekly: number;
  stars?: number;
  openIssues?: number;
  repoUrl?: string;
}

export interface PackagesSnapshot {
  username: string;
  packages: PackageStats[];
  error?: string;
  updatedAt: string;
}

export const NPM_USERNAME_SETTING = "npmUsername";

export async function refreshPackages(svc: Services): Promise<PackagesSnapshot | undefined> {
  const username = await svc.store.getSetting(NPM_USERNAME_SETTING, z.string(), "");
  if (!username) return undefined;
  const updatedAt = new Date().toISOString();
  let snapshot: PackagesSnapshot;
  try {
    const github = await svc.github();
    const published = await packagesByMaintainer(svc.io.fetch, username);
    const packages = await Promise.all(
      published.map(async (pkg): Promise<PackageStats> => {
        const daily = await dailyDownloads(svc.io.fetch, pkg.name).catch(() => []);
        const slug = githubSlug(pkg.repository);
        const repo = slug ? await github.repo(slug.owner, slug.repo).catch(() => undefined) : undefined;
        return {
          ...pkg,
          daily,
          weekly: weeklyTotal(daily),
          stars: repo?.stargazers_count,
          openIssues: repo?.open_issues_count,
          repoUrl: repo?.html_url,
        };
      }),
    );
    snapshot = { username, packages: packages.toSorted((a, b) => b.weekly - a.weekly), updatedAt };
  } catch (error) {
    snapshot = { username, packages: [], error: error instanceof Error ? error.message : String(error), updatedAt };
  }
  await writeSnapshot(svc, "packages", snapshot);
  await svc.queryClient.invalidateQueries({ queryKey: ["packages"] });
  return snapshot;
}

export const readPackages = async (svc: Services) => (await readSnapshot<PackagesSnapshot>(svc, "packages"))?.data;
