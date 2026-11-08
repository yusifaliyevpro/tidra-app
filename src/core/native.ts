import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import type { DirEntry, Io, OutputStream, RunOptions, RunResult } from "@/engine/io";
import type { SqlDriver } from "./db/driver";

export const inTauri = isTauri();

type ProcEvent = { kind: "stdout" | "stderr"; data: string } | { kind: "exit"; code: number | null };

export interface AppEnv {
  homeDir: string;
  platform: string;
  vars: Record<string, string>;
}

/** What a streamed process's result keeps: its listener has seen everything, and a dev server can run for days. */
const STREAMED_TAIL = 1024 * 1024;

/** Streams a child process; resolves when it exits. Aborting kills the whole process tree. */
export async function spawn(program: string, args: string[], options: RunOptions = {}): Promise<RunResult> {
  let stdout = "";
  let stderr = "";
  const keep = (text: string) =>
    options.onOutput && text.length > 2 * STREAMED_TAIL ? text.slice(-STREAMED_TAIL) : text;
  const { promise, resolve } = Promise.withResolvers<number | null>();
  const channel = new Channel<ProcEvent>();
  // Tauri's Channel exposes a single `onmessage` handler, not EventTarget.
  // oxlint-disable-next-line unicorn/prefer-add-event-listener
  channel.onmessage = (event) => {
    if (event.kind === "exit") return resolve(event.code);
    const stream: OutputStream = event.kind;
    if (stream === "stdout") stdout = keep(stdout + event.data);
    else stderr = keep(stderr + event.data);
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

interface NativeResponse {
  status: number;
  headers: [string, string][];
  body: string;
}

const NULL_BODY = new Set([101, 204, 205, 304]);

/**
 * fetch over one Rust call (`http_fetch`): a pooled client, no CORS, and npm package documents trimmed before they
 * cross IPC when `packument` is set. Abort only stops waiting; Rust gives up on its own after 60 s.
 */
async function nativeFetch(input: RequestInfo | URL, init: RequestInit | undefined, packument: boolean) {
  const request = new Request(input, init);
  request.signal.throwIfAborted();
  const body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.text();
  const call = invoke<NativeResponse>("http_fetch", {
    request: {
      method: request.method,
      url: request.url,
      headers: Object.fromEntries(request.headers),
      body,
      packument,
    },
  });
  const { promise: aborted, reject } = Promise.withResolvers<never>();
  // An abort after the answer arrived must not surface as an unhandled rejection.
  aborted.catch(() => undefined);
  const onAbort = () => reject(request.signal.reason);
  request.signal.addEventListener("abort", onAbort, { once: true });
  const response = await Promise.race([call, aborted]).finally(() =>
    request.signal.removeEventListener("abort", onAbort),
  );
  return new Response(NULL_BODY.has(response.status) ? null : response.body, {
    status: response.status,
    headers: response.headers,
  });
}

/** Network calls go through Rust in the app; the browser preview uses window.fetch. */
export const httpFetch: typeof globalThis.fetch = inTauri
  ? (input, init) => nativeFetch(input, init, false)
  : (input, init) => globalThis.fetch(input, init);

const fetchPackument: typeof globalThis.fetch = (input, init) => nativeFetch(input, init, true);

export function createTauriIo(env: AppEnv): Io {
  return {
    readText: (path) => invoke<string | null>("fs_read_text", { path }),
    writeText: (path, contents) => invoke("fs_write_text", { path, contents }),
    writeBytes: (path, bytes) => invoke("fs_write_bytes", { path, bytes: Array.from(bytes) }),
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
    platform: env.platform,
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
