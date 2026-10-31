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
