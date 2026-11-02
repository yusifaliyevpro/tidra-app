export interface Job {
  id: string;
  title: string;
  intervalMinutes: number;
  /** Skip while the window is hidden (cheap polling such as CI and deploys). */
  visibleOnly?: boolean;
  run(signal: AbortSignal): Promise<void>;
}

export interface JobState {
  id: string;
  title: string;
  running: boolean;
  lastRun?: number;
  lastError?: string;
  failures: number;
  nextRun: number;
}

export interface SchedulerOptions {
  now?: () => number;
  isVisible?: () => boolean;
  tickMs?: number;
  /** Adds up to this fraction of the interval as random delay so jobs don't fire in lockstep. */
  jitter?: number;
  random?: () => number;
  onChange?: (states: JobState[]) => void;
  /** Most jobs running at once from the timer; the rest wait their turn in registration order. */
  maxConcurrent?: number;
}

const MAX_BACKOFF = 4;

/** One timer drives every background job: due jobs run, failures back off, pause stops everything. */
export function createScheduler(options: SchedulerOptions = {}) {
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;
  const jitter = options.jitter ?? 0.1;
  const jobs = new Map<string, Job>();
  const states = new Map<string, JobState>();
  const controllers = new Map<string, AbortController>();
  let timer: ReturnType<typeof setInterval> | undefined;
  let paused = false;

  // Copies, because query caching and the React Compiler treat an unchanged reference as unchanged state.
  const snapshot = () => [...states.values()].map((state) => ({ ...state }));
  const emit = () => options.onChange?.(snapshot());
  const delayFor = (job: Job, failures: number) => {
    const base = job.intervalMinutes * 60_000 * Math.min(2 ** failures, MAX_BACKOFF);
    return base + Math.floor(random() * base * jitter);
  };

  const execute = async (job: Job) => {
    const state = states.get(job.id);
    if (!state || state.running) return;
    const controller = new AbortController();
    controllers.set(job.id, controller);
    state.running = true;
    emit();
    try {
      await job.run(controller.signal);
      state.failures = 0;
      state.lastError = undefined;
    } catch (error) {
      state.failures++;
      state.lastError = error instanceof Error ? error.message : String(error);
    } finally {
      controllers.delete(job.id);
      state.running = false;
      state.lastRun = now();
      state.nextRun = state.lastRun + delayFor(job, state.failures);
      emit();
    }
  };

  const maxConcurrent = options.maxConcurrent ?? Number.POSITIVE_INFINITY;
  const tick = () => {
    if (paused) return;
    const visible = options.isVisible?.() ?? true;
    let running = [...states.values()].filter((s) => s.running).length;
    for (const job of jobs.values()) {
      if (running >= maxConcurrent) return;
      const state = states.get(job.id);
      if (state && !state.running && state.nextRun <= now() && (visible || !job.visibleOnly)) {
        running++;
        // A finished job frees a slot; check right away instead of waiting for the next tick.
        void execute(job).then(tick);
      }
    }
  };

  return {
    /** `lastRun` from a previous session keeps a relaunch from redoing work that is still fresh. */
    register(job: Job, lastRun?: number) {
      jobs.set(job.id, job);
      states.set(job.id, {
        id: job.id,
        title: job.title,
        running: false,
        failures: 0,
        lastRun,
        nextRun:
          lastRun === undefined ? now() : Math.min(lastRun + job.intervalMinutes * 60_000, now() + delayFor(job, 0)),
      });
      emit();
    },
    start() {
      timer ??= setInterval(tick, options.tickMs ?? 15_000);
      tick();
    },
    stop() {
      clearInterval(timer);
      timer = undefined;
      for (const controller of controllers.values()) controller.abort();
    },
    setPaused(value: boolean) {
      paused = value;
      if (!paused) tick();
    },
    isPaused: () => paused,
    async runNow(id: string) {
      const job = jobs.get(id);
      if (job) await execute(job);
    },
    async runAll() {
      await Promise.all([...jobs.values()].map(execute));
    },
    states: snapshot,
  };
}

export type Scheduler = ReturnType<typeof createScheduler>;
