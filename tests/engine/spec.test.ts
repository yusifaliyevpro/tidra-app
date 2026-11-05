import { describe, expect, it } from "vitest";
import { formatSpec, parseSpec, rangeStyle } from "@/engine/spec";

describe("parseSpec", () => {
  it("reads caret, tilde, exact and complex ranges", () => {
    expect(parseSpec("react", "^19.0.0")).toMatchObject({ kind: "range", style: "caret" });
    expect(parseSpec("react", "~19.0.0")).toMatchObject({ kind: "range", style: "tilde" });
    expect(parseSpec("react", "19.0.0")).toMatchObject({ kind: "range", style: "exact" });
    for (const range of [">=1.0.0 <2.0.0", "^1 || ^2", "1.0.0 - 2.0.0", "1.x"]) {
      expect(parseSpec("a", range)).toMatchObject({ kind: "range", style: "complex", range });
    }
  });

  it("treats dist-tags and wildcards as tags", () => {
    expect(parseSpec("next", "latest")).toEqual({ kind: "tag", name: "next", tag: "latest", alias: false });
    expect(parseSpec("next", "*")).toMatchObject({ kind: "tag", tag: "*" });
    expect(parseSpec("next", "")).toMatchObject({ kind: "tag", tag: "*" });
  });

  it("resolves npm aliases to the real package name", () => {
    expect(parseSpec("react-18", "npm:react@^18.3.0")).toMatchObject({
      kind: "range",
      name: "react",
      range: "^18.3.0",
      alias: true,
    });
    expect(parseSpec("types", "npm:@types/node@24.1.0")).toMatchObject({ name: "@types/node", style: "exact" });
  });

  it("recognises protocols that never go to the registry", () => {
    expect(parseSpec("a", "workspace:^1.0.0")).toEqual({ kind: "workspace", range: "^1.0.0" });
    expect(parseSpec("a", "catalog:")).toEqual({ kind: "catalog", catalog: "default" });
    expect(parseSpec("a", "catalog:react19")).toEqual({ kind: "catalog", catalog: "react19" });
    expect(parseSpec("a", "file:../a").kind).toBe("file");
    expect(parseSpec("a", "link:../a").kind).toBe("link");
    expect(parseSpec("a", "https://x.dev/a.tgz").kind).toBe("url");
    expect(parseSpec("a", "git+https://github.com/o/r.git").kind).toBe("git");
    expect(parseSpec("a", "github:o/r").kind).toBe("git");
    expect(parseSpec("a", "o/r#main").kind).toBe("git");
  });
});

describe("rangeStyle", () => {
  it("keeps prerelease ranges in their style", () => {
    expect(rangeStyle("^15.0.0-canary.1")).toBe("caret");
    expect(rangeStyle("15.0.0-canary.1")).toBe("exact");
  });
});

describe("formatSpec", () => {
  it("keeps the range prefix", () => {
    expect(formatSpec("^1.2.0", "2.0.0", false)).toBe("^2.0.0");
    expect(formatSpec("~1.2.0", "1.3.0", false)).toBe("~1.3.0");
    expect(formatSpec("1.2.0", "1.3.0", false)).toBe("1.3.0");
  });

  it("collapses complex ranges to caret", () => {
    expect(formatSpec(">=1 <2", "2.1.0", false)).toBe("^2.1.0");
  });

  it("writes exact versions when the project saves exact", () => {
    expect(formatSpec("^1.2.0", "2.0.0", true)).toBe("2.0.0");
  });

  it("keeps npm aliases and workspace protocols intact", () => {
    expect(formatSpec("npm:react@^18.0.0", "18.3.1", false)).toBe("npm:react@^18.3.1");
    expect(formatSpec("npm:@types/node@24.0.0", "24.5.0", false)).toBe("npm:@types/node@24.5.0");
    expect(formatSpec("workspace:*", "2.0.0", false)).toBe("workspace:*");
  });
});

describe("parseSpec edge cases", () => {
  it("trims whitespace around the value", () => {
    expect(parseSpec("a", "  ^1.2.0  ")).toMatchObject({ kind: "range", range: "^1.2.0", style: "caret" });
  });

  it("reads x-ranges, hyphen ranges and unions as complex ranges", () => {
    for (const range of ["1.x", "1.2.3 - 2.3.4", "^1.2.3 || ^2.0.0", ">=1.0.0 <2.0.0"]) {
      expect(parseSpec("a", range)).toMatchObject({ kind: "range", range, style: "complex" });
    }
  });

  it("treats npm aliases without a version as the latest tag", () => {
    expect(parseSpec("a", "npm:pkg")).toEqual({ kind: "tag", name: "pkg", tag: "latest", alias: true });
    expect(parseSpec("a", "npm:@scope/pkg")).toEqual({ kind: "tag", name: "@scope/pkg", tag: "latest", alias: true });
  });

  it("reads aliases to a dist-tag", () => {
    expect(parseSpec("a", "npm:react@canary")).toEqual({ kind: "tag", name: "react", tag: "canary", alias: true });
  });

  it("treats owner/repo shorthands and other git hosts as git", () => {
    for (const value of ["owner/repo", "gitlab:o/r", "bitbucket:o/r", "git://github.com/o/r.git", "o/r#v1.2.3"]) {
      expect(parseSpec("a", value).kind).toBe("git");
    }
  });

  it("reads portal: like link:", () => {
    expect(parseSpec("a", "portal:../a")).toEqual({ kind: "link", target: "portal:../a" });
  });

  it("keeps the target of file: and url specs", () => {
    expect(parseSpec("a", "file:../a.tgz")).toEqual({ kind: "file", target: "../a.tgz" });
    expect(parseSpec("a", "http://x.dev/a.tgz")).toEqual({ kind: "url", target: "http://x.dev/a.tgz" });
  });

  it("reads workspace protocol shorthands", () => {
    expect(parseSpec("a", "workspace:*")).toEqual({ kind: "workspace", range: "*" });
    expect(parseSpec("a", "workspace:^")).toEqual({ kind: "workspace", range: "^" });
  });
});

describe("rangeStyle edge cases", () => {
  it.for([
    ["1.2.3", "exact"],
    ["1.2.3+build.5", "exact"],
    ["^1", "caret"],
    ["^1.2", "caret"],
    ["~1", "tilde"],
    ["~1.2.3-beta.1", "tilde"],
    ["^1.2.3-beta.1+build", "complex"],
    [">=1.2.3", "complex"],
    ["*", "complex"],
  ])("%s is %s", ([range, style]) => {
    expect(rangeStyle(range ?? "")).toBe(style);
  });
});

describe("formatSpec edge cases", () => {
  it("drops a leading v from exact pins", () => {
    expect(formatSpec("v1.2.3", "1.3.0", false)).toBe("1.3.0");
  });

  it("keeps the alias when the alias has no version", () => {
    expect(formatSpec("npm:pkg", "2.0.0", false)).toBe("npm:pkg@^2.0.0");
  });

  it("writes exact versions inside aliases when the project saves exact", () => {
    expect(formatSpec("npm:react@^18.0.0", "18.3.1", true)).toBe("npm:react@18.3.1");
  });

  it("keeps workspace protocols even when saving exact", () => {
    expect(formatSpec("workspace:^1.0.0", "2.0.0", true)).toBe("workspace:^1.0.0");
  });

  it("writes partial tildes and carets in full", () => {
    expect(formatSpec("~1", "1.5.0", false)).toBe("~1.5.0");
    expect(formatSpec("^1.x", "2.0.0", false)).toBe("^2.0.0");
  });

  it("keeps an `=` pin exact", () => {
    expect(formatSpec("=1.2.3", "1.3.0", false)).toBe("1.3.0");
  });
});
