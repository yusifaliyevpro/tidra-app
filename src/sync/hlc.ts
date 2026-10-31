/**
 * Hybrid logical clock. Timestamps are fixed-width strings, so plain string comparison orders them and
 * the device id breaks ties deterministically: `000001761916800000:0003:dev-a`.
 */
export interface Clock {
  readonly deviceId: string;
  /** Timestamp for a local write. */
  tick(): string;
  /** Advances past a timestamp seen from another device, so later local writes always win over it. */
  receive(remote: string): void;
}

const MS_WIDTH = 18;
const COUNTER_WIDTH = 4;
const MAX_COUNTER = 0xffff;

export function formatHlc(ms: number, counter: number, deviceId: string): string {
  return `${String(ms).padStart(MS_WIDTH, "0")}:${counter.toString(16).padStart(COUNTER_WIDTH, "0")}:${deviceId}`;
}

export function parseHlc(value: string): { ms: number; counter: number; deviceId: string } | undefined {
  const match = /^(\d+):([0-9a-f]+):(.+)$/.exec(value);
  if (!match?.[1] || !match[2] || !match[3]) return undefined;
  return { ms: Number(match[1]), counter: Number.parseInt(match[2], 16), deviceId: match[3] };
}

export function createClock(deviceId: string, now: () => number = Date.now, last?: string): Clock {
  const previous = last ? parseHlc(last) : undefined;
  let ms = previous?.ms ?? 0;
  let counter = previous?.counter ?? 0;

  const advance = (candidateMs: number, candidateCounter: number) => {
    ms = candidateMs;
    counter = candidateCounter;
    if (counter > MAX_COUNTER) {
      ms += 1;
      counter = 0;
    }
  };

  return {
    deviceId,
    tick() {
      const wall = now();
      if (wall > ms) advance(wall, 0);
      else advance(ms, counter + 1);
      return formatHlc(ms, counter, deviceId);
    },
    receive(remote) {
      const parsed = parseHlc(remote);
      if (!parsed) return;
      const wall = now();
      const top = Math.max(wall, ms, parsed.ms);
      if (top === ms && top === parsed.ms) advance(top, Math.max(counter, parsed.counter) + 1);
      else if (top === ms) advance(top, counter + 1);
      else if (top === parsed.ms) advance(top, parsed.counter + 1);
      else advance(top, 0);
    },
  };
}
