import { describe, expect, it } from "vitest";
import { findProjects, findRepoRoot, repoLabel } from "@/engine/discover";
import { memoryIo } from "../support/memory-io";

describe("findProjects", () => {
  it("finds projects nested in a repo without a root package.json", async () => {
    const io = memoryIo({
      "/code/omicron/.git/HEAD": "ref: refs/heads/main",
      "/code/omicron/README.md": "",
      "/code/omicron/apps/backend/package.json": "{}",
      "/code/omicron/apps/frontend/package.json": "{}",
      "/code/omicron/apps/frontend/node_modules/x/package.json": "{}",
      "/code/omicron/packages/contract/package.json": "{}",
      "/code/omicron/packages/contract/test/fixtures/app/package.json": "{}",
    });
    expect(await findProjects(io, "/code/omicron")).toEqual([
      { path: "/code/omicron/apps/backend", repoRoot: "/code/omicron", subdir: "apps/backend" },
      { path: "/code/omicron/apps/frontend", repoRoot: "/code/omicron", subdir: "apps/frontend" },
      { path: "/code/omicron/packages/contract", repoRoot: "/code/omicron", subdir: "packages/contract" },
    ]);
  });

  it("treats a workspace root as one project and keeps separate repos apart", async () => {
    const io = memoryIo({
      "/code/mono/.git/HEAD": "",
      "/code/mono/package.json": "{}",
      "/code/mono/packages/a/package.json": "{}",
      "/code/solo/package.json": "{}",
    });
    expect(await findProjects(io, "/code")).toEqual([
      { path: "/code/mono", repoRoot: "/code/mono", subdir: "" },
      { path: "/code/solo", repoRoot: undefined, subdir: "" },
    ]);
  });
});

describe("findRepoRoot", () => {
  it("walks up to the folder holding .git", async () => {
    const io = memoryIo({ "C:/code/r/.git": "gitdir: ../.git/worktrees/r", "C:/code/r/apps/x/package.json": "{}" });
    expect(await findRepoRoot(io, "C:/code/r/apps/x")).toBe("C:/code/r");
    expect(await findRepoRoot(io, "C:/elsewhere")).toBeUndefined();
  });
});

describe("repoLabel", () => {
  it("prefers the remote's repo name", () => {
    expect(repoLabel("github.com/me/omicron", "/code/omi")).toBe("omicron");
    expect(repoLabel(null, "/code/omi")).toBe("omi");
    expect(repoLabel(null)).toBeUndefined();
  });
});
