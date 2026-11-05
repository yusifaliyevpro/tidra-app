import { describe, expect, it } from "vitest";
import { basename, dirname, join, normalize, relative } from "@/engine/path";

describe("path", () => {
  it("normalizes Windows and POSIX paths to forward slashes", () => {
    expect(normalize("C:\\Users\\me\\repo\\")).toBe("C:/Users/me/repo");
    expect(normalize("/a/./b/../c")).toBe("/a/c");
    expect(normalize("a/../../b")).toBe("../b");
  });

  it("joins and splits", () => {
    expect(join("C:/repo", "packages", "a", "package.json")).toBe("C:/repo/packages/a/package.json");
    expect(dirname("C:/repo/package.json")).toBe("C:/repo");
    expect(dirname("C:/repo")).toBe("C:/");
    expect(dirname("/repo")).toBe("/");
    expect(basename("C:\\repo\\pnpm-lock.yaml")).toBe("pnpm-lock.yaml");
  });

  it("computes relative paths case-insensitively", () => {
    expect(relative("C:/Repo", "c:/repo/apps/web")).toBe("apps/web");
    expect(relative("/repo/apps/web", "/repo")).toBe("../..");
    expect(relative("/repo", "/repo")).toBe(".");
  });
});

describe("normalize edge cases", () => {
  it.for([
    ["", "."],
    [".", "."],
    ["./a/./b/", "a/b"],
    ["a//b///c", "a/b/c"],
    ["/", "/"],
    ["C:/", "C:/"],
    ["C:\\", "C:/"],
    [String.raw`c:\Users\me`, "c:/Users/me"],
    ["../../a", "../../a"],
  ])("normalizes %j to %j", ([input, expected]) => {
    expect(normalize(input ?? "")).toBe(expected);
  });

  it("resolves `..` inside a drive", () => {
    expect(normalize("C:/a/../b")).toBe("C:/b");
  });

  it("drops `..` that would climb above the root", () => {
    expect(normalize("/a/../..")).toBe("/");
    expect(normalize("C:/../x")).toBe("C:/x");
  });

  it("keeps Windows network (UNC) paths", () => {
    expect(normalize(String.raw`\\wsl$\Ubuntu\home\me\app`)).toBe("//wsl$/Ubuntu/home/me/app");
    expect(join(String.raw`\\server\share\repo`, "package.json")).toBe("//server/share/repo/package.json");
  });
});

describe("network paths", () => {
  it("walk up to the share and stop there", () => {
    expect(dirname("//server/share/repo/app")).toBe("//server/share/repo");
    expect(dirname("//server/share/repo")).toBe("//server/share");
    expect(dirname("//server/share")).toBe("//server/share");
  });

  it("work with relative", () => {
    expect(relative("//server/share/repo", "//server/share/repo/apps/web")).toBe("apps/web");
  });
});

describe("join, dirname, basename edge cases", () => {
  it("skips empty segments and resolves `..` across segments", () => {
    expect(join("/repo", "", "apps", "..", "packages")).toBe("/repo/packages");
    expect(join("a", "../..", "b")).toBe("../b");
  });

  it("returns `.` for a bare name and the root for top-level entries", () => {
    expect(dirname("package.json")).toBe(".");
    expect(dirname("/package.json")).toBe("/");
    expect(dirname("C:/package.json")).toBe("C:/");
  });

  it("returns the last segment, even of a Windows path with trailing separators", () => {
    expect(basename("C:\\repo\\apps\\web\\")).toBe("web");
    expect(basename("file.txt")).toBe("file.txt");
  });
});

describe("relative edge cases", () => {
  it("walks up and back down between siblings", () => {
    expect(relative("/repo/apps/web", "/repo/packages/ui")).toBe("../../packages/ui");
  });

  it("treats mixed separators as the same path", () => {
    expect(relative(String.raw`C:\repo`, "C:/repo/apps")).toBe("apps");
  });
});
