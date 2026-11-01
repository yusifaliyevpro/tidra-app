import type { RateLimit } from "@/integrations/github";

type Limits = Readonly<Record<string, RateLimit>>;

let limits: Limits = {};
const listeners = new Set<() => void>();

/** Latest budget per resource, as reported by the headers of GitHub's own answers. */
export function recordRateLimit(limit: RateLimit) {
  const previous = limits[limit.resource];
  if (previous && previous.remaining === limit.remaining && previous.resetAt === limit.resetAt) return;
  limits = { ...limits, [limit.resource]: limit };
  for (const listener of listeners) listener();
}

export const rateLimits = (): Limits => limits;

export function subscribeRateLimits(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
