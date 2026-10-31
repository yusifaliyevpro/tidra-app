export type OutputStream = "stdout" | "stderr";

export interface RunOptions {
  cwd?: string;
  env?: Record<string, string>;
  onOutput?: (chunk: string, stream: OutputStream) => void;
  signal?: AbortSignal;
}

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface DirEntry {
  name: string;
  isDir: boolean;
}

/** Everything the engine needs from the outside world, so it runs the same under Tauri and in tests. */
export interface Io {
  readText(path: string): Promise<string | null>;
  writeText(path: string, contents: string): Promise<void>;
  readDir(path: string): Promise<DirEntry[]>;
  exists(path: string): Promise<boolean>;
  run(program: string, args: string[], options?: RunOptions): Promise<RunResult>;
  fetch: typeof globalThis.fetch;
  env: Readonly<Record<string, string | undefined>>;
  homeDir: string;
}

export function runOk(result: RunResult): boolean {
  return result.code === 0;
}
