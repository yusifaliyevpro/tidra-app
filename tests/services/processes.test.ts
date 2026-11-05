import { describe, expect, it, vi } from "vitest";
import { createProcessManager } from "@/services/processes";
import { memoryIo, ok } from "../support/memory-io";
import { testServices } from "../support/services";

describe("process manager", () => {
  it("publishes a new snapshot as output streams in", async () => {
    let emit: ((chunk: string) => void) | undefined;
    let finish: (() => void) | undefined;
    const io = memoryIo(
      {},
      {
        run: (_program, _args, options) =>
          new Promise((resolve) => {
            emit = (chunk) => options?.onOutput?.(chunk, "stdout");
            finish = () => resolve(ok());
          }),
      },
    );
    const { svc, close } = await testServices(io);
    const processes = createProcessManager(svc);
    const seen: string[] = [];
    processes.subscribe(() => seen.push(processes.snapshot()[0]?.output ?? ""));

    processes.start({ label: "dev", command: { program: "pnpm", args: ["dev"] } });
    const started = processes.snapshot();
    emit?.("ready on :3000\n");
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(processes.snapshot()).not.toBe(started);
    expect(processes.snapshot()[0]?.output).toBe("ready on :3000\n");
    expect(seen.at(-1)).toBe("ready on :3000\n");

    finish?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(processes.snapshot()[0]).toMatchObject({ running: false, exitCode: 0 });
    close();
  });
});

describe("process manager failures", () => {
  it("marks a script that cannot start as stopped and shows why", async () => {
    const io = memoryIo({}, { run: () => Promise.reject(new Error("pnpm was not found on PATH")) });
    const { svc, close } = await testServices(io);
    const processes = createProcessManager(svc);
    processes.start({ label: "dev", command: { program: "pnpm", args: ["dev"] } });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const [proc] = processes.snapshot();
    close();
    expect(proc?.running).toBe(false);
    expect(proc?.output).toContain("pnpm was not found on PATH");
  });
});

describe("onExit", () => {
  it("runs once the process ends, even when it failed", async () => {
    const io = memoryIo({}, { run: async () => ({ code: 1, stdout: "", stderr: "ERR_PNPM" }) });
    const { svc, close } = await testServices(io);
    const processes = createProcessManager(svc);
    const exited = new Promise<void>((resolve) => {
      processes.start({ label: "update", command: { program: "pnpm", args: ["add", "-g", "x"] }, onExit: resolve });
    });
    await exited;
    close();
    expect(processes.snapshot()[0]).toMatchObject({ running: false, exitCode: 1 });
  });
});

describe("next commands", () => {
  it("runs them in order, stops at the first failure and keeps every command in the output", async () => {
    const io = memoryIo(
      {},
      { run: async (_program, args) => (args[1] === "lint" ? { code: 2, stdout: "", stderr: "" } : ok()) },
    );
    const { svc, close } = await testServices(io);
    const processes = createProcessManager(svc);
    await new Promise<void>((resolve) => {
      processes.start({
        label: "Checks",
        command: { program: "pnpm", args: ["run", "typecheck"] },
        next: [
          { program: "pnpm", args: ["run", "lint"] },
          { program: "pnpm", args: ["run", "test"] },
        ],
        onExit: resolve,
      });
    });
    close();
    expect(io.runs.map((r) => r.args[1])).toEqual(["typecheck", "lint"]);
    expect(processes.snapshot()[0]).toMatchObject({ running: false, exitCode: 2 });
    expect(processes.snapshot()[0]?.output).toContain("$ pnpm run lint");
  });
});

describe("process control", () => {
  it("stops a running process through its abort signal and removes it from the list", async () => {
    let aborted = false;
    const io = memoryIo(
      {},
      {
        run: (_program, _args, options) =>
          new Promise((resolve) => {
            options?.signal?.addEventListener("abort", () => {
              aborted = true;
              resolve({ code: null, stdout: "", stderr: "" });
            });
          }),
      },
    );
    const { svc, close } = await testServices(io);
    const manager = createProcessManager(svc);
    const id = manager.start({ label: "dev", command: { program: "pnpm", args: ["dev"] } });
    expect(manager.snapshot()[0]).toMatchObject({ id, running: true });
    manager.stop(id);
    await vi.waitFor(() => expect(manager.snapshot()[0]?.running).toBe(false));
    expect(aborted).toBe(true);
    manager.remove(id);
    expect(manager.snapshot()).toEqual([]);
    close();
  });

  it("aborts a running process when it is removed", async () => {
    const signals: AbortSignal[] = [];
    const io = memoryIo(
      {},
      { run: (_p, _a, options) => (options?.signal && signals.push(options.signal), new Promise(() => {})) },
    );
    const { svc, close } = await testServices(io);
    const manager = createProcessManager(svc);
    manager.remove(manager.start({ label: "watch", command: { program: "pnpm", args: ["test:watch"] } }));
    close();
    expect(signals[0]?.aborted).toBe(true);
  });

  it("keeps only the newest output of a very chatty process", async () => {
    const io = memoryIo(
      {},
      {
        run: async (_p, _a, options) => {
          for (let i = 0; i < 50; i++)
            options?.onOutput?.(`${String(i).padStart(2, "0")}${"x".repeat(9_998)}`, "stdout");
          return ok();
        },
      },
    );
    const { svc, close } = await testServices(io);
    const manager = createProcessManager(svc);
    manager.start({ label: "build", command: { program: "pnpm", args: ["build"] } });
    await vi.waitFor(() => expect(manager.snapshot()[0]?.running).toBe(false));
    const output = manager.snapshot()[0]?.output ?? "";
    close();
    expect(output.length).toBe(400_000);
    expect(output.startsWith("10")).toBe(true);
  });

  it("lists the newest process first", async () => {
    const { svc, close } = await testServices(memoryIo({}, { run: () => new Promise(() => {}) }));
    const manager = createProcessManager(svc);
    const first = manager.start({ label: "a", command: { program: "a", args: [] } });
    await new Promise((resolve) => setTimeout(resolve, 2));
    const second = manager.start({ label: "b", command: { program: "b", args: [] } });
    close();
    expect(manager.snapshot().map((p) => p.id)).toEqual([second, first]);
  });
});
