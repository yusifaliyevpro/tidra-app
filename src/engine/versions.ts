import semver from "semver";

export type Bump = "major" | "minor" | "patch" | "prerelease" | "none";

/** Semver bump between two versions; under 1.0 a minor bump is breaking, and under 0.1 so is a patch bump. */
export function classifyBump(from: string, to: string): Bump {
  const a = semver.parse(from);
  const b = semver.parse(to);
  if (!a || !b || semver.lte(b, a)) return "none";
  if (b.major !== a.major) return "major";
  if (a.major === 0 && b.minor !== a.minor) return "major";
  if (a.major === 0 && a.minor === 0 && b.patch !== a.patch) return "major";
  if (b.minor !== a.minor) return "minor";
  if (b.patch !== a.patch) return "patch";
  return "prerelease";
}

/** The dist-tag a prerelease follows: `15.1.0-canary.3` follows `canary`; numeric-only prereleases follow nothing. */
export function prereleaseChannel(version: string): string | undefined {
  const pre = semver.prerelease(version);
  const first = pre?.[0];
  return typeof first === "string" ? first : undefined;
}

export function sortVersionsDesc(versions: Iterable<string>): string[] {
  return [...versions].filter((v) => semver.valid(v)).toSorted(semver.rcompare);
}

/** Highest stable version in the given major, for packages pinned to a major such as `@types/node`. */
export function latestInMajor(versions: Iterable<string>, major: number): string | undefined {
  return sortVersionsDesc(versions).find((v) => semver.major(v) === major && !semver.prerelease(v));
}
