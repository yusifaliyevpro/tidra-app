import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Io, RunResult } from "@/engine/io";

/** The real filesystem and real processes, for tests of what git itself does. The network stays off. */
export function nodeIo(env: Record<string, string>): Io & { settled(): Promise<void> } {
  let running = 0;
  return {
    homeDir: env.HOME ?? "",
    platform: process.platform === "win32" ? "windows" : process.platform,
    env,
    fetch: () => Promise.reject(new Error("network disabled in tests")),
    readText: (path) => readFile(path, "utf8").catch(() => null),
    writeText: async (path, contents) => {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, contents);
    },
    writeBytes: async (path, bytes) => {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, bytes);
    },
    exists: async (path) => existsSync(path),
    readDir: async (path) =>
      (await readdir(path, { withFileTypes: true })).map((entry) => ({ name: entry.name, isDir: entry.isDirectory() })),
    run: (program, args, options) =>
      new Promise<RunResult>((resolve) => {
        running++;
        const finish = (result: RunResult) => {
          running--;
          resolve(result);
        };
        const child = spawn(program, args, {
          cwd: options?.cwd,
          env: { ...process.env, ...env, ...options?.env },
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => (stdout += String(chunk)));
        child.stderr.on("data", (chunk) => (stderr += String(chunk)));
        child.on("error", (error) => finish({ code: null, stdout, stderr: error.message }));
        child.on("close", (code) => finish({ code, stdout, stderr }));
      }),
    /** Waits for background work to end, so a test can delete its folders and close its database. */
    settled: async () => {
      let quiet = 0;
      while (quiet < 5) {
        quiet = running === 0 ? quiet + 1 : 0;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    },
  };
}
