import semver from "semver";
import { githubSlug } from "./git";
import type { Packument } from "./registry";

export interface RepoRef {
  owner: string;
  repo: string;
  /** Monorepo package folder from `repository.directory`. */
  directory?: string;
}

export interface Release {
  tag: string;
  name: string;
  body: string;
  publishedAt?: string;
  url?: string;
  draft: boolean;
  prerelease: boolean;
}

export interface ChangelogEntry {
  version: string;
  title: string;
  body: string;
  publishedAt?: string;
  url?: string;
  breaking: boolean;
}

/** Reads `repository` from the target version first: packages move repos, and old metadata points at the old one. */
export function repoOf(packument: Packument, version?: string): RepoRef | undefined {
  const field = (version && packument.versions[version]?.repository) || packument.repository;
  const url = typeof field === "string" ? field : field?.url;
  const slug = githubSlug(url);
  if (!slug) return undefined;
  const directory = typeof field === "object" && field.directory ? field.directory.replace(/^\.?\//, "") : undefined;
  return { ...slug, directory };
}

/** Version a tag refers to for `packageName`, or undefined when the tag belongs to another package in the repo. */
export function versionFromTag(tag: string, packageName: string): string | undefined {
  const at = tag.lastIndexOf("@");
  if (at > 0) {
    if (tag.slice(0, at) !== packageName) return undefined;
    return semver.valid(semver.clean(tag.slice(at + 1)) ?? "") ?? undefined;
  }
  return semver.valid(semver.clean(tag.replace(/^[a-z-]*?(?=v?\d)/i, "")) ?? "") ?? undefined;
}

/** Package a monorepo tag belongs to (`@expo/cli@58.1.18` → `@expo/cli`); undefined for plain `v1.2.3` tags. */
export function tagPackage(tag: string): string | undefined {
  const at = tag.lastIndexOf("@");
  return at > 0 && semver.valid(semver.clean(tag.slice(at + 1)) ?? "") ? tag.slice(0, at) : undefined;
}

const BREAKING = /breaking change|⚠️\s*breaking|^#+\s*(major changes|breaking)/im;

export function isBreaking(text: string): boolean {
  return BREAKING.test(text);
}

/** Releases after `from` up to and including `to`, oldest first; drafts are always skipped. */
export function releasesBetween(
  releases: Release[],
  packageName: string,
  from: string | undefined,
  to: string,
): ChangelogEntry[] {
  const includePre = semver.prerelease(to) !== null;
  const entries: ChangelogEntry[] = [];
  for (const release of releases) {
    if (release.draft) continue;
    const version = versionFromTag(release.tag, packageName);
    if (!version || (release.prerelease && !includePre) || (semver.prerelease(version) && !includePre)) continue;
    if (semver.gt(version, to) || (from && semver.lte(version, from))) continue;
    entries.push({
      version,
      title: release.name || release.tag,
      body: release.body,
      publishedAt: release.publishedAt,
      url: release.url,
      breaking: semver.major(version) !== semver.major(from ?? version) || isBreaking(release.body),
    });
  }
  return entries.toSorted((a, b) => semver.compare(a.version, b.version));
}

const HEADING = /^(#{1,3})\s+\[?(?:v|version\s+)?(?:(@?[\w./-]+)@)?(\d+\.\d+\.\d+(?:-[\w.]+)?)\]?(.*)$/i;

/** Splits a CHANGELOG.md (Keep a Changelog, changesets, conventional-changelog) into per-version sections. */
export function parseChangelogMarkdown(markdown: string, packageName?: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  let current: { version: string; title: string; lines: string[]; level: number } | undefined;
  const flush = () => {
    if (!current) return;
    const body = current.lines.join("\n").trim();
    entries.push({ version: current.version, title: current.title, body, breaking: isBreaking(body) });
  };
  for (const line of markdown.split(/\r?\n/)) {
    const match = HEADING.exec(line);
    const level = match?.[1]?.length ?? 0;
    const owner = match?.[2];
    if (match?.[3] && (!current || level <= current.level) && (!owner || !packageName || owner === packageName)) {
      flush();
      current = { version: match[3], title: line.replace(/^#+\s*/, "").trim(), lines: [], level };
    } else if (current && !/^\[[^\]]+\]:\s*http/.test(line)) {
      current.lines.push(line);
    }
  }
  flush();
  return entries;
}

export function sectionsBetween(entries: ChangelogEntry[], from: string | undefined, to: string): ChangelogEntry[] {
  return entries
    .filter((e) => semver.valid(e.version) && semver.lte(e.version, to) && (!from || semver.gt(e.version, from)))
    .map((e) => ({ ...e, breaking: e.breaking || semver.major(e.version) !== semver.major(from ?? e.version) }))
    .toSorted((a, b) => semver.compare(a.version, b.version));
}

export const CHANGELOG_FILES = ["CHANGELOG.md", "changelog.md", "CHANGES.md", "HISTORY.md"];

export function rawFileUrls(repo: RepoRef): string[] {
  const dirs = repo.directory ? [`${repo.directory}/`, ""] : [""];
  return dirs.flatMap((dir) =>
    CHANGELOG_FILES.map((file) => `https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/HEAD/${dir}${file}`),
  );
}
