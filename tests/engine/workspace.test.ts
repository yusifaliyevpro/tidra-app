import { describe, expect, it } from "vitest";
import { detectPackageManager, expandWorkspaceGlobs, loadWorkspace } from "@/engine/workspace";
import { memoryIo } from "../support/memory-io";

const pkg = (value: object) => JSON.stringify(value, null, 2);

describe("detectPackageManager", () => {
  it("prefers the packageManager field over lockfiles", async () => {
    const io = memoryIo({ "/r/package.json": "{}", "/r/package-lock.json": "{}", "/r/pnpm-lock.yaml": "" });
    expect(await detectPackageManager(io, "/r", { packageManager: "pnpm@12.17.0+sha512.abc" })).toMatchObject({
      name: "pnpm",
      version: "12.17.0",
      lockfile: "/r/pnpm-lock.yaml",
    });
  });

  it("reads devEngines.packageManager", async () => {
    const io = memoryIo({ "/r/package.json": "{}" });
    expect(
      await detectPackageManager(io, "/r", { devEngines: { packageManager: { name: "pnpm", version: ">=12" } } }),
    ).toMatchObject({
      name: "pnpm",
      version: ">=12",
    });
  });

  it("finds the nearest lockfile walking up", async () => {
    const io = memoryIo({ "/mono/pnpm-lock.yaml": "", "/mono/apps/web/package.json": "{}" });
    expect(await detectPackageManager(io, "/mono/apps/web", {})).toMatchObject({
      name: "pnpm",
      lockfile: "/mono/pnpm-lock.yaml",
    });
  });

  it("lets bun win over pnpm in the same folder and detects yarn berry", async () => {
    expect((await detectPackageManager(memoryIo({ "/r/bun.lock": "", "/r/pnpm-lock.yaml": "" }), "/r", {})).name).toBe(
      "bun",
    );
    const berry = memoryIo({ "/r/yarn.lock": "", "/r/.yarnrc.yml": "" });
    expect(await detectPackageManager(berry, "/r", {})).toMatchObject({ name: "yarn", yarnBerry: true });
  });

  it("falls back to npm", async () => {
    expect((await detectPackageManager(memoryIo({ "/r/package.json": "{}" }), "/r", {})).name).toBe("npm");
  });
});

describe("expandWorkspaceGlobs", () => {
  const io = memoryIo({
    "/r/apps/web/package.json": "{}",
    "/r/apps/docs/package.json": "{}",
    "/r/apps/notes/README.md": "",
    "/r/packages/ui/package.json": "{}",
    "/r/packages/ui/node_modules/x/package.json": "{}",
    "/r/packages/internal/legacy/package.json": "{}",
  });

  it("matches single-level globs and skips folders without package.json", async () => {
    expect(await expandWorkspaceGlobs(io, "/r", ["apps/*"])).toEqual(["apps/docs", "apps/web"]);
  });

  it("supports ** and negation, never entering node_modules", async () => {
    expect(await expandWorkspaceGlobs(io, "/r", ["packages/**", "!packages/internal/**"])).toEqual(["packages/ui"]);
  });
});

describe("loadWorkspace", () => {
  it("loads a pnpm workspace with catalogs, release age and the lockfile", async () => {
    const io = memoryIo({
      "/r/package.json": pkg({ name: "root", private: true, devDependencies: { typescript: "7.0.2" } }),
      "/r/pnpm-workspace.yaml": [
        "packages:",
        "  - apps/*",
        "saveExact: true",
        "minimumReleaseAge: 1440",
        "minimumReleaseAgeExclude:",
        "  - '@acme/*'",
        "catalog:",
        "  zod: ^4.6.0",
        "catalogs:",
        "  react19:",
        "    react: ^19.3.0",
      ].join("\n"),
      "/r/pnpm-lock.yaml":
        "lockfileVersion: '9.0'\nimporters:\n  .:\n    devDependencies:\n      typescript:\n        specifier: 7.0.2\n        version: 7.0.2\n",
      "/r/apps/web/package.json": pkg({ name: "web", dependencies: { zod: "catalog:", react: "catalog:react19" } }),
    });
    const ws = await loadWorkspace(io, "/r");
    expect(ws.pm.name).toBe("pnpm");
    expect(ws.importers.map((i) => i.path)).toEqual([".", "apps/web"]);
    expect(ws.catalogs).toEqual({ default: { zod: "^4.6.0" }, react19: { react: "^19.3.0" } });
    expect(ws.saveExact).toBe(true);
    expect(ws.minimumReleaseAgeMinutes).toBe(1440);
    expect(ws.minimumReleaseAgeExclude).toEqual(["@acme/*"]);
    expect(ws.lockfile.installed(".", "typescript")).toBe("7.0.2");
  });

  it("reads npm workspaces from package.json", async () => {
    const io = memoryIo({
      "/r/package.json": pkg({ workspaces: ["packages/*"] }),
      "/r/packages/a/package.json": pkg({ name: "a" }),
    });
    expect((await loadWorkspace(io, "/r")).importers.map((i) => i.path)).toEqual([".", "packages/a"]);
  });

  it("maps importers when the lockfile lives above the project", async () => {
    const io = memoryIo({
      "/mono/pnpm-lock.yaml":
        "lockfileVersion: '9.0'\nimporters:\n  apps/web:\n    dependencies:\n      react:\n        specifier: ^19.0.0\n        version: 19.3.1\n",
      "/mono/apps/web/package.json": pkg({ name: "web", dependencies: { react: "^19.0.0" } }),
    });
    const ws = await loadWorkspace(io, "/mono/apps/web");
    expect(ws.lockfile.installed(".", "react")).toBe("19.3.1");
  });

  it("fails clearly without a package.json", async () => {
    await expect(loadWorkspace(memoryIo({}), "/empty")).rejects.toThrow("No readable package.json");
  });
});

describe("workspace fingerprint", () => {
  const files = {
    "/r/package.json": pkg({ name: "r", dependencies: { a: "^1.0.0" } }),
    "/r/package-lock.json": JSON.stringify({
      lockfileVersion: 3,
      packages: { "node_modules/a": { version: "1.0.0" } },
    }),
  };

  it("stays the same while no input file changes", async () => {
    const first = await loadWorkspace(memoryIo(files), "/r");
    const second = await loadWorkspace(memoryIo(files), "/r");
    expect(second.fingerprint).toBe(first.fingerprint);
    expect(second.lockfileHash).toBe(first.lockfileHash);
  });

  it("changes with the lockfile and with any manifest", async () => {
    const base = await loadWorkspace(memoryIo(files), "/r");
    const lock = await loadWorkspace(
      memoryIo({
        ...files,
        "/r/package-lock.json": JSON.stringify({
          lockfileVersion: 3,
          packages: { "node_modules/a": { version: "1.0.1" } },
        }),
      }),
      "/r",
    );
    const manifest = await loadWorkspace(
      memoryIo({ ...files, "/r/package.json": pkg({ name: "r", dependencies: { a: "^1.0.1" } }) }),
      "/r",
    );
    expect(lock.fingerprint).not.toBe(base.fingerprint);
    expect(lock.lockfileHash).not.toBe(base.lockfileHash);
    expect(manifest.fingerprint).not.toBe(base.fingerprint);
    expect(manifest.lockfileHash).toBe(base.lockfileHash);
  });
});

describe("detectPackageManager edge cases", () => {
  it("reads the version from packageManager, dropping the integrity hash", async () => {
    const io = memoryIo({});
    expect(await detectPackageManager(io, "/r", { packageManager: "pnpm@12.17.0+sha512.abc" })).toMatchObject({
      name: "pnpm",
      version: "12.17.0",
    });
  });

  it("ignores packageManager values that aren't a known manager", async () => {
    const io = memoryIo({ "/r/yarn.lock": "" });
    expect((await detectPackageManager(io, "/r", { packageManager: "deno@2.0.0" })).name).toBe("yarn");
  });

  it("only takes the declared manager's lockfile", async () => {
    const io = memoryIo({ "/r/package-lock.json": "{}", "/r/pnpm-lock.yaml": "" });
    expect(await detectPackageManager(io, "/r", { packageManager: "npm@11.0.0" })).toMatchObject({
      name: "npm",
      lockfile: "/r/package-lock.json",
    });
  });

  it("knows bun's binary lockfile, which has no parser", async () => {
    const io = memoryIo({ "/r/bun.lockb": "" });
    expect(await detectPackageManager(io, "/r", {})).toMatchObject({ name: "bun", lockfile: "/r/bun.lockb" });
  });

  it("treats pnpm-workspace.yaml as pnpm even before a lockfile exists", async () => {
    const io = memoryIo({ "/r/pnpm-workspace.yaml": "packages: []" });
    expect(await detectPackageManager(io, "/r", {})).toEqual({ name: "pnpm", version: undefined, yarnBerry: false });
  });
});

describe("expandWorkspaceGlobs edge cases", () => {
  it("matches exact folders and returns them sorted", async () => {
    const io = memoryIo({ "/r/b/package.json": "{}", "/r/a/package.json": "{}" });
    expect(await expandWorkspaceGlobs(io, "/r", ["b", "a"])).toEqual(["a", "b"]);
  });

  it("skips hidden folders", async () => {
    const io = memoryIo({ "/r/.cache/x/package.json": "{}", "/r/apps/x/package.json": "{}" });
    expect(await expandWorkspaceGlobs(io, "/r", ["*/*"])).toEqual(["apps/x"]);
  });

  it("matches every depth for a bare `**`", async () => {
    const io = memoryIo({ "/r/apps/x/package.json": "{}", "/r/tools/package.json": "{}" });
    expect(await expandWorkspaceGlobs(io, "/r", ["**"])).toEqual(["apps/x", "tools"]);
  });

  it("only reads folders a pattern can match", async () => {
    const files: Record<string, string> = { "/r/apps/web/package.json": "{}", "/r/apps/api/package.json": "{}" };
    for (const dir of ["ios/Pods/A/B/C/D", "ios/Pods/E/F/G", "dist/x/y", "docs/a/b/c"]) files[`/r/${dir}/f.txt`] = "";
    const io = memoryIo(files);
    let reads = 0;
    const counting = { ...io, readDir: async (path: string) => (reads++, io.readDir(path)) };
    expect(await expandWorkspaceGlobs(counting, "/r", ["apps/**"])).toEqual(["apps/api", "apps/web"]);
    expect(reads).toBeLessThanOrEqual(4);
  });
});

describe("loadWorkspace edge cases", () => {
  it("reads the object form of npm workspaces", async () => {
    const io = memoryIo({
      "/r/package.json": pkg({ workspaces: { packages: ["packages/*"] } }),
      "/r/packages/a/package.json": pkg({ name: "a" }),
    });
    expect((await loadWorkspace(io, "/r")).importers.map((i) => i.path)).toEqual([".", "packages/a"]);
  });

  it("skips members whose package.json can't be read", async () => {
    const io = memoryIo({
      "/r/package.json": pkg({ workspaces: ["packages/*"] }),
      "/r/packages/ok/package.json": pkg({ name: "ok" }),
      "/r/packages/broken/package.json": "{ not json",
    });
    expect((await loadWorkspace(io, "/r")).importers.map((i) => i.path)).toEqual([".", "packages/ok"]);
  });

  it("rejects a root manifest whose dependencies aren't strings", async () => {
    const io = memoryIo({ "/r/package.json": pkg({ dependencies: { a: 1 } }) });
    await expect(loadWorkspace(io, "/r")).rejects.toThrow("No readable package.json");
  });

  it("takes release age and save-exact from .npmrc when the workspace file has none", async () => {
    const io = memoryIo({
      "/r/package.json": pkg({ name: "r" }),
      "/r/.npmrc": "minimum-release-age=60\nsave-exact=true\n",
    });
    const ws = await loadWorkspace(io, "/r");
    expect(ws.minimumReleaseAgeMinutes).toBe(60);
    expect(ws.saveExact).toBe(true);
  });

  it("layers the user's .npmrc under the project's", async () => {
    const io = memoryIo(
      {
        "/r/package.json": pkg({ name: "r" }),
        "/home/test/.npmrc": "registry=https://user.dev\n@acme:registry=https://acme.dev\n",
        "/r/.npmrc": "registry=https://project.dev\n",
      },
      { homeDir: "/home/test" },
    );
    const { npm } = await loadWorkspace(io, "/r");
    expect(npm.registry).toBe("https://project.dev/");
    expect(npm.scopes["@acme"]).toBe("https://acme.dev/");
  });

  it("ignores a release age that isn't a positive number and a broken workspace file", async () => {
    const io = memoryIo({
      "/r/package.json": pkg({ name: "r" }),
      "/r/pnpm-workspace.yaml": "minimumReleaseAge: soon\n",
    });
    expect((await loadWorkspace(io, "/r")).minimumReleaseAgeMinutes).toBe(0);
    const broken = memoryIo({ "/r/package.json": pkg({ name: "r" }), "/r/pnpm-workspace.yaml": "packages: [" });
    expect((await loadWorkspace(broken, "/r")).catalogs).toEqual({});
  });

  it("keeps working with a corrupt lockfile, just without installed versions", async () => {
    const io = memoryIo({ "/r/package.json": pkg({ name: "r" }), "/r/package-lock.json": "{ broken" });
    const ws = await loadWorkspace(io, "/r");
    expect(ws.lockfile.installed(".", "a")).toBeUndefined();
    expect(ws.lockfileHash).not.toBe("");
  });

  it("reads a package.json that starts with a byte-order mark", async () => {
    const io = memoryIo({ "/r/package.json": '﻿{ "name": "app" }' });
    expect((await loadWorkspace(io, "/r")).importers[0]?.manifest.name).toBe("app");
  });
});

describe("expandWorkspaceGlobs reads", () => {
  it("doesn't read inside folders no pattern can reach", async () => {
    const io = memoryIo({
      "/r/apps/web/package.json": "{}",
      "/r/apps/web/src/deep/f.txt": "",
      "/r/dist/x/y/f.txt": "",
    });
    const read: string[] = [];
    const counting = { ...io, readDir: async (path: string) => (read.push(path), io.readDir(path)) };
    expect(await expandWorkspaceGlobs(counting, "/r", ["apps/*"])).toEqual(["apps/web"]);
    expect(read.toSorted()).toEqual(["/r", "/r/apps"]);
  });

  it("still finds nested ** matches in the middle of a pattern", async () => {
    const io = memoryIo({ "/r/libs/a/b/pkg/package.json": "{}", "/r/libs/skip/package.json": "{}" });
    expect(await expandWorkspaceGlobs(io, "/r", ["libs/**/pkg"])).toEqual(["libs/a/b/pkg"]);
  });
});
