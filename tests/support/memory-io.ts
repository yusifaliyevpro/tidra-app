import type { DirEntry, Io, RunOptions, RunResult } from "@/engine/io";
import { dirname, normalize } from "@/engine/path";

export interface RecordedRun {
  program: string;
  args: string[];
  cwd?: string;
}

type RunHandler = (program: string, args: string[], options?: RunOptions) => RunResult | Promise<RunResult>;

export interface MemoryIo extends Io {
  files: Map<string, string>;
  runs: RecordedRun[];
}

export const ok = (stdout = ""): RunResult => ({ code: 0, stdout, stderr: "" });

/** In-memory filesystem and process runner for engine tests. Paths are normalized, so tests can use either slash. */
export function memoryIo(
  files: Record<string, string> = {},
  options: { run?: RunHandler; fetch?: typeof globalThis.fetch; env?: Record<string, string>; homeDir?: string } = {},
): MemoryIo {
  const map = new Map(Object.entries(files).map(([path, text]) => [normalize(path), text]));
  const runs: RecordedRun[] = [];

  const dirs = () => {
    const set = new Set<string>();
    for (const path of map.keys()) {
      for (let dir = dirname(path); !set.has(dir) && dir !== dirname(dir); dir = dirname(dir)) set.add(dir);
    }
    return set;
  };

  return {
    files: map,
    runs,
    homeDir: options.homeDir ?? "/home/test",
    env: options.env ?? {},
    fetch: options.fetch ?? (() => Promise.reject(new Error("network disabled in tests"))),
    readText: async (path) => map.get(normalize(path)) ?? null,
    writeText: async (path, contents) => {
      map.set(normalize(path), contents);
    },
    exists: async (path) => map.has(normalize(path)) || dirs().has(normalize(path)),
    readDir: async (path) => {
      const base = normalize(path);
      const children = new Map<string, DirEntry>();
      for (const file of map.keys()) {
        if (!file.startsWith(`${base}/`)) continue;
        const [name, ...rest] = file.slice(base.length + 1).split("/");
        if (name) children.set(name, { name, isDir: rest.length > 0 });
      }
      return [...children.values()].toSorted((a, b) => a.name.localeCompare(b.name));
    },
    run: async (program, args, runOptions) => {
      runs.push({ program, args, cwd: runOptions?.cwd });
      return options.run ? options.run(program, args, runOptions) : ok();
    },
  };
}

export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });
}

/** A registry document in the shape npm returns, trimmed to what the engine reads. */
export function packument(
  name: string,
  versions: Record<string, { time?: string; deprecated?: string; peerDependencies?: Record<string, string> }>,
  distTags: Record<string, string>,
) {
  return {
    name,
    "dist-tags": distTags,
    versions: Object.fromEntries(
      Object.entries(versions).map(([v, meta]) => [
        v,
        { name, version: v, deprecated: meta.deprecated, peerDependencies: meta.peerDependencies },
      ]),
    ),
    time: Object.fromEntries(Object.entries(versions).flatMap(([v, meta]) => (meta.time ? [[v, meta.time]] : []))),
  };
}

/** Request headers of a recorded fetch call, whatever shape they were passed in. */
export function headersOf(call: Parameters<typeof globalThis.fetch> | undefined): Headers {
  return new Headers(call?.[1]?.headers);
}
