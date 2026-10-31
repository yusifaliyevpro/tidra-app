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
