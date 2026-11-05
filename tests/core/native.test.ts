import { beforeEach, describe, expect, it, vi } from "vitest";

type ProcEvent = { kind: "stdout" | "stderr"; data: string } | { kind: "exit"; code: number | null };

const tauri = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
  channels: [] as { onmessage?: (event: ProcEvent) => void }[],
}));

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: tauri.invoke,
  Channel: class {
    onmessage?: (event: ProcEvent) => void;
    constructor() {
      tauri.channels.push(this);
    }
  },
}));

const { createTauriIo, httpFetch } = await import("@/core/native");

const io = createTauriIo({ homeDir: String.raw`C:\Users\me`, platform: "windows", vars: { A: "1" } });

beforeEach(() => {
  tauri.channels.length = 0;
});

describe("native fetch", () => {
  it("sends one http_fetch call with method, headers and body, and builds a Response", async () => {
    tauri.invoke.mockResolvedValue({
      status: 201,
      headers: [
        ["etag", '"e"'],
        ["content-type", "application/json"],
      ],
      body: '{"ok":true}',
    });
    const response = await httpFetch("https://api.github.com/x", {
      method: "POST",
      headers: { authorization: "Bearer t" },
      body: '{"a":1}',
    });
    expect(tauri.invoke).toHaveBeenCalledWith("http_fetch", {
      request: {
        method: "POST",
        url: "https://api.github.com/x",
        headers: { authorization: "Bearer t", "content-type": "text/plain;charset=UTF-8" },
        body: '{"a":1}',
        packument: false,
      },
    });
    expect(response.status).toBe(201);
    expect(response.headers.get("etag")).toBe('"e"');
    expect(await response.json()).toEqual({ ok: true });
  });

  it("sends no body for GET and gives 304 answers an empty body", async () => {
    tauri.invoke.mockResolvedValue({ status: 304, headers: [], body: "" });
    const response = await httpFetch("https://registry.npmjs.org/react");
    expect(tauri.invoke.mock.calls[0]?.[1]).toMatchObject({ request: { method: "GET", body: undefined } });
    expect(response.status).toBe(304);
    expect(response.body).toBeNull();
  });

  it("asks Rust to trim package documents", async () => {
    tauri.invoke.mockResolvedValue({ status: 200, headers: [], body: "{}" });
    await io.fetchPackument?.("https://registry.npmjs.org/react");
    expect(tauri.invoke.mock.calls[0]?.[1]).toMatchObject({ request: { packument: true } });
  });

  it("stops waiting when the request is aborted", async () => {
    tauri.invoke.mockReturnValue(new Promise(() => {}));
    const controller = new AbortController();
    const pending = httpFetch("https://slow.dev", { signal: controller.signal });
    controller.abort(new Error("timed out"));
    await expect(pending).rejects.toThrow("timed out");
  });

  it("fails fast for an already aborted signal", async () => {
    await expect(httpFetch("https://x.dev", { signal: AbortSignal.abort() })).rejects.toThrow("aborted");
    expect(tauri.invoke).not.toHaveBeenCalled();
  });

  it("passes Rust's error through", async () => {
    tauri.invoke.mockRejectedValue("Only https URLs are allowed: http://x.dev");
    await expect(httpFetch("http://x.dev")).rejects.toBe("Only https URLs are allowed: http://x.dev");
  });
});

describe("native io", () => {
  it("uses forward slashes for the home folder and the app's environment", () => {
    expect(io.homeDir).toBe("C:/Users/me");
    expect(io.env).toEqual({ A: "1" });
  });

  it("collects a process's output from its channel and returns the exit code", async () => {
    tauri.invoke.mockImplementation(async (command) => {
      if (command !== "proc_spawn") return undefined;
      queueMicrotask(() => {
        const channel = tauri.channels[0];
        channel?.onmessage?.({ kind: "stdout", data: "hello " });
        channel?.onmessage?.({ kind: "stderr", data: "warn" });
        channel?.onmessage?.({ kind: "stdout", data: "world" });
        channel?.onmessage?.({ kind: "exit", code: 3 });
      });
      return 7;
    });
    const chunks: string[] = [];
    const result = await io.run("pnpm", ["test"], { cwd: "/app", onOutput: (chunk) => chunks.push(chunk) });
    expect(result).toEqual({ code: 3, stdout: "hello world", stderr: "warn" });
    expect(chunks).toEqual(["hello ", "warn", "world"]);
    expect(tauri.invoke).toHaveBeenCalledWith(
      "proc_spawn",
      expect.objectContaining({ request: { program: "pnpm", args: ["test"], cwd: "/app", env: undefined } }),
    );
  });

  it("reports a program that can't start as exit code null with the reason", async () => {
    tauri.invoke.mockRejectedValue(new Error("`pnpm` was not found on PATH"));
    expect(await io.run("pnpm", ["-v"])).toEqual({ code: null, stdout: "", stderr: "`pnpm` was not found on PATH" });
  });

  it("kills the process when the signal aborts", async () => {
    tauri.invoke.mockImplementation(async (command) => (command === "proc_spawn" ? 9 : undefined));
    const controller = new AbortController();
    const running = io.run("pnpm", ["dev"], { signal: controller.signal });
    await vi.waitFor(() => expect(tauri.channels).toHaveLength(1));
    controller.abort();
    await vi.waitFor(() => expect(tauri.invoke).toHaveBeenCalledWith("proc_kill", { id: 9 }));
    tauri.channels[0]?.onmessage?.({ kind: "exit", code: null });
    await expect(running).resolves.toMatchObject({ code: null });
  });
});
