import { describe, expect, it } from "vitest";
import { classifyBump, latestInMajor, prereleaseChannel, sortVersionsDesc } from "@/engine/versions";

describe("classifyBump", () => {
  it("classifies stable bumps", () => {
    expect(classifyBump("18.3.1", "19.0.0")).toBe("major");
    expect(classifyBump("3.20.0", "3.22.4")).toBe("minor");
    expect(classifyBump("3.22.3", "3.22.4")).toBe("patch");
    expect(classifyBump("1.0.0-rc.1", "1.0.0")).toBe("prerelease");
  });

  it("treats 0.x minor and 0.0.x patch bumps as breaking", () => {
    expect(classifyBump("0.1.0", "0.2.0")).toBe("major");
    expect(classifyBump("0.1.0", "0.1.5")).toBe("patch");
    expect(classifyBump("0.0.3", "0.0.4")).toBe("major");
  });

  it("reports none for equal, older or invalid versions", () => {
    expect(classifyBump("1.0.0", "1.0.0")).toBe("none");
    expect(classifyBump("2.0.0", "1.9.0")).toBe("none");
    expect(classifyBump("not-a-version", "1.0.0")).toBe("none");
  });
});

describe("prereleaseChannel", () => {
  it("names the channel of a tagged prerelease", () => {
    expect(prereleaseChannel("15.1.0-canary.3")).toBe("canary");
    expect(prereleaseChannel("2.0.0-beta.1")).toBe("beta");
  });

  it("returns nothing for stable or numeric-only prereleases", () => {
    expect(prereleaseChannel("1.0.0")).toBeUndefined();
    expect(prereleaseChannel("1.0.0-0")).toBeUndefined();
  });
});

describe("latestInMajor", () => {
  it("returns the newest stable version of a major", () => {
    expect(latestInMajor(["24.0.0", "24.5.0", "24.6.0-rc.1", "26.1.0"], 24)).toBe("24.5.0");
    expect(latestInMajor(["26.1.0"], 24)).toBeUndefined();
  });
});

describe("classifyBump edge cases", () => {
  it("returns none for downgrades, equal versions and build-only changes", () => {
    expect(classifyBump("2.0.0", "1.9.9")).toBe("none");
    expect(classifyBump("1.2.3", "1.2.3")).toBe("none");
    expect(classifyBump("1.0.0", "1.0.0+build.1")).toBe("none");
  });

  it("returns none when either side is not a version", () => {
    expect(classifyBump("latest", "1.0.0")).toBe("none");
    expect(classifyBump("1.0.0", "next")).toBe("none");
  });

  it("classifies prerelease to prerelease steps", () => {
    expect(classifyBump("15.1.0-canary.1", "15.1.0-canary.3")).toBe("prerelease");
    expect(classifyBump("0.0.1-a", "0.0.1")).toBe("prerelease");
  });

  it("treats leaving 0.x for 1.0 as major", () => {
    expect(classifyBump("0.9.9", "1.0.0")).toBe("major");
  });
});

describe("sortVersionsDesc", () => {
  it("sorts newest first, prereleases below their release, and drops invalid entries", () => {
    expect(sortVersionsDesc(["1.0.0", "1.10.0", "not-a-version", "1.2.0", "1.10.0-rc.1", "2.0.0-beta.1"])).toEqual([
      "2.0.0-beta.1",
      "1.10.0",
      "1.10.0-rc.1",
      "1.2.0",
      "1.0.0",
    ]);
  });

  it("returns an empty list for no input", () => {
    expect(sortVersionsDesc([])).toEqual([]);
  });
});

describe("prereleaseChannel edge cases", () => {
  it("returns nothing for stable and numeric-only prereleases", () => {
    expect(prereleaseChannel("1.0.0")).toBeUndefined();
    expect(prereleaseChannel("1.0.0-0")).toBeUndefined();
    expect(prereleaseChannel("not a version")).toBeUndefined();
  });
});
