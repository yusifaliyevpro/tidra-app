import { describe, expect, it } from "vitest";
import { computeOutdated, peerConflicts, pickLatest } from "@/engine/outdated";
import type { Packument, RegistryClient } from "@/engine/registry";
import { loadWorkspace } from "@/engine/workspace";
import { memoryIo, packument } from "../support/memory-io";

const NOW = new Date("2026-10-31T12:00:00Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

function fakeRegistry(docs: Packument[]): RegistryClient & { fullCalls: string[] } {
  const byName = new Map(docs.map((d) => [d.name, d]));
  const fullCalls: string[] = [];
  return {
    fullCalls,
    abbreviated: async (name) => {
      const doc = byName.get(name);
      return doc ? { ...doc, time: undefined } : null;
    },
    full: async (name) => {
      fullCalls.push(name);
      return byName.get(name) ?? null;
    },
  };
}

const docs: Packument[] = [
  packument("react", { "18.3.1": {}, "19.0.0": {}, "19.3.1": { peerDependencies: {} } }, { latest: "19.3.1" }),
  packument("zod", { "4.6.0": {}, "4.6.7": {} }, { latest: "4.6.7" }),
  packument("@types/node", { "24.0.0": {}, "24.5.0": {}, "26.1.0": {} }, { latest: "26.1.0" }),
  packument(
    "next",
    { "15.0.5": {}, "15.1.0-canary.1": {}, "15.1.0-canary.3": {} },
    { latest: "15.0.5", canary: "15.1.0-canary.3" },
  ),
  packument("left-pad", { "1.0.0": { deprecated: "use String.padStart" }, "1.3.0": {} }, { latest: "1.3.0" }),
  packument("shared", { "9.0.0": {} }, { latest: "9.0.0" }),
];

async function workspaceWith(manifest: object, lock = "", extraFiles: Record<string, string> = {}) {
  const io = memoryIo({
    "/r/package.json": JSON.stringify(manifest),
    ...(lock ? { "/r/pnpm-lock.yaml": lock } : {}),
    ...extraFiles,
  });
  return loadWorkspace(io, "/r");
}

const pnpmLock = (deps: Record<string, string>) =>
  `lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n${Object.entries(deps)
    .map(([n, v]) => `      '${n}':\n        specifier: x\n        version: ${v}\n`)
    .join("")}`;

describe("computeOutdated", () => {
  it("uses the installed version from the lockfile, not the range floor", async () => {
    const ws = await workspaceWith(
      { dependencies: { react: "^18.0.0", zod: "^4.6.0" } },
      pnpmLock({ react: "18.3.1", zod: "4.6.7" }),
    );
    const { entries } = await computeOutdated(ws, fakeRegistry(docs), { now: NOW });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      name: "react",
      current: "18.3.1",
      currentFromLockfile: true,
      wanted: "18.3.1",
      latest: "19.3.1",
      bump: "major",
    });
  });

  it("falls back to the range floor without a lockfile", async () => {
    const ws = await workspaceWith({ dependencies: { zod: "^4.6.0" } });
    const { entries } = await computeOutdated(ws, fakeRegistry(docs), { now: NOW });
    expect(entries[0]).toMatchObject({ current: "4.6.0", currentFromLockfile: false, bump: "patch" });
  });

  it("keeps @types/node within its major", async () => {
    const ws = await workspaceWith(
      { devDependencies: { "@types/node": "^24.0.0" } },
      pnpmLock({ "@types/node": "24.0.0" }),
    );
    const { entries } = await computeOutdated(ws, fakeRegistry(docs), { now: NOW });
    expect(entries[0]).toMatchObject({ latest: "24.5.0", bump: "minor" });
  });

  it("follows the prerelease channel", async () => {
    const ws = await workspaceWith({ dependencies: { next: "15.1.0-canary.1" } });
    const { entries } = await computeOutdated(ws, fakeRegistry(docs), { now: NOW });
    expect(entries[0]).toMatchObject({ latest: "15.1.0-canary.3", bump: "prerelease" });
  });

  it("never looks up workspace packages or non-registry specs", async () => {
    const io = memoryIo({
      "/r/package.json": JSON.stringify({
        workspaces: ["packages/*"],
        dependencies: { shared: "workspace:^1.0.0", local: "file:../x", gh: "github:o/r" },
      }),
      "/r/packages/shared/package.json": JSON.stringify({ name: "shared", dependencies: {} }),
    });
    const registry = fakeRegistry(docs);
    const { entries } = await computeOutdated(await loadWorkspace(io, "/r"), registry, { now: NOW });
    expect(entries).toEqual([]);
  });

  it("resolves catalog ranges and reports the catalog", async () => {
    const ws = await workspaceWith({ dependencies: { zod: "catalog:" } }, "", {
      "/r/pnpm-workspace.yaml": "catalog:\n  zod: ^4.6.0\n",
    });
    const { entries } = await computeOutdated(ws, fakeRegistry(docs), { now: NOW });
    expect(entries[0]).toMatchObject({ name: "zod", catalog: "default", range: "^4.6.0" });
  });

  it("flags deprecated installed versions", async () => {
    const ws = await workspaceWith({ dependencies: { "left-pad": "1.0.0" } });
    const { entries } = await computeOutdated(ws, fakeRegistry(docs), { now: NOW });
    expect(entries[0]?.deprecated).toBe("use String.padStart");
  });

  it("reports registry failures per package without failing the rest", async () => {
    const registry = fakeRegistry(docs);
    registry.abbreviated = async (name) => {
      if (name === "zod") throw new Error("HTTP 500");
      return docs.find((d) => d.name === name) ?? null;
    };
    const ws = await workspaceWith({ dependencies: { zod: "^4.6.0", react: "^18.0.0" } });
    const result = await computeOutdated(ws, registry, { now: NOW });
    expect(result.errors).toEqual([{ name: "zod", message: "HTTP 500" }]);
    expect(result.entries.map((e) => e.name)).toEqual(["react"]);
  });

  it("only fetches full metadata when release age matters", async () => {
    const registry = fakeRegistry(docs);
    await computeOutdated(await workspaceWith({ dependencies: { react: "^18.0.0" } }), registry, { now: NOW });
    expect(registry.fullCalls).toEqual([]);
  });
});

describe("pickLatest with minimumReleaseAge", () => {
  const doc = packument(
    "vite",
    { "8.3.4": { time: daysAgo(5) }, "8.3.5": { time: daysAgo(0.2) }, "9.0.0-beta.1": { time: daysAgo(3) } },
    { latest: "8.3.5", beta: "9.0.0-beta.1" },
  );

  it("holds back versions younger than the minimum age", () => {
    expect(pickLatest(doc, "8.3.0", { pinMajor: false, minAgeMinutes: 1440, now: NOW })).toEqual({
      version: "8.3.4",
      heldBackByAge: true,
    });
  });

  it("returns the newest version when it is old enough", () => {
    expect(pickLatest(doc, "8.3.0", { pinMajor: false, minAgeMinutes: 60, now: NOW })).toEqual({
      version: "8.3.5",
      heldBackByAge: false,
    });
  });
});

const INSTALLED: Record<string, string> = { react: "18.3.1", vite: "8.3.5" };

describe("peerConflicts", () => {
  it("lists peers the project does not satisfy", () => {
    expect(peerConflicts({ react: "^19.0.0", vite: "^8.0.0" }, (name) => INSTALLED[name])).toEqual([
      { peer: "react", range: "^19.0.0", installed: "18.3.1" },
    ]);
  });
});
