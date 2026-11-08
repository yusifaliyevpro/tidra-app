import { cn } from "cn";
import type { ProjectHealth } from "@/services/home";

export function UpdateHeader() {
  return (
    <span className="flex">
      <span className="w-12">Major</span>
      <span className="w-12">Minor</span>
      <span className="w-12">Patch</span>
    </span>
  );
}

function Cell({ value, color, label }: { value: number; color: string; label: string }) {
  return (
    <span title={`${value} ${label}`} className={cn("w-12 tabular", value > 0 ? color : "text-ghost")}>
      {value}
    </span>
  );
}

/** Major, minor and patch counts as three fixed columns, so rows line up and zeros fade out. */
export function UpdateCells({ updates }: { updates: ProjectHealth["updates"] }) {
  if (updates.major + updates.minor + updates.patch === 0)
    return <span className="text-sm text-faint">Up to date</span>;
  return (
    <span className="flex text-sm">
      <Cell value={updates.major} color="text-bad" label="major" />
      <Cell value={updates.minor} color="text-warn" label="minor" />
      <Cell value={updates.patch} color="text-ok" label="patch" />
    </span>
  );
}
