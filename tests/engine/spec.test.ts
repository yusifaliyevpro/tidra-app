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
