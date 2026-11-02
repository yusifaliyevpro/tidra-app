import { ulid } from "ulid";
import { display, type Command } from "@/engine/pm";
import type { Services } from "./context";

export interface ManagedProcess {
  id: string;
  projectId?: string;
  label: string;
  command: Command;
  /** Run after `command` succeeds, in order, stopping at the first that fails (a project's checks). */
  next?: Command[];
  cwd?: string;
  output: string;
  running: boolean;
  exitCode?: number | null;
  startedAt: number;
}

type Listener = () => void;

const MAX_OUTPUT = 400_000;
// Output can arrive in hundreds of small chunks a second; one update per frame is plenty.
const OUTPUT_FLUSH_MS = 16;

/** Long-running scripts and one-off commands started from the UI, kept for the whole session. */
export function createProcessManager(svc: Services) {
  const processes = new Map<string, ManagedProcess & { abort: AbortController }>();
  const listeners = new Set<Listener>();
  // Immutable view for React: a new array of new objects whenever anything changes.
  let snapshot: ManagedProcess[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  const notify = () => {
    clearTimeout(flushTimer);
    flushTimer = undefined;
    snapshot = [...processes.values()]
      .map(({ abort: _abort, ...proc }) => ({ ...proc }))
      .toSorted((a, b) => b.startedAt - a.startedAt);
    for (const listener of listeners) listener();
  };
  const notifySoon = () => {
    flushTimer ??= setTimeout(notify, OUTPUT_FLUSH_MS);
  };

  return {
    subscribe(listener: Listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    snapshot: (): ManagedProcess[] => snapshot,

    start(input: {
      label: string;
      command: Command;
      next?: Command[];
      cwd?: string;
      projectId?: string;
      /** Runs once the process ends, however it ended. */
      onExit?: () => void;
    }): string {
      const { onExit, ...rest } = input;
      const id = ulid();
      const abort = new AbortController();
      const proc: ManagedProcess & { abort: AbortController } = {
        ...rest,
        id,
        output: "",
        running: true,
        startedAt: Date.now(),
        abort,
      };
      processes.set(id, proc);
      notify();
      const append = (chunk: string) => {
        proc.output = (proc.output + chunk).slice(-MAX_OUTPUT);
        notifySoon();
      };
      const runAll = async () => {
        const commands = [input.command, ...(input.next ?? [])];
        let result = { code: 0 as number | null, stdout: "", stderr: "" };
        for (const command of commands) {
          if (commands.length > 1) append(`${proc.output ? "\n" : ""}$ ${display(command)}\n`);
          result = await svc.io.run(command.program, command.args, {
            cwd: input.cwd,
            env: { FORCE_COLOR: "1" },
            signal: abort.signal,
            onOutput: append,
          });
          if (result.code !== 0) break;
        }
        return result;
      };
      void runAll()
        .then(
          (result) => {
            proc.running = false;
            proc.exitCode = result.code;
            if (result.code === null && result.stderr) proc.output += `\n${result.stderr}\n`;
            notify();
          },
          (error: unknown) => {
            // A program that cannot start must not look like it is still running.
            proc.running = false;
            proc.exitCode = null;
            proc.output += `\n${error instanceof Error ? error.message : String(error)}\n`;
            notify();
          },
        )
        .finally(() => onExit?.());
      return id;
    },
    stop(id: string) {
      processes.get(id)?.abort.abort();
    },
    remove(id: string) {
      const proc = processes.get(id);
      if (proc?.running) proc.abort.abort();
      processes.delete(id);
      notify();
    },
  };
}

export type ProcessManager = ReturnType<typeof createProcessManager>;
