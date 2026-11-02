import { useQuery } from "@tanstack/react-query";
import { useServices } from "@/app/services";
import { TimeAgo } from "@/ui/time";

/** GitHub's REST budget as GitHub reports it; `/rate_limit` is free, so polling it costs nothing. */
export function GitHubLimit({ className }: { className?: string }) {
  const svc = useServices();
  const { data: core } = useQuery({
    queryKey: ["github-rate-limit"],
    enabled: !svc.preview,
    refetchInterval: 60_000,
    queryFn: async () => (await svc.github()).rateLimit(),
  });
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
