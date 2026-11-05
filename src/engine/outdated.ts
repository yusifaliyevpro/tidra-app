import semver from "semver";
import type { Packument, RegistryClient } from "./registry";
import { parseSpec, type DependencySpec } from "./spec";
import { classifyBump, latestInMajor, prereleaseChannel, sortVersionsDesc, type Bump } from "./versions";
import { DEP_FIELDS, type DepField, type Workspace } from "./workspace";

export interface Usage {
  importer: string;
  field: DepField;
  /** The value written in package.json, e.g. `^1.2.0` or `catalog:`. */
  spec: string;
}

export interface OutdatedEntry {
  /** Registry name (alias target for `npm:` specs). */
  name: string;
  usages: Usage[];
  /** Catalog that owns the range, when the dependency is declared through `catalog:`. */
  catalog?: string;
  range: string;
  current?: string;
  /** False when no lockfile entry was found and `current` is the floor of the range. */
  currentFromLockfile: boolean;
  wanted?: string;
  latest: string;
  bump: Bump;
  deprecated?: string;
  /** Newer versions skipped because they are younger than the project's minimum release age. */
  heldBackByAge: boolean;
  enginesNode?: string;
  peerDependencies?: Record<string, string>;
}

export interface OutdatedOptions {
  /** Packages that never get a major suggestion; maps to their pinned behaviour. */
  majorPins?: string[];
  now?: Date;
  includeUpToDate?: boolean;
}

export const DEFAULT_MAJOR_PINS = ["@types/node"];

interface Candidate {
  name: string;
  range: string;
  catalog?: string;
  usages: Usage[];
  current?: string;
}

type RangeSpec = Extract<DependencySpec, { kind: "range" }>;

/** Groups every registry dependency across importers by (name, effective range, catalog). */
export function collectCandidates(workspace: Workspace): Candidate[] {
  const local = new Set(workspace.importers.map((i) => i.manifest.name).filter(Boolean));
  const byKey = new Map<string, Candidate>();

  for (const importer of workspace.importers) {
    for (const field of DEP_FIELDS) {
      for (const [key, raw] of Object.entries(importer.manifest[field] ?? {})) {
        // Peer ranges describe consumers and updates never touch them, so they aren't this project's updates.
        if (field === "peerDependencies") continue;
        let spec = parseSpec(key, raw);
        let catalog: string | undefined;
        if (spec.kind === "catalog") {
          catalog = spec.catalog;
          const range = workspace.catalogs[catalog]?.[key];
          if (!range) continue;
          spec = parseSpec(key, range);
        }
        if (spec.kind !== "range" || local.has(spec.name)) continue;
        const rangeSpec: RangeSpec = spec;
        const mapKey = `${rangeSpec.name}\u0000${rangeSpec.range}\u0000${catalog ?? ""}`;
        const candidate = byKey.get(mapKey) ?? { name: rangeSpec.name, range: rangeSpec.range, catalog, usages: [] };
        candidate.usages.push({ importer: importer.path, field, spec: raw });
        candidate.current ??= workspace.lockfile.installed(importer.path, key, raw);
        byKey.set(mapKey, candidate);
      }
    }
  }
  return [...byKey.values()].toSorted((a, b) => a.name.localeCompare(b.name));
}

function nodeEngine(engines: unknown): string | undefined {
  if (typeof engines !== "object" || engines === null || !("node" in engines)) return undefined;
  return typeof engines.node === "string" ? engines.node : undefined;
}

function deprecationOf(packument: Packument, version: string | undefined): string | undefined {
  const value = version ? packument.versions[version]?.deprecated : undefined;
  return typeof value === "string" && value ? value : value === true ? "Deprecated" : undefined;
}

/** A prerelease user's next version: the tag named after their channel, or any tag on it (rc builds under `next`). */
function channelTarget(tags: Record<string, string>, channel: string): string | undefined {
  if (tags[channel]) return tags[channel];
  return sortVersionsDesc(Object.values(tags)).find((version) => prereleaseChannel(version) === channel);
}

const newerOf = (a: string | undefined, b: string | undefined) =>
  a && b && semver.valid(a) && semver.valid(b) ? (semver.gt(a, b) ? a : b) : (a ?? b);

/** Picks the newest version this project may install: channel-aware, pinned majors, and old enough. */
export function pickLatest(
  packument: Packument,
  current: string | undefined,
  options: { pinMajor: boolean; minAgeMinutes: number; now: Date },
): { version: string | undefined; heldBackByAge: boolean } {
  const tags = packument["dist-tags"];
  const channel = current ? prereleaseChannel(current) : undefined;
  const newest = tags.latest || sortVersionsDesc(Object.keys(packument.versions))[0];
  let target = channel ? newerOf(channelTarget(tags, channel), newest) : newest;
  if (
    target &&
    current &&
    options.pinMajor &&
    semver.valid(current) &&
    semver.major(target) !== semver.major(current)
  ) {
    target = latestInMajor(Object.keys(packument.versions), semver.major(current)) ?? current;
  }
  if (!target || options.minAgeMinutes <= 0 || !packument.time) return { version: target, heldBackByAge: false };

  const cutoff = options.now.getTime() - options.minAgeMinutes * 60_000;
  const oldEnough = (v: string) => {
    const published = packument.time?.[v];
    return published !== undefined && Date.parse(published) <= cutoff;
  };
  if (oldEnough(target)) return { version: target, heldBackByAge: false };

  const stableOnly = !semver.prerelease(target);
  const fallback = sortVersionsDesc(Object.keys(packument.versions)).find(
    (v) =>
      semver.lte(v, target) &&
      (!stableOnly || !semver.prerelease(v)) &&
      (!options.pinMajor || !current || semver.major(v) === semver.major(target)) &&
      !packument.versions[v]?.deprecated &&
      oldEnough(v),
  );
  return { version: fallback, heldBackByAge: true };
}

/**
 * Most dependencies are up to date, and their dist-tags say so in a few bytes, sparing a document that can be tens
 * of MB. Prerelease channels and major pins need the version list, so they always take the long way.
 */
async function onLatest(registry: RegistryClient, name: string, current: string | undefined, pins: Set<string>) {
  if (!current || semver.prerelease(current) || pins.has(name)) return false;
  const latest = (await registry.distTags(name))?.latest;
  return latest !== undefined && semver.valid(latest) !== null && semver.gte(current, latest);
}

export async function computeOutdated(
  workspace: Workspace,
  registry: RegistryClient,
  options: OutdatedOptions = {},
): Promise<{ entries: OutdatedEntry[]; errors: { name: string; message: string }[] }> {
  const pins = new Set(options.majorPins ?? DEFAULT_MAJOR_PINS);
  const now = options.now ?? new Date();
  const ageExclude = new Set(workspace.minimumReleaseAgeExclude.map((e) => e.replace(/@[^@/]*$/, "")));
  const errors: { name: string; message: string }[] = [];

  const results = await Promise.all(
    collectCandidates(workspace).map(async (candidate): Promise<OutdatedEntry | undefined> => {
      try {
        const current = candidate.current ?? semver.minVersion(candidate.range)?.version;
        if (!options.includeUpToDate && (await onLatest(registry, candidate.name, current, pins))) return undefined;
        const abbreviated = await registry.abbreviated(candidate.name);
        if (!abbreviated) return undefined;
        const minAge = ageExclude.has(candidate.name) ? 0 : workspace.minimumReleaseAgeMinutes;
        const pinMajor = pins.has(candidate.name);
        const quick = pickLatest(abbreviated, current, { pinMajor, minAgeMinutes: 0, now });
        const needsFull = minAge > 0 && quick.version !== undefined && quick.version !== current;
        const packument = needsFull ? ((await registry.full(candidate.name)) ?? abbreviated) : abbreviated;
        const { version: latest, heldBackByAge } = needsFull
          ? pickLatest(packument, current, { pinMajor, minAgeMinutes: minAge, now })
          : quick;
        if (!latest) return undefined;

        const bump = current ? classifyBump(current, latest) : "none";
        if (bump === "none" && !options.includeUpToDate) return undefined;
        const wanted = semver.maxSatisfying(Object.keys(packument.versions), candidate.range) ?? undefined;
        const meta = packument.versions[latest];
        return {
          name: candidate.name,
          usages: candidate.usages,
          catalog: candidate.catalog,
          range: candidate.range,
          current,
          currentFromLockfile: candidate.current !== undefined,
          wanted,
          latest,
          bump,
          deprecated: deprecationOf(packument, current),
          heldBackByAge,
          enginesNode: nodeEngine(meta?.engines),
          peerDependencies: meta?.peerDependencies,
        };
      } catch (error) {
        errors.push({ name: candidate.name, message: error instanceof Error ? error.message : String(error) });
        return undefined;
      }
    }),
  );
  return { entries: results.filter((e): e is OutdatedEntry => e !== undefined), errors };
}

export interface PeerConflict {
  peer: string;
  range: string;
  installed: string;
}

/** Peers the target version requires that the project's installed versions do not satisfy. */
export function peerConflicts(
  peers: Record<string, string> | undefined,
  installed: (name: string) => string | undefined,
): PeerConflict[] {
  return Object.entries(peers ?? {}).flatMap(([peer, range]) => {
    const version = installed(peer);
    return version && !semver.satisfies(version, range, { includePrerelease: true })
      ? [{ peer, range, installed: version }]
      : [];
  });
}
