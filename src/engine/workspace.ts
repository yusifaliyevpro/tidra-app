import * as z from "@zod/mini";
import { parse as parseYaml } from "yaml";
import { createHashCache, fingerprint, sha256 } from "./fingerprint";
import type { Io } from "./io";
import { EMPTY_LOCKFILE, LOCKFILE_PARSERS, type Lockfile } from "./lockfile";
import { emptyConfig, parseNpmrc, type NpmConfig } from "./npmrc";
import { dirname, join, normalize, relative } from "./path";

export type PackageManagerName = "pnpm" | "npm" | "yarn" | "bun";

export interface PackageManager {
  name: PackageManagerName;
  version?: string;
  yarnBerry: boolean;
  /** Absolute path of the lockfile in use, if any. */
  lockfile?: string;
}

export const DEP_FIELDS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const;
export type DepField = (typeof DEP_FIELDS)[number];

const StringMap = z.optional(z.record(z.string(), z.string()));

const ManifestSchema = z.compile(
  z.looseObject({
    name: z.optional(z.string()),
    version: z.optional(z.string()),
    private: z.optional(z.boolean()),
    packageManager: z.optional(z.string()),
    scripts: StringMap,
    workspaces: z.optional(
      z.union([z.array(z.string()), z.looseObject({ packages: z.optional(z.array(z.string())) })]),
    ),
    devEngines: z.optional(z.looseObject({ packageManager: z.optional(z.unknown()) })),
    engines: z.optional(z.unknown()),
    dependencies: StringMap,
    devDependencies: StringMap,
    optionalDependencies: StringMap,
    peerDependencies: StringMap,
  }),
);

export type Manifest = z.infer<typeof ManifestSchema>;

const WorkspaceYamlSchema = z.compile(
  z.looseObject({
    packages: z.optional(z.array(z.string())),
    catalog: StringMap,
    catalogs: z.optional(z.record(z.string(), z.record(z.string(), z.string()))),
    minimumReleaseAge: z.optional(z.union([z.number(), z.string()])),
    minimumReleaseAgeExclude: z.optional(z.array(z.string())),
    saveExact: z.optional(z.boolean()),
  }),
);

type WorkspaceYaml = z.infer<typeof WorkspaceYamlSchema>;

const DevEnginesPm = z.compile(z.looseObject({ name: z.optional(z.string()), version: z.optional(z.string()) }));

export interface Importer {
  /** Relative to the workspace root, "." for the root package. */
  path: string;
  manifestPath: string;
  manifest: Manifest;
  manifestText: string;
}

export interface Workspace {
  root: string;
  pm: PackageManager;
  importers: Importer[];
  catalogs: Record<string, Record<string, string>>;
  /** Raw pnpm-workspace.yaml, kept for comment-preserving edits. */
  workspaceYaml?: { path: string; text: string };
  minimumReleaseAgeMinutes: number;
  minimumReleaseAgeExclude: string[];
  saveExact: boolean;
  npm: NpmConfig;
  lockfile: Lockfile;
  /** SHA-256 over every manifest, the workspace file, npm config and lockfile: unchanged means same results. */
  fingerprint: string;
  /** SHA-256 of the lockfile alone; what security scans depend on. */
  lockfileHash: string;
}

/** Parsing a big lockfile is the slowest part of loading; the same bytes never parse twice. */
const parsedLockfiles = createHashCache<Lockfile>(48);

const LOCKFILES: [string, PackageManagerName][] = [
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["pnpm-lock.yaml", "pnpm"],
  ["pnpm-workspace.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["package-lock.json", "npm"],
  ["npm-shrinkwrap.json", "npm"],
];

const PM_NAMES: readonly string[] = ["pnpm", "npm", "yarn", "bun"] satisfies PackageManagerName[];
const isPmName = (value: string | undefined): value is PackageManagerName => PM_NAMES.includes(value ?? "");

function fromField(value: string | undefined): { name: PackageManagerName; version?: string } | undefined {
  const match = value ? /^(\w+)(?:@([^+\s]+))?/.exec(value) : null;
  const name = match?.[1];
  return isPmName(name) ? { name, version: match?.[2] } : undefined;
}

/** `packageManager`, then `devEngines.packageManager`, then the nearest lockfile walking up; npm otherwise. */
export async function detectPackageManager(io: Io, root: string, manifest: Manifest): Promise<PackageManager> {
  const devEngines = manifest.devEngines?.packageManager;
  const engine = z.validate(DevEnginesPm, devEngines) ? devEngines : undefined;
  const declared = fromField(manifest.packageManager) ?? fromField(engine?.name);
  const declaredVersion = declared?.version ?? engine?.version;
  let lockfile: string | undefined;
  let found: PackageManagerName | undefined;
  for (let dir = normalize(root); ; dir = dirname(dir)) {
    for (const [file, pm] of LOCKFILES) {
      if ((declared && declared.name !== pm) || !(await io.exists(join(dir, file)))) continue;
      found ??= pm;
      if (!file.endsWith("workspace.yaml")) lockfile = join(dir, file);
      break;
    }
    if (found || dirname(dir) === dir) break;
  }
  const name = declared?.name ?? found ?? "npm";
  const yarnBerry = name === "yarn" && (await io.exists(join(root, ".yarnrc.yml")));
  return { name, version: declaredVersion, yarnBerry, lockfile };
}

function globToRegExp(glob: string): RegExp {
  const pattern = normalize(glob)
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\/\*\*$/, "\u0001")
    .replace(/\*\*\//g, "\u0000")
    .replace(/\*\*?/g, "[^/]*")
    .replaceAll("\u0000", "(?:.*/)?")
    .replaceAll("\u0001", "(?:/.*)?");
  return new RegExp(`^${pattern}/?$`);
}

/** Expands workspace globs by walking only as deep as the patterns need, skipping node_modules. */
export async function expandWorkspaceGlobs(io: Io, root: string, globs: string[]): Promise<string[]> {
  const include = globs.filter((g) => !g.startsWith("!")).map(globToRegExp);
  const exclude = globs.filter((g) => g.startsWith("!")).map((g) => globToRegExp(g.slice(1)));
  const deep = globs.some((g) => g.includes("**"));
  const maxDepth = deep ? 6 : Math.max(1, ...globs.map((g) => normalize(g.replace(/^!/, "")).split("/").length));
  const results: string[] = [];

  const walk = async (rel: string, depth: number): Promise<void> => {
    if (depth > maxDepth) return;
    const dirs = (await io.readDir(join(root, rel))).filter(
      (entry) => entry.isDir && entry.name !== "node_modules" && !entry.name.startsWith("."),
    );
    await Promise.all(
      dirs.map(async (entry) => {
        const child = rel === "." ? entry.name : `${rel}/${entry.name}`;
        const matches = include.some((r) => r.test(child)) && !exclude.some((r) => r.test(child));
        if (matches && (await io.exists(join(root, child, "package.json")))) results.push(child);
        await walk(child, depth + 1);
      }),
    );
  };
  await walk(".", 1);
  return results.toSorted();
}

async function readManifest(io: Io, path: string): Promise<{ value: Manifest; text: string } | undefined> {
  const text = await io.readText(path);
  if (text === null) return undefined;
  try {
    const value: unknown = JSON.parse(text);
    return z.validate(ManifestSchema, value) ? { value, text } : undefined;
  } catch {
    return undefined;
  }
}

function readWorkspaceYaml(text: string | null): WorkspaceYaml {
  if (!text) return {};
  try {
    const value: unknown = parseYaml(text);
    return z.validate(WorkspaceYamlSchema, value) ? value : {};
  } catch {
    return {};
  }
}

function parseMinutes(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

export async function loadNpmConfig(io: Io, root: string): Promise<NpmConfig> {
  // User file first, then the project file, so project settings win.
  const texts = await Promise.all([io.readText(join(io.homeDir, ".npmrc")), io.readText(join(root, ".npmrc"))]);
  return texts.reduce((config, text) => (text === null ? config : parseNpmrc(text, io.env, config)), emptyConfig());
}

export async function loadWorkspace(io: Io, rootPath: string): Promise<Workspace> {
  const root = normalize(rootPath);
  const rootManifest = await readManifest(io, join(root, "package.json"));
  if (!rootManifest) throw new Error(`No readable package.json in ${root}`);
  const yamlPath = join(root, "pnpm-workspace.yaml");
  const [pm, npm, yamlText] = await Promise.all([
    detectPackageManager(io, root, rootManifest.value),
    loadNpmConfig(io, root),
    io.readText(yamlPath),
  ]);
  const yaml = readWorkspaceYaml(yamlText);

  const globs = yaml.packages
    ? yaml.packages
    : Array.isArray(rootManifest.value.workspaces)
      ? rootManifest.value.workspaces
      : (rootManifest.value.workspaces?.packages ?? []);

  const importers: Importer[] = [
    {
      path: ".",
      manifestPath: join(root, "package.json"),
      manifest: rootManifest.value,
      manifestText: rootManifest.text,
    },
  ];
  const members = (await expandWorkspaceGlobs(io, root, globs)).filter((rel) => rel !== ".");
  const manifests = await Promise.all(members.map((rel) => readManifest(io, join(root, rel, "package.json"))));
  for (const [index, rel] of members.entries()) {
    const manifest = manifests[index];
    if (manifest) {
      importers.push({
        path: rel,
        manifestPath: join(root, rel, "package.json"),
        manifest: manifest.value,
        manifestText: manifest.text,
      });
    }
  }

  const catalogs: Record<string, Record<string, string>> = { ...yaml.catalogs };
  if (yaml.catalog) catalogs.default = yaml.catalog;

  let lockfile = EMPTY_LOCKFILE;
  let lockfileText: string | null = null;
  let lockfileHash = "";
  if (pm.lockfile) {
    const parser = LOCKFILE_PARSERS[pm.lockfile.slice(pm.lockfile.lastIndexOf("/") + 1)];
    lockfileText = parser ? await io.readText(pm.lockfile) : null;
    if (parser && lockfileText !== null) {
      lockfileHash = await sha256(lockfileText);
      const hit = parsedLockfiles.get(`${pm.lockfile}:${lockfileHash}`);
      if (hit) lockfile = hit;
      else {
        try {
          lockfile = parser(lockfileText);
        } catch {
          lockfile = EMPTY_LOCKFILE;
        }
        parsedLockfiles.set(`${pm.lockfile}:${lockfileHash}`, lockfile);
      }
    }
    // A lockfile above the project root (monorepo checkout) keys importers relative to its own folder.
    const lockRoot = dirname(pm.lockfile);
    if (lockRoot !== root) {
      const offset = relative(lockRoot, root);
      const inner = lockfile;
      lockfile = {
        packages: inner.packages,
        installed: (importer, name, spec) =>
          inner.installed(importer === "." ? offset : `${offset}/${importer}`, name, spec),
      };
    }
  }

  const hash = await fingerprint([
    ...importers.flatMap((i) => [i.path, i.manifestText]),
    yamlText,
    JSON.stringify(npm),
    JSON.stringify(pm),
    lockfileText,
  ]);

  return {
    root,
    pm,
    importers,
    catalogs,
    workspaceYaml: yamlText === null ? undefined : { path: yamlPath, text: yamlText },
    minimumReleaseAgeMinutes: parseMinutes(yaml.minimumReleaseAge ?? npm.values["minimum-release-age"]),
    minimumReleaseAgeExclude: yaml.minimumReleaseAgeExclude ?? [],
    saveExact: yaml.saveExact === true || npm.values["save-exact"] === "true",
    npm,
    lockfile,
    fingerprint: hash,
    lockfileHash,
  };
}
