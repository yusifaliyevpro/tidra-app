import { Pause } from "lucide-react";
import { Spinner } from "@/ui/spinner";
import { useJobs } from "./queries";
import { useServices } from "./services";

/** What Tidra is doing in the background right now, so a slow screen never looks frozen. */
export function Activity() {
  const svc = useServices();
  const { data: jobs = [] } = useJobs();
  const running = jobs.filter((j) => j.running);
  if (svc.scheduler.isPaused()) {
    return (
      <span className="flex items-center gap-1.5 px-2 text-xs text-faint" title="Background checks are paused">
        <Pause className="size-3.5" />
        Paused
      </span>
    );
  }
  if (running.length === 0) return null;
  const [first] = running;
  return (
    <span
      className="flex items-center gap-2 px-2 text-xs text-faint"
      title={running.map((j) => j.title).join("\n")}
      aria-live="polite"
    >
      <Spinner className="size-3" />
      <span className="max-w-48 truncate">{first?.title}</span>
      {running.length > 1 ? <span className="tabular">+{running.length - 1}</span> : null}
    </span>
  );
}
