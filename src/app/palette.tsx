import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Command } from "cmdk";
import { ArrowLeft, ArrowUpCircle, Bug, FolderGit2, Package, Pause, Play, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import semver from "semver";
import type { ProjectWithPath } from "@/core/store";
import { projectLink } from "@/modules/links";
import { issueDraft } from "@/services/issue-draft";
import { refreshProject, type ProjectReport } from "@/services/projects";
import { startBatch } from "@/services/updates";
import { useBackdropClose } from "@/ui/backdrop";
import { toast, toastError } from "@/ui/toast";
import { MODULES } from "./modules";
import { useReports } from "./queries";
import { useServices } from "./services";

function Item({
  value,
  onSelect,
  icon,
  children,
  hint,
}: {
  value: string;
  onSelect: () => void;
  icon?: ReactNode;
  children: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="flex h-9 items-center gap-2.5 rounded-md px-2.5 text-base text-muted data-[selected=true]:bg-selected data-[selected=true]:text-fg [&_svg]:size-4 [&_svg]:shrink-0"
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint ? <span className="shrink-0 text-xs text-faint">{hint}</span> : null}
    </Command.Item>
  );
}

const GROUP = "px-1 text-xs text-faint [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5";

interface Use {
  project: ProjectWithPath;
  spec: string;
  installed?: string;
  latest?: string;
}

/** Every direct dependency across projects, with where it is used and whether it is behind. */
function packageIndex(rows: { project: ProjectWithPath; report?: ProjectReport }[]) {
  const index = new Map<string, Use[]>();
  for (const { project, report } of rows) {
    const seen = new Set<string>();
    for (const dep of report?.dependencies ?? []) {
      if (seen.has(dep.name)) continue;
      seen.add(dep.name);
      const outdated = report?.outdated.find((e) => e.name === dep.name);
      const list = index.get(dep.name) ?? [];
      list.push({ project, spec: dep.spec, installed: outdated?.current, latest: outdated?.latest });
      index.set(dep.name, list);
    }
  }
  return index;
}

export function Palette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = dialog.current;
    if (open && el && !el.open) el.showModal();
    if (!open && el?.open) el.close();
  }, [open]);
  useBackdropClose(dialog, onClose);

  return (
    <dialog
      ref={dialog}
      aria-label="Command palette"
      onClose={onClose}
      onCancel={onClose}
      className="mx-auto mt-[12vh] w-[640px] max-w-[92vw] animate-dialog-in rounded-xl border border-line-strong bg-raised p-0 text-fg shadow-dialog backdrop:bg-scrim"
    >
      {open ? <PaletteBody onClose={onClose} /> : null}
    </dialog>
  );
}

function PaletteBody({ onClose }: { onClose: () => void }) {
  const svc = useServices();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data: rows = [] } = useReports();
  const [search, setSearch] = useState("");
  const [pkg, setPkg] = useState<string>();

  const run = (action: () => void) => {
    onClose();
    action();
  };
  const packages = packageIndex(rows);
  const query = search.trim().toLowerCase();
  const matching = query
    ? [...packages.keys()]
        .filter((name) => name.toLowerCase().includes(query))
        .toSorted((a, b) => Number(!a.toLowerCase().startsWith(query)) - Number(!b.toLowerCase().startsWith(query)))
        .slice(0, 40)
    : [];
  const paused = svc.scheduler.isPaused();

  return (
    <Command
      label="Command palette"
      loop
      className="flex max-h-[60vh] flex-col"
      onKeyDown={(event) => {
        if (pkg && event.key === "Backspace" && !search) {
          event.preventDefault();
          setPkg(undefined);
        }
      }}
    >
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-4">
        {pkg ? (
          <button
            type="button"
            aria-label="Back"
            onClick={() => setPkg(undefined)}
            className="flex items-center gap-1.5 rounded-md bg-selected px-2 py-0.5 text-sm text-fg"
          >
            <ArrowLeft className="size-3.5" />
            {pkg}
          </button>
        ) : null}
        <Command.Input
          // oxlint-disable-next-line jsx-a11y/no-autofocus -- the palette exists to be typed into
          autoFocus
          value={search}
          onValueChange={setSearch}
          placeholder={pkg ? "Filter projects" : "Search projects, packages and commands"}
          className="h-full min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-faint"
        />
      </div>
      <Command.List className="min-h-0 overflow-y-auto overscroll-contain p-1.5">
        <Command.Empty className="px-3 py-6 text-center text-sm text-muted">No matches</Command.Empty>
        {pkg ? (
          <PackageUses
            name={pkg}
            uses={packages.get(pkg) ?? []}
            onOpen={(id) => run(() => void navigate(projectLink(id)))}
            onAlign={(version) => run(() => void alignAll(svc, pkg, version))}
          />
        ) : (
          <>
            <Command.Group heading="Projects" className={GROUP}>
              {rows.map(({ project }) => (
                <Item
                  key={project.id}
                  value={`project ${project.name} ${project.remote ?? ""} ${project.id}`}
                  icon={<FolderGit2 />}
                  hint={project.subdir || project.remote?.replace(/^github\.com\//, "")}
                  onSelect={() => run(() => void navigate(projectLink(project.id)))}
                >
                  {project.name}
                </Item>
              ))}
            </Command.Group>
            {matching.length > 0 ? (
              <Command.Group heading="Packages" className={GROUP}>
                {matching.map((name) => {
                  const uses = packages.get(name) ?? [];
                  const behind = uses.filter((u) => u.latest).length;
                  return (
                    <Item
                      key={name}
                      value={`package ${name}`}
                      icon={<Package />}
                      hint={`${uses.length} ${uses.length === 1 ? "project" : "projects"}${behind ? ` · ${behind} behind` : ""}`}
                      onSelect={() => {
                        setPkg(name);
                        setSearch("");
                      }}
                    >
                      {name}
                    </Item>
                  );
                })}
              </Command.Group>
            ) : null}
            <Command.Group heading="Go to" className={GROUP}>
              {MODULES.map((m) => {
                const Icon = m.icon;
                return (
                  <Item
                    key={m.id}
                    value={`page ${m.title}`}
                    icon={<Icon />}
                    hint={`g ${m.key}`}
                    onSelect={() => run(() => void navigate({ to: m.path }))}
                  >
                    {m.title}
                  </Item>
                );
              })}
            </Command.Group>
            <Command.Group heading="Commands" className={GROUP}>
              <Item
                value="check everything refresh all"
                icon={<RefreshCw />}
                onSelect={() => run(() => void svc.scheduler.runAll().then(() => queryClient.invalidateQueries()))}
              >
                Check everything now
              </Item>
              <Item
                value={paused ? "resume background checks" : "pause background checks"}
                icon={paused ? <Play /> : <Pause />}
                onSelect={() => run(() => svc.scheduler.setPaused(!paused))}
              >
                {paused ? "Resume background checks" : "Pause background checks"}
              </Item>
              <Item
                value="report an issue bug feature request"
                icon={<Bug />}
                hint="Ctrl Shift B"
                onSelect={() => run(issueDraft.open)}
              >
                Report an issue
              </Item>
            </Command.Group>
          </>
        )}
      </Command.List>
    </Command>
  );
}

function PackageUses({
  name,
  uses,
  onOpen,
  onAlign,
}: {
  name: string;
  uses: Use[];
  onOpen: (projectId: string) => void;
  onAlign: (version: string) => void;
}) {
  const latest = uses
    .map((u) => u.latest)
    .filter((v): v is string => Boolean(v && semver.valid(v)))
    .toSorted(semver.rcompare)[0];
  const behind = uses.filter((u) => u.latest).length;
  return (
    <>
      {latest && behind > 0 ? (
        <Command.Group heading="Update" className={GROUP}>
          <Item value={`update ${name} everywhere`} icon={<ArrowUpCircle />} onSelect={() => onAlign(latest)}>
            Update {name} to {latest} in {behind} {behind === 1 ? "project" : "projects"}
          </Item>
        </Command.Group>
      ) : null}
      <Command.Group heading={`Used in ${uses.length} ${uses.length === 1 ? "project" : "projects"}`} className={GROUP}>
        {uses.map((use) => (
          <Item
            key={use.project.id}
            value={`${use.project.name} ${use.project.id}`}
            icon={<FolderGit2 />}
            hint={
              <span className="font-mono">
                {use.installed ?? use.spec}
                {use.latest ? <span className="text-warn"> → {use.latest}</span> : null}
              </span>
            }
            onSelect={() => onOpen(use.project.id)}
          >
            {use.project.name}
          </Item>
        ))}
      </Command.Group>
    </>
  );
}

/** Updates the package in every project that is behind, two projects at a time, each running its own checks. */
async function alignAll(svc: ReturnType<typeof useServices>, name: string, version: string) {
  try {
    const projects = await svc.store.listProjects();
    const reports = await Promise.all(projects.map((project) => refreshProject(svc, project.id)));
    const plans = projects.flatMap((project, i) => {
      const entry = reports[i]?.outdated.find((e) => e.name === name);
      if (!entry || (entry.current && semver.valid(entry.current) && semver.gte(entry.current, version))) return [];
      return [{ projectId: project.id, name: project.name, picks: [{ entry, version }] }];
    });
    if (plans.length === 0) return toast(`${name} is already at ${version} everywhere.`);
    startBatch(svc, plans);
    toast(
      `Updating ${name} in ${plans.length} ${plans.length === 1 ? "project" : "projects"}. Results show on Overview.`,
    );
  } catch (error) {
    toastError(error);
  }
}
