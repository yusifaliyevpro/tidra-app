import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { useServices } from "@/app/services";
import { rateLimits, subscribeRateLimits } from "@/services/github-limit";
import { TimeAgo } from "@/ui/time";

/** GitHub's REST budget as of the last answer; asks `/rate_limit` (free) once when nothing has been seen yet. */
export function GitHubLimit({ className }: { className?: string }) {
  const svc = useServices();
  const limits = useSyncExternalStore(subscribeRateLimits, rateLimits);
  useQuery({
    queryKey: ["github-rate-limit"],
    enabled: !limits.core && !svc.preview,
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: async () => {
      await (await svc.github()).rateLimit();
      return true;
    },
  });
  const core = limits.core;
  if (!core) return null;
  const low = core.remaining < core.limit * 0.1;
  return (
    <span className={className} title="GitHub API requests left this hour. Cached answers don't count.">
      GitHub{" "}
      <span className={`tabular ${low ? "text-warn" : "text-muted"}`}>
        {core.remaining.toLocaleString()} / {core.limit.toLocaleString()}
      </span>{" "}
      · resets <TimeAgo value={core.resetAt} />
    </span>
  );
}
