import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import type { DirEntry, Io, OutputStream, RunOptions, RunResult } from "@/engine/io";
import type { SqlDriver } from "./db/driver";

export const inTauri = isTauri();

type ProcEvent = { kind: "stdout" | "stderr"; data: string } | { kind: "exit"; code: number | null };

export interface AppEnv {
  homeDir: string;
  platform: string;
  vars: Record<string, string>;
}

/** Streams a child process; resolves when it exits. Aborting kills the whole process tree. */
export async function spawn(program: string, args: string[], options: RunOptions = {}): Promise<RunResult> {
  let stdout = "";
  let stderr = "";
  const { promise, resolve } = Promise.withResolvers<number | null>();
  const channel = new Channel<ProcEvent>();
  // Tauri's Channel exposes a single `onmessage` handler, not EventTarget.
  // oxlint-disable-next-line unicorn/prefer-add-event-listener
  channel.onmessage = (event) => {
    if (event.kind === "exit") return resolve(event.code);
    const stream: OutputStream = event.kind;
    if (stream === "stdout") stdout += event.data;
    else stderr += event.data;
    options.onOutput?.(event.data, stream);
  };
  const id = await invoke<number>("proc_spawn", {
    request: { program, args, cwd: options.cwd, env: options.env },
    onEvent: channel,
  });
  const abort = () => void invoke("proc_kill", { id });
  // The signal can fire while the spawn is in flight; the listener alone would miss it.
  if (options.signal?.aborted) abort();
  else options.signal?.addEventListener("abort", abort, { once: true });
  try {
    return { code: await promise, stdout, stderr };
  } finally {
    options.signal?.removeEventListener("abort", abort);
  }
}

/** Network calls go through Rust in the app (no CORS); the browser preview uses window.fetch. */
export const httpFetch: typeof globalThis.fetch = inTauri
  ? (input, init) => tauriFetch(input, init)
  : (input, init) => globalThis.fetch(input, init);

/** Registry documents are downloaded and trimmed in Rust: whole ones are tens of MB and slow to pass over IPC. */
const fetchPackument: typeof globalThis.fetch = async (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  const headers = Object.fromEntries(new Headers(init?.headers));
  const { status, etag, body } = await invoke<{ status: number; etag: string | null; body: string }>("registry_fetch", {
    url,
    headers,
  });
  return new Response(status === 304 ? null : body, { status, headers: etag ? { etag } : {} });
};

export function createTauriIo(env: AppEnv): Io {
  return {
    readText: (path) => invoke<string | null>("fs_read_text", { path }),
    writeText: (path, contents) => invoke("fs_write_text", { path, contents }),
    readDir: (path) => invoke<DirEntry[]>("fs_read_dir", { path }),
    exists: (path) => invoke<boolean>("fs_exists", { path }),
    run: async (program, args, options) => {
      try {
        return await spawn(program, args, options);
      } catch (error) {
        return { code: null, stdout: "", stderr: error instanceof Error ? error.message : String(error) };
      }
    },
    fetch: httpFetch,
    fetchPackument,
    env: env.vars,
    homeDir: env.homeDir.replaceAll("\\", "/"),
  };
}

export const tauriSqlDriver: SqlDriver = {
  query: (sql, params) => invoke<unknown[][]>("db_query", { sql, params }),
  execute: async (sql, params) => {
    await invoke("db_execute", { sql, params });
  },
  script: (sql) => invoke("db_exec_script", { sql }),
};

export const appEnv = () => invoke<AppEnv>("app_env");
export const which = (program: string) => invoke<string | null>("proc_which", { program });
export const killProcess = (pid: number) => invoke("process_kill", { pid });
export const setTrayAttention = (attention: boolean, paused: boolean) =>
  invoke("tray_set_attention", { attention, paused });

export interface PortListener {
  port: number;
  pid: number;
  process: string;
  address: string;
}
export const listPorts = () => invoke<PortListener[]>("ports_list");
