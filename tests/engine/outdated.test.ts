import { describe, expect, it } from "vitest";
import { collectCandidates, computeOutdated, peerConflicts, pickLatest } from "@/engine/outdated";
import type { Packument, RegistryClient } from "@/engine/registry";
import { loadWorkspace } from "@/engine/workspace";
import { memoryIo, packument } from "../support/memory-io";

const NOW = new Date("2026-10-31T12:00:00Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

function fakeRegistry(docs: Packument[]): RegistryClient & { fullCalls: string[]; abbreviatedCalls: string[] } {
  const byName = new Map(docs.map((d) => [d.name, d]));
  const fullCalls: string[] = [];
  const abbreviatedCalls: string[] = [];
  return {
    fullCalls,
    abbreviatedCalls,
    distTags: async (name) => byName.get(name)?.["dist-tags"],
    abbreviated: async (name) => {
      abbreviatedCalls.push(name);
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
  it("skips the package document when the installed version is already the latest", async () => {
    const ws = await workspaceWith(
      { dependencies: { react: "^18.0.0", zod: "^4.6.0" } },
      pnpmLock({ react: "18.3.1", zod: "4.6.7" }),
    );
    const registry = fakeRegistry(docs);
    const { entries } = await computeOutdated(ws, registry, { now: NOW });
    expect(entries.map((e) => e.name)).toEqual(["react"]);
    expect(registry.abbreviatedCalls).toEqual(["react"]);
  });

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

  it("fetches full metadata, for publish times, only for packages with a newer version", async () => {
    const registry = fakeRegistry(docs);
    const ws = await workspaceWith(
      { dependencies: { react: "^18.0.0", zod: "^4.6.0" } },
      pnpmLock({ react: "18.3.1", zod: "4.6.7" }),
    );
    await computeOutdated(ws, registry, { now: NOW });
    expect(registry.fullCalls).toEqual(["react"]);
  });
});

const ageYaml = (exclude: string) => ({
  "/r/pnpm-workspace.yaml": `minimumReleaseAge: 1440\nminimumReleaseAgeExclude:\n  - "${exclude}"\n`,
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
      newest: "8.3.5",
    });
  });

  it("returns the newest version when it is old enough", () => {
    expect(pickLatest(doc, "8.3.0", { pinMajor: false, minAgeMinutes: 60, now: NOW })).toEqual({
      version: "8.3.5",
      heldBackByAge: false,
    });
  });

  it("offers the newest old-enough version and says a newer one is held back", async () => {
    const ws = await workspaceWith({ dependencies: { vite: "8.3.0" } }, pnpmLock({ vite: "8.3.0" }), ageYaml("x"));
    const result = await computeOutdated(ws, fakeRegistry([doc]), { now: NOW });
    expect(result.entries).toMatchObject([{ latest: "8.3.4", heldBackByAge: true, publishedAt: daysAgo(5) }]);
    expect(result.waiting).toEqual([]);
  });

  it("lists an update whose versions are all too young as waiting, with when it becomes installable", async () => {
    const ws = await workspaceWith({ dependencies: { vite: "8.3.4" } }, pnpmLock({ vite: "8.3.4" }), ageYaml("x"));
    const result = await computeOutdated(ws, fakeRegistry([doc]), { now: NOW });
    expect(result.entries).toEqual([]);
    expect(result.waiting).toMatchObject([
      { latest: "8.3.5", heldBackByAge: false, publishedAt: daysAgo(0.2), readyAt: daysAgo(-0.8) },
    ]);
  });

  it("never offers a too-young version as the in-range target", async () => {
    const ws = await workspaceWith({ dependencies: { vite: "^8.3.0" } }, pnpmLock({ vite: "8.3.0" }), ageYaml("x"));
    const [entry] = (await computeOutdated(ws, fakeRegistry([doc]), { now: NOW })).entries;
    expect(entry?.wanted).toBe("8.3.4");
  });

  it("offers an excluded package's newest version as a plain update", async () => {
    const ws = await workspaceWith({ dependencies: { vite: "8.3.4" } }, pnpmLock({ vite: "8.3.4" }), ageYaml("vite"));
    const result = await computeOutdated(ws, fakeRegistry([doc]), { now: NOW });
    expect(result.entries).toMatchObject([{ latest: "8.3.5", heldBackByAge: false }]);
    expect(result.entries[0]?.readyAt).toBeUndefined();
    expect(result.waiting).toEqual([]);
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

describe("collectCandidates", () => {
  it("groups one package used with the same range in several importers", async () => {
    const io = memoryIo({
      "/r/package.json": JSON.stringify({ workspaces: ["a", "b"], dependencies: { zod: "^4.0.0" } }),
      "/r/a/package.json": JSON.stringify({ name: "a", dependencies: { zod: "^4.0.0" } }),
      "/r/b/package.json": JSON.stringify({ name: "b", devDependencies: { zod: "^3.0.0" } }),
    });
    const candidates = collectCandidates(await loadWorkspace(io, "/r"));
    expect(candidates.map((c) => [c.name, c.range, c.usages.map((u) => `${u.importer}:${u.field}`)])).toEqual([
      ["zod", "^4.0.0", [".:dependencies", "a:dependencies"]],
      ["zod", "^3.0.0", ["b:devDependencies"]],
    ]);
  });

  it("skips peers, even when also a devDependency, and catalog entries the catalog doesn't define", async () => {
    const ws = await workspaceWith({
      peerDependencies: { react: "^19.0.0" },
      devDependencies: { react: "^19.3.0", ghost: "catalog:" },
    });
    expect(collectCandidates(ws).map((c) => [c.name, c.range])).toEqual([["react", "^19.3.0"]]);
  });

  it("looks aliases up under the real package name", async () => {
    const ws = await workspaceWith({ dependencies: { "react-18": "npm:react@^18.0.0" } });
    expect(collectCandidates(ws)).toMatchObject([
      { name: "react", range: "^18.0.0", usages: [{ spec: "npm:react@^18.0.0" }] },
    ]);
  });

  it("leaves peer-only dependencies out of the outdated list", async () => {
    const ws = await workspaceWith({ name: "lib", peerDependencies: { react: "^18.0.0" } });
    const { entries } = await computeOutdated(ws, fakeRegistry(docs), { now: NOW });
    expect(entries).toEqual([]);
  });
});

describe("computeOutdated edge cases", () => {
  it("reports nothing for a project without dependencies", async () => {
    expect(await computeOutdated(await workspaceWith({ name: "empty" }), fakeRegistry(docs), { now: NOW })).toEqual({
      entries: [],
      waiting: [],
      errors: [],
    });
  });

  it("skips packages the registry doesn't know", async () => {
    const ws = await workspaceWith({ dependencies: { "not-on-npm": "^1.0.0" } });
    expect((await computeOutdated(ws, fakeRegistry(docs), { now: NOW })).entries).toEqual([]);
  });

  it("lists up-to-date packages too when asked", async () => {
    const ws = await workspaceWith({ dependencies: { zod: "^4.6.0" } }, pnpmLock({ zod: "4.6.7" }));
    const { entries } = await computeOutdated(ws, fakeRegistry(docs), { now: NOW, includeUpToDate: true });
    expect(entries).toMatchObject([{ name: "zod", current: "4.6.7", latest: "4.6.7", bump: "none" }]);
  });

  it("reports the newest version the range allows as wanted", async () => {
    const ws = await workspaceWith({ dependencies: { react: "^18.0.0" } }, pnpmLock({ react: "18.3.1" }));
    const { entries } = await computeOutdated(ws, fakeRegistry(docs), { now: NOW });
    expect(entries).toMatchObject([{ name: "react", wanted: "18.3.1", latest: "19.3.1", bump: "major" }]);
  });

  it("reports the latest version's peers for the conflict check", async () => {
    const ws = await workspaceWith({ dependencies: { react: "^18.0.0" } }, pnpmLock({ react: "18.3.1" }));
    const [entry] = (await computeOutdated(ws, fakeRegistry(docs), { now: NOW })).entries;
    expect(entry?.peerDependencies).toEqual({});
  });

  it("can pin other packages to their major", async () => {
    const ws = await workspaceWith({ dependencies: { react: "^18.0.0" } }, pnpmLock({ react: "18.3.1" }));
    const { entries } = await computeOutdated(ws, fakeRegistry(docs), { now: NOW, majorPins: ["react"] });
    expect(entries).toEqual([]);
  });
});

describe("pickLatest edge cases", () => {
  const doc = packument(
    "a",
    {
      "1.0.0": { time: daysAgo(30) },
      "1.1.0": { time: daysAgo(10), deprecated: "broken" },
      "1.2.0": { time: daysAgo(0.1) },
      "2.0.0-rc.1": { time: daysAgo(20) },
    },
    { latest: "1.2.0", next: "2.0.0-rc.1" },
  );
  it("skips deprecated versions when holding back, and never offers a prerelease to a stable user", () => {
    expect(pickLatest(doc, "1.0.0", { pinMajor: false, minAgeMinutes: 1440, now: NOW })).toEqual({
      version: "1.0.0",
      heldBackByAge: true,
      newest: "1.2.0",
    });
  });

  it("follows a prerelease user's channel when the dist-tag has another name", () => {
    expect(pickLatest(doc, "2.0.0-rc.0", { pinMajor: false, minAgeMinutes: 0, now: NOW })).toEqual({
      version: "2.0.0-rc.1",
      heldBackByAge: false,
    });
  });

  it("moves a prerelease user to a newer stable release", () => {
    const released = packument("c", { "2.0.0-rc.1": {}, "2.0.0": {} }, { latest: "2.0.0", rc: "2.0.0-rc.1" });
    expect(pickLatest(released, "2.0.0-rc.0", { pinMajor: false, minAgeMinutes: 0, now: NOW }).version).toBe("2.0.0");
  });

  it("ignores release age when the registry sent no publish times", () => {
    expect(
      pickLatest({ ...doc, time: undefined }, "1.0.0", { pinMajor: false, minAgeMinutes: 1440, now: NOW }),
    ).toEqual({
      version: "1.2.0",
      heldBackByAge: false,
    });
  });

  it("falls back to the newest version when there is no latest tag", () => {
    const untagged = packument("b", { "1.0.0": {}, "3.0.0": {} }, {});
    expect(pickLatest(untagged, undefined, { pinMajor: false, minAgeMinutes: 0, now: NOW }).version).toBe("3.0.0");
  });
});
