import { parse as parseJsonc } from "jsonc-parser";
import { parse as parseYaml } from "yaml";

export interface LockedPackage {
  name: string;
  version: string;
  /** True when only reachable through devDependencies; unknown formats report false. */
  dev: boolean;
}

export interface Lockfile {
  /** Installed version of `name` for the workspace package at `importer` ("." for the root). */
  installed(importer: string, name: string, spec?: string): string | undefined;
  packages: LockedPackage[];
}

export const EMPTY_LOCKFILE: Lockfile = { installed: () => undefined, packages: [] };

type Rec = Record<string, unknown>;
const isRec = (value: unknown): value is Rec => typeof value === "object" && value !== null && !Array.isArray(value);
const rec = (value: unknown): Rec => (isRec(value) ? value : {});

/** `name@1.2.3(peer@1)` → [name, 1.2.3]; scoped names keep their leading @. */
function splitKey(key: string): [string, string] {
  const clean = key.replace(/^\//, "").replace(/\(.*$/, "");
  const at = clean.lastIndexOf("@");
  return at > 0 ? [clean.slice(0, at), clean.slice(at + 1)] : [clean, ""];
}

const stripPeers = (version: string) => version.replace(/\(.*$/, "");

export function parsePnpmLock(text: string): Lockfile {
  const doc = rec(parseYaml(text));
  const importers = rec(doc.importers);
  const snapshots = rec(doc.snapshots ?? doc.packages);
  const versions = new Map<string, Map<string, string>>();
  const prodRoots: string[] = [];
  const devRoots: string[] = [];

  for (const [importer, value] of Object.entries(importers)) {
    const map = new Map<string, string>();
    for (const field of ["dependencies", "devDependencies", "optionalDependencies"] as const) {
      for (const [name, dep] of Object.entries(rec(rec(value)[field]))) {
        const version = String(rec(dep).version ?? dep);
        if (version.startsWith("link:")) continue;
        map.set(name, stripPeers(version));
        (field === "devDependencies" ? devRoots : prodRoots).push(`${name}@${version}`);
      }
    }
    versions.set(importer, map);
  }

  const reachable = (roots: string[]) => {
    const seen = new Set<string>();
    const stack = [...roots];
    while (stack.length > 0) {
      const key = stack.pop()!;
      if (seen.has(key)) continue;
      seen.add(key);
      const snapshot = rec(snapshots[key]);
      for (const field of ["dependencies", "optionalDependencies"]) {
        for (const [name, version] of Object.entries(rec(snapshot[field]))) stack.push(`${name}@${String(version)}`);
      }
    }
    return seen;
  };
  const prod = new Set([...reachable(prodRoots)].map((key) => key.replace(/\(.*$/, "")));

  const packages = new Map<string, LockedPackage>();
  for (const key of Object.keys(rec(doc.packages))) {
    const [name, version] = splitKey(key);
    if (!version) continue;
    packages.set(`${name}@${version}`, { name, version, dev: !prod.has(`${name}@${version}`) });
  }

  return {
    installed: (importer, name) => versions.get(importer)?.get(name),
    packages: [...packages.values()],
  };
}

export function parseNpmLock(text: string): Lockfile {
  const doc = rec(JSON.parse(text));
  const entries = rec(doc.packages);
  const packages: LockedPackage[] = [];
  for (const [path, value] of Object.entries(entries)) {
    const index = path.lastIndexOf("node_modules/");
    const entry = rec(value);
    if (index < 0 || entry.link === true || typeof entry.version !== "string") continue;
    packages.push({ name: path.slice(index + 13), version: entry.version, dev: entry.dev === true });
  }
  return {
    installed(importer, name) {
      const base = importer === "." ? "" : `${importer}/`;
      const own = rec(entries[`${base}node_modules/${name}`]).version ?? rec(entries[`node_modules/${name}`]).version;
      return typeof own === "string" ? own : undefined;
    },
    packages,
  };
}

/** yarn classic (`version "1.2.3"`) and berry (`version: 1.2.3`) share a key layout close enough to parse together. */
export function parseYarnLock(text: string): Lockfile {
  const bySpec = new Map<string, string>();
  const packages = new Map<string, LockedPackage>();
  let specs: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith(" ") && line.trimEnd().endsWith(":") && !line.startsWith("#")) {
      specs = line
        .slice(0, -1)
        .split(",")
        .map((s) => s.trim().replace(/^"|"$/g, ""));
      continue;
    }
    const match = /^\s+version:?\s+"?([^"\s]+)"?/.exec(line);
    if (!match?.[1] || specs.length === 0) continue;
    const version = match[1];
    for (const spec of specs) {
      bySpec.set(spec.replace("@npm:", "@"), version);
      const at = spec.indexOf("@", 1);
      const name = at > 0 ? spec.slice(0, at) : spec;
      if (name !== "__metadata") packages.set(`${name}@${version}`, { name, version, dev: false });
    }
    specs = [];
  }
  return {
    installed: (_importer, name, spec) => (spec ? bySpec.get(`${name}@${spec}`) : undefined),
    packages: [...packages.values()],
  };
}

export function parseBunLock(text: string): Lockfile {
  const doc = rec(parseJsonc(text, [], { allowTrailingComma: true }));
  const entries = rec(doc.packages);
  const top = new Map<string, string>();
  const packages = new Map<string, LockedPackage>();
  for (const [key, value] of Object.entries(entries)) {
    const ident = Array.isArray(value) ? value[0] : undefined;
    if (typeof ident !== "string") continue;
    const [name, version] = splitKey(ident);
    if (!version || version.startsWith("workspace:")) continue;
    if (!key.includes("/") || (key.startsWith("@") && key.split("/").length === 2)) top.set(name, version);
    packages.set(`${name}@${version}`, { name, version, dev: false });
  }
  return { installed: (_importer, name) => top.get(name), packages: [...packages.values()] };
}

export const LOCKFILE_PARSERS: Record<string, (text: string) => Lockfile> = {
  "pnpm-lock.yaml": parsePnpmLock,
  "package-lock.json": parseNpmLock,
  "npm-shrinkwrap.json": parseNpmLock,
  "yarn.lock": parseYarnLock,
  "bun.lock": parseBunLock,
};
