const SHORT: [string, number][] = [
  ["y", 31_536_000],
  ["mo", 2_592_000],
  ["d", 86_400],
  ["h", 3_600],
];

/** Compact span for dense rows: `1m`, `21h`, `3d`, `2mo`, `1y`. */
export function shortSpan(ms: number): string {
  const seconds = Math.max(0, ms / 1000);
  for (const [unit, size] of SHORT) {
    if (seconds >= size) return `${Math.floor(seconds / size)}${unit}`;
  }
  return `${Math.max(1, Math.floor(seconds / 60))}m`;
}

export const shortAge = (iso: string, now = Date.now()) => shortSpan(now - Date.parse(iso));
