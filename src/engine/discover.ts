import type { Io } from "./io";
import { basename, dirname, join, normalize, relative } from "./path";

const SKIP_DIRS = new Set(["node_modules", "dist", "build", "out", "target", "coverage", "vendor"]);
const MAX_DEPTH = 4;

export interface FoundProject {
  path: string;
  /** Git repository root, when the folder is inside one. */
  repoRoot?: string;
  /** Path inside the repo (`apps/web`), empty for the repo root. */
  subdir: string;
}

/** Nearest ancestor (or the folder itself) holding `.git`; a file there marks a worktree or submodule. */
export async function findRepoRoot(io: Io, path: string): Promise<string | undefined> {
  for (let dir = normalize(path); ; dir = dirname(dir)) {
    if (await io.exists(join(dir, ".git"))) return dir;
    if (dirname(dir) === dir) return undefined;
  }
}

/**
 * Folders with a package.json under `folder`, without descending into one once found:
 * a workspace root covers its own packages, and nested manifests are usually fixtures.
 */
export async function findProjects(io: Io, folder: string): Promise<FoundProject[]> {
  const paths: string[] = [];
  let level = [normalize(folder)];
  for (let depth = 0; depth <= MAX_DEPTH && level.length > 0; depth++) {
    const hasManifest = await Promise.all(level.map((dir) => io.exists(join(dir, "package.json"))));
    paths.push(...level.filter((_, i) => hasManifest[i]));
    if (depth === MAX_DEPTH) break;
    const children = await Promise.all(
      level
        .filter((_, i) => !hasManifest[i])
        .map(async (dir) =>
          (await io.readDir(dir))
            .filter((entry) => entry.isDir && !entry.name.startsWith(".") && !SKIP_DIRS.has(entry.name))
            .map((entry) => join(dir, entry.name)),
        ),
    );
    level = children.flat();
  }
  return Promise.all(
    paths.toSorted().map(async (path) => {
      const repoRoot = await findRepoRoot(io, path);
      const subdir = repoRoot ? relative(repoRoot, path) : ".";
      return { path, repoRoot, subdir: subdir === "." ? "" : subdir };
    }),
  );
}

/** Label for the repo a project belongs to: the remote's repo name, else the repo folder's name. */
export function repoLabel(remote: string | null | undefined, repoRoot?: string): string | undefined {
  if (remote) return remote.split("/").at(-1);
  return repoRoot ? basename(repoRoot) : undefined;
}
