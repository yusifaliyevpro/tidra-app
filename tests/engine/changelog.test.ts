import { describe, expect, it } from "vitest";
import {
  isBreaking,
  parseChangelogMarkdown,
  rawFileUrls,
  releasesBetween,
  repoOf,
  sectionsBetween,
  tagPackage,
  versionFromTag,
  type Release,
} from "@/engine/changelog";
import type { Packument } from "@/engine/registry";

const release = (tag: string, extra: Partial<Release> = {}): Release => ({
  tag,
  name: tag,
  body: "",
  draft: false,
  prerelease: false,
  ...extra,
});

describe("repoOf", () => {
  it("reads the repository from the target version before the top-level field", () => {
    const doc: Packument = {
      name: "pkg",
      "dist-tags": { latest: "2.0.0" },
      repository: "github:old/place",
      versions: {
        "1.0.0": {},
        "2.0.0": { repository: { url: "git+https://github.com/new/place.git", directory: "packages/pkg" } },
      },
    };
    expect(repoOf(doc, "2.0.0")).toEqual({ owner: "new", repo: "place", directory: "packages/pkg" });
    expect(repoOf(doc, "1.0.0")).toEqual({ owner: "old", repo: "place", directory: undefined });
  });
});

describe("versionFromTag", () => {
  it("handles plain, v-prefixed and monorepo tags", () => {
    expect(versionFromTag("v19.3.1", "react")).toBe("19.3.1");
    expect(versionFromTag("19.3.1", "react")).toBe("19.3.1");
    expect(versionFromTag("@tanstack/react-query@5.105.0", "@tanstack/react-query")).toBe("5.105.0");
    expect(versionFromTag("next@15.1.0", "next")).toBe("15.1.0");
    expect(versionFromTag("release-2.0.0", "x")).toBe("2.0.0");
  });

  it("rejects tags for other packages in the same repo", () => {
    expect(versionFromTag("@tanstack/vue-query@5.105.0", "@tanstack/react-query")).toBeUndefined();
    expect(versionFromTag("nightly", "x")).toBeUndefined();
  });
});

describe("releasesBetween", () => {
  const releases = [
    release("v3.0.0", { body: "Removed the legacy API" }),
    release("v2.2.0"),
    release("v2.1.0", { body: "### BREAKING CHANGES\n- renamed `foo`" }),
    release("v2.1.0-rc.1", { prerelease: true }),
    release("v2.0.1", { draft: true }),
    release("v2.0.0"),
  ];

  it("excludes the installed version, includes the target, oldest first", () => {
    expect(releasesBetween(releases, "x", "2.0.0", "3.0.0").map((e) => e.version)).toEqual(["2.1.0", "2.2.0", "3.0.0"]);
  });

  it("skips drafts and prereleases unless the target is a prerelease", () => {
    expect(releasesBetween(releases, "x", "2.0.0", "2.1.0").map((e) => e.version)).toEqual(["2.1.0"]);
    expect(releasesBetween(releases, "x", "2.0.0", "2.1.0-rc.1").map((e) => e.version)).toEqual(["2.1.0-rc.1"]);
  });

  it("flags major bumps and BREAKING notes", () => {
    const flags = Object.fromEntries(
      releasesBetween(releases, "x", "2.0.0", "3.0.0").map((e) => [e.version, e.breaking]),
    );
    expect(flags).toEqual({ "2.1.0": true, "2.2.0": false, "3.0.0": true });
  });
});

describe("parseChangelogMarkdown", () => {
  it("parses Keep a Changelog and drops link references", () => {
    const md = `# Changelog

## [Unreleased]

## [2.0.0] - 2026-02-01
### Changed
- Breaking change: new config format

## [1.1.0] - 2026-01-01
### Added
- Something

[2.0.0]: https://github.com/o/r/compare/v1.1.0...v2.0.0
`;
    const entries = parseChangelogMarkdown(md);
    expect(entries.map((e) => e.version)).toEqual(["2.0.0", "1.1.0"]);
    expect(entries[0]?.body).toBe("### Changed\n- Breaking change: new config format");
    expect(entries[0]?.breaking).toBe(true);
    expect(entries[1]?.body).not.toContain("compare");
  });

  it("parses changesets output and keeps subsections inside their version", () => {
    const md =
      "# pkg\n\n## 5.0.0\n\n### Major Changes\n\n- dropped node 20\n\n## 4.2.0\n\n### Minor Changes\n\n- added x\n";
    const entries = parseChangelogMarkdown(md);
    expect(entries.map((e) => [e.version, e.breaking])).toEqual([
      ["5.0.0", true],
      ["4.2.0", false],
    ]);
  });

  it("picks the right package in a shared monorepo changelog", () => {
    const md = "## a@2.0.0\n- a change\n## b@9.0.0\n- b change\n## a@1.0.0\n- old\n";
    expect(parseChangelogMarkdown(md, "a").map((e) => e.version)).toEqual(["2.0.0", "1.0.0"]);
  });

  it("selects the sections between two versions", () => {
    const entries = parseChangelogMarkdown("## 3.0.0\nc\n## 2.0.0\nb\n## 1.0.0\na\n");
    expect(sectionsBetween(entries, "1.0.0", "2.0.0").map((e) => e.version)).toEqual(["2.0.0"]);
    expect(sectionsBetween(entries, undefined, "3.0.0")).toHaveLength(3);
  });
});

describe("tagPackage", () => {
  it("reads the package from monorepo tags only", () => {
    expect(tagPackage("@expo/cli@58.1.18")).toBe("@expo/cli");
    expect(tagPackage("expo-router@58.0.29")).toBe("expo-router");
    expect(tagPackage("v1.2.3")).toBeUndefined();
    expect(tagPackage("release@next")).toBeUndefined();
  });
});

describe("helpers", () => {
  it("detects breaking markers", () => {
    expect(isBreaking("⚠️ Breaking: x")).toBe(true);
    expect(isBreaking("## Major Changes")).toBe(true);
    expect(isBreaking("fixed a bug")).toBe(false);
  });

  it("looks in the package directory before the repo root", () => {
    const urls = rawFileUrls({ owner: "o", repo: "r", directory: "packages/a" });
    expect(urls[0]).toBe("https://raw.githubusercontent.com/o/r/HEAD/packages/a/CHANGELOG.md");
    expect(urls).toContain("https://raw.githubusercontent.com/o/r/HEAD/CHANGELOG.md");
  });
});
