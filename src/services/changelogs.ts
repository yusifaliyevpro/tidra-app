import * as z from "@zod/mini";
import semver from "semver";
import {
  parseChangelogMarkdown,
  rawFileUrls,
  releasesBetween,
  releaseVersion,
  repoOf,
  sectionsBetween,
  tagPackage,
  type ChangelogEntry,
  type Release,
  type RepoRef,
} from "@/engine/changelog";
import { createLimit } from "@/engine/limit";
import { emptyConfig } from "@/engine/npmrc";
import { GitHubError, RELEASES_PER_PAGE } from "@/integrations/github";
import type { Services } from "./context";
import { cached, HOUR } from "./snapshot";

interface ReleaseTarget {
  owner: string;
  repo: string;
  packages: Map<string, string[]>;
  watched: boolean;
}

export interface ChangelogResult {
  repo?: RepoRef;
  entries: ChangelogEntry[];
  source: "releases" | "changelog" | "none";
  rateLimited: boolean;
}

async function releasesOf(svc: Services, owner: string, repo: string, page = 1): Promise<Release[]> {
  const key = `releases:${owner}/${repo}${page > 1 ? `:${page}` : ""}`.toLowerCase();
  const result = await cached(svc, key, 6 * HOUR, async () => ({
    releases: await (await svc.github()).releases(owner, repo, page),
  }));
  return result.releases;
}

const MAX_RELEASE_PAGES = 5;

/** Repos publishing many canaries push stable releases off the first page, so read on until `from` is reached. */
async function releasesCovering(
  svc: Services,
  repo: RepoRef,
  name: string,
  from: string | undefined,
  to: string,
): Promise<Release[]> {
  const all: Release[] = [];
  for (let page = 1; page <= MAX_RELEASE_PAGES; page++) {
    const batch = await releasesOf(svc, repo.owner, repo.repo, page).catch((error: unknown) => {
      if (page === 1) throw error;
      return [];
    });
    all.push(...batch);
    if (batch.length < RELEASES_PER_PAGE) break;
    const oldest = from ?? to;
    if (
      batch.some((release) => {
        const version = releaseVersion(release, name);
        return version !== undefined && semver.lte(version, oldest);
      })
    )
      break;
  }
  return all;
}

async function changelogFile(svc: Services, repo: RepoRef): Promise<string | undefined> {
  const hit = await cached(
    svc,
    `changelog-file:${repo.owner}/${repo.repo}/${repo.directory ?? ""}`,
    12 * HOUR,
    async () => {
      for (const url of rawFileUrls(repo)) {
        const response = await svc.io.fetch(url).catch(() => undefined);
        if (response?.ok) return { text: await response.text() };
      }
      return { text: "" };
    },
  );
  return hit.text || undefined;
}

/** Release notes between the installed version and `to`: GitHub releases first, CHANGELOG.md as the fallback. */
export async function changelogFor(
  svc: Services,
  name: string,
  from: string | undefined,
  to: string,
): Promise<ChangelogResult> {
  // Packages on a private registry just have no notes here; the default config can't read them.
  const packument = await svc
    .registry(emptyConfig())
    .full(name)
    .catch(() => null);
  const repo = packument ? repoOf(packument, to) : undefined;
  if (!repo) return { entries: [], source: "none", rateLimited: false };

  let rateLimited = false;
  try {
    const entries = releasesBetween(await releasesCovering(svc, repo, name, from, to), name, from, to);
    if (entries.length > 0) return { repo, entries, source: "releases", rateLimited };
  } catch (error) {
    if (!(error instanceof GitHubError)) throw error;
    rateLimited = error.rateLimited;
  }
  const markdown = await changelogFile(svc, repo);
  const entries = markdown ? sectionsBetween(parseChangelogMarkdown(markdown, name), from, to) : [];
  return { repo, entries, source: entries.length > 0 ? "changelog" : "none", rateLimited };
}

export interface TimelineItem {
  repo: string;
  /** npm package name when the repo was reached through a dependency. */
  packageName?: string;
  tag: string;
  title: string;
  body: string;
  url?: string;
  publishedAt: string;
  major: boolean;
  /** Projects that depend on this package. */
  usedBy: string[];
}

const RECENT_DAYS = 45;

const WATCHED_PACKAGES_SETTING = "watchedPackages";
const PackageList = z.array(z.string());

export const readWatchedPackages = (svc: Services) => svc.store.getSetting(WATCHED_PACKAGES_SETTING, PackageList, []);

export async function setPackageWatched(svc: Services, name: string, watched: boolean) {
  const current = await readWatchedPackages(svc);
  const next = watched ? [...new Set([...current, name])].toSorted() : current.filter((n) => n !== name);
  await svc.store.setSetting(WATCHED_PACKAGES_SETTING, next);
}

/**
 * Recent releases of what you watch: whole repos, and npm packages (their repo's releases for that package only).
 * `usage` says which projects use each package, for the "Used by" line.
 */
export async function buildTimeline(
  svc: Services,
  usage: Map<string, string[]>,
): Promise<{ items: TimelineItem[]; errors: string[] }> {
  const [watched, packages] = await Promise.all([svc.store.listWatchedRepos(), readWatchedPackages(svc)]);
  const targets = new Map<string, ReleaseTarget>();
  for (const w of watched)
    targets.set(`${w.owner}/${w.repo}`.toLowerCase(), {
      owner: w.owner,
      repo: w.repo,
      packages: new Map(),
      watched: true,
    });

  const registry = svc.registry(emptyConfig());
  const repos = await Promise.all(
    packages.map(async (name) => {
      const full = await registry.full(name).catch(() => null);
      return full ? repoOf(full, full["dist-tags"].latest) : undefined;
    }),
  );
  packages.forEach((name, i) => {
    const repo = repos[i];
    if (!repo) return;
    const key = `${repo.owner}/${repo.repo}`.toLowerCase();
    const target = targets.get(key) ?? { owner: repo.owner, repo: repo.repo, packages: new Map(), watched: false };
    target.packages.set(name, usage.get(name) ?? []);
    targets.set(key, target);
  });

  const cutoff = Date.now() - RECENT_DAYS * 86_400_000;
  const errors: string[] = [];
  const items: TimelineItem[] = [];
  const limit = createLimit(4);
  // Once GitHub says the budget is gone, the repos still queued don't ask.
  let rateLimited = false;
  const readRepo = async (target: ReleaseTarget) => {
    if (rateLimited) return;
    try {
      const releases = await releasesOf(svc, target.owner, target.repo);
      for (const release of releases) {
        if (release.draft || release.prerelease || !release.publishedAt || Date.parse(release.publishedAt) < cutoff)
          continue;
        const attribution = attribute(release.tag, target);
        if (!attribution) continue;
        const version = semver.coerce(release.tag)?.version;
        items.push({
          repo: `${target.owner}/${target.repo}`,
          packageName: attribution.packageName,
          tag: release.tag,
          title: release.name,
          body: release.body,
          url: release.url,
          publishedAt: release.publishedAt,
          major:
            version !== undefined &&
            semver.minor(version) === 0 &&
            semver.patch(version) === 0 &&
            semver.major(version) > 0,
          usedBy: attribution.usedBy,
        });
      }
    } catch (error) {
      errors.push(`${target.owner}/${target.repo}: ${error instanceof Error ? error.message : String(error)}`);
      if (error instanceof GitHubError && error.rateLimited) rateLimited = true;
    }
  };
  await Promise.all([...targets.values()].map((target) => limit(() => readRepo(target))));
  return { items: items.toSorted((a, b) => b.publishedAt.localeCompare(a.publishedAt)), errors };
}

/**
 * Which of your packages a release is for. Monorepo tags (`expo-router@58.0.29`) count only when you use
 * that package, unless you watch the repo; plain tags go to every package you use from the repo.
 */
export function attribute(
  tag: string,
  target: { packages: Map<string, string[]>; watched: boolean },
): { packageName?: string; usedBy: string[] } | undefined {
  const fromTag = tagPackage(tag);
  if (fromTag) {
    const usedBy = target.packages.get(fromTag);
    if (usedBy) return { packageName: fromTag, usedBy: [...new Set(usedBy)] };
    return target.watched ? { packageName: fromTag, usedBy: [] } : undefined;
  }
  const names = [...target.packages.keys()];
  return {
    packageName: names.length === 1 ? names[0] : undefined,
    usedBy: [...new Set([...target.packages.values()].flat())],
  };
}
