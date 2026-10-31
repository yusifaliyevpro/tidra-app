import { useMutation } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import * as z from "@zod/mini";
import { Search } from "lucide-react";
import semver from "semver";
import { useReports } from "@/app/queries";
import { useServices } from "@/app/services";
import { projectLink } from "@/modules/links";
import { refreshProject } from "@/services/projects";
import { startBatch } from "@/services/updates";
import { Button } from "@/ui/button";
import { Input } from "@/ui/field";
import { Card, Empty, Page } from "@/ui/layout";
import { Mono } from "@/ui/misc";
import { toast, toastError } from "@/ui/toast";

export const Route = createFileRoute("/deps")({
  validateSearch: z.object({ q: z.optional(z.string()) }),
  component: Deps,
});

function Deps() {
  const svc = useServices();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data: rows } = useReports();
  const query = (search.q ?? "").trim().toLowerCase();

  const usage = new Map<
    string,
    { projectId: string; project: string; spec: string; importer: string; field: string; installed?: string }[]
  >();
  for (const { project, report } of rows ?? []) {
    for (const dep of report?.dependencies ?? []) {
      const outdated = report?.outdated.find((e) => e.name === dep.name);
      const list = usage.get(dep.name) ?? [];
      list.push({
        projectId: project.id,
        project: project.name,
        spec: dep.spec,
        importer: dep.importer,
        field: dep.field,
        installed: outdated?.current,
      });
      usage.set(dep.name, list);
    }
  }
  const names = [...usage.keys()].filter((name) => !query || name.toLowerCase().includes(query)).toSorted();

  return (
    <Page title="Dependency search" subtitle={`${usage.size} packages across ${rows?.length ?? 0} projects`}>
      <div className="mx-auto flex max-w-4xl flex-col gap-4 p-5">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-faint" />
          <Input
            value={search.q ?? ""}
            onChange={(e) => void navigate({ search: { q: e.target.value || undefined }, replace: true })}
            placeholder="Package name, e.g. zod"
            className="pl-8"
          />
        </div>
        {names.length === 0 ? <Empty title="No matching dependency" /> : null}
        {names.slice(0, 50).map((name) => (
          <PackageUsage
            key={name}
            name={name}
            uses={usage.get(name) ?? []}
            onAlign={(version) => alignAll(svc, name, version)}
          />
        ))}
      </div>
    </Page>
  );
}

/** Updates the package to one version in every project that uses an older one, queued as one batch. */
async function alignAll(svc: ReturnType<typeof useServices>, name: string, version: string) {
  const projects = await svc.store.listProjects();
  const reports = await Promise.all(projects.map((project) => refreshProject(svc, project.id)));
  const plans = projects.flatMap((project, i) => {
    const entry = reports[i]?.outdated.find((e) => e.name === name);
    if (!entry || (entry.current && semver.valid(entry.current) && semver.gte(entry.current, version))) return [];
    return [{ projectId: project.id, name: project.name, picks: [{ entry, version }] }];
  });
  if (plans.length > 0) startBatch(svc, plans);
  return plans.length;
}

function PackageUsage({
  name,
  uses,
  onAlign,
}: {
  name: string;
  uses: { projectId: string; project: string; spec: string; importer: string; field: string; installed?: string }[];
  onAlign: (version: string) => Promise<number>;
}) {
  const specs = new Set(uses.map((u) => u.spec));
  const highest = uses
    // link:, workspace:, git and file specs aren't ranges; minVersion throws on them.
    .map((u) => (semver.validRange(u.spec) ? semver.minVersion(u.spec)?.version : undefined))
    .filter((v): v is string => Boolean(v))
    .toSorted(semver.rcompare)[0];
  const align = useMutation({
    mutationFn: () => onAlign(highest ?? ""),
    onSuccess: (count) =>
      toast(count > 0 ? `Queued ${count} updates, two at a time. Each runs its project's checks.` : "Already aligned."),
    onError: toastError,
  });
  return (
    <Card>
      <div className="flex h-10 items-center gap-2.5 border-b border-line px-4">
        <span className="font-medium">{name}</span>
        <span className="text-sm text-muted">
          {uses.length} {uses.length === 1 ? "use" : "uses"}
          {specs.size > 1 ? ` · ${specs.size} different ranges` : ""}
        </span>
        {specs.size > 1 && highest ? (
          <Button size="sm" className="ml-auto" loading={align.isPending} onClick={() => align.mutate()}>
            Align all to {highest}
          </Button>
        ) : null}
      </div>
      {uses.map((use) => (
        <Link
          key={`${use.projectId}:${use.importer}:${use.field}`}
          {...projectLink(use.projectId)}
          className="flex h-9 items-center gap-3 border-b border-line px-4 text-sm last:border-b-0 hover:bg-hover"
        >
          <span className="w-48 truncate">{use.project}</span>
          <span className="w-32 truncate text-faint">{use.importer === "." ? "root" : use.importer}</span>
          <span className="w-36 text-faint">{use.field}</span>
          <Mono className="ml-auto">{use.spec}</Mono>
        </Link>
      ))}
    </Card>
  );
}
