/** Runs at most `concurrency` tasks at a time; queued tasks start in call order. */
export function createLimit(concurrency: number) {
  let active = 0;
  const queue: (() => void)[] = [];

  const next = () => {
    active--;
    queue.shift()?.();
  };

  return async function limit<T>(task: () => Promise<T>): Promise<T> {
    if (active >= concurrency) await new Promise<void>((resolve) => queue.push(resolve));
    active++;
    try {
      return await task();
    } finally {
      next();
    }
  };
}

export type Limit = ReturnType<typeof createLimit>;
