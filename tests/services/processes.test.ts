import { describe, expect, it } from "vitest";
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
