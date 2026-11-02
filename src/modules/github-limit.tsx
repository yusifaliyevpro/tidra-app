import { useQuery } from "@tanstack/react-query";
import { useServices } from "@/app/services";

/** Below this many requests left, the budget is worth a glance; above it the counter is noise. */
const SHOW_BELOW = 1000;

/** GitHub's REST budget as GitHub reports it; `/rate_limit` is free, so polling it costs nothing. */
export function GitHubLimit({ className }: { className?: string }) {
  const svc = useServices();
  const { data: core } = useQuery({
    queryKey: ["github-rate-limit"],
    enabled: !svc.preview,
    refetchInterval: 60_000,
    queryFn: async () => (await svc.github()).rateLimit(),
  });
  if (!core || core.remaining >= SHOW_BELOW) return null;
  return (
    <span className={className} title="GitHub API requests left this hour. Cached answers don't count.">
      GitHub{" "}
      <span className="text-warn tabular">
        {core.remaining.toLocaleString()} / {core.limit.toLocaleString()}
      </span>
    </span>
  );
}
