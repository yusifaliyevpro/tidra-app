import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Command } from "cmdk";
import { FolderGit2, Package, Pause, Play, RefreshCw, Workflow } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { MODULES } from "./modules";
import { useActions, useReports } from "./queries";
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
  hint?: string;
}) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="flex h-8 items-center gap-2.5 rounded-md px-2.5 text-base text-muted data-[selected=true]:bg-raised data-[selected=true]:text-fg [&_svg]:size-4 [&_svg]:shrink-0"
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint ? <span className="text-xs text-faint">{hint}</span> : null}
    </Command.Item>
  );
}

const GROUP = "px-1 text-xs text-faint [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5";

export function Palette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const svc = useServices();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data: reports } = useReports();
  const { data: actions } = useActions();
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = dialog.current;
    if (open && el && !el.open) el.showModal();
    if (!open && el?.open) el.close();
  }, [open]);

  const run = (action: () => void) => {
    onClose();
    action();
  };

  const packages = new Set(
    (reports ?? []).flatMap(({ report }) => (report?.outdated ?? []).map((entry) => entry.name)),
  );
  const actionRepos = new Set(
    (actions ?? []).flatMap(({ report }) => (report?.items ?? []).filter((i) => i.next).map((i) => i.repo)),
  );
  const paused = svc.scheduler.isPaused();

  return (
    <dialog
      ref={dialog}
      aria-label="Command palette"
      onClose={onClose}
      onCancel={onClose}
      className="mx-auto mt-[12vh] w-[560px] max-w-[92vw] rounded-lg border border-line-strong bg-surface p-0 text-fg shadow-2xl backdrop:bg-black/50"
    >
      {open ? (
        <Command label="Command palette" loop className="flex max-h-[60vh] flex-col">
          <Command.Input
            autoFocus
            placeholder="Search or run a command"
            className="h-11 shrink-0 border-b border-line bg-transparent px-4 text-base outline-none placeholder:text-faint"
          />
          <Command.List className="min-h-0 overflow-y-auto p-1.5">
            <Command.Empty className="px-3 py-6 text-center text-sm text-muted">No matches.</Command.Empty>
            <Command.Group heading="Projects" className={GROUP}>
              {(reports ?? []).map(({ project }) => (
                <Item
                  key={project.id}
                  value={`project ${project.name}`}
                  icon={<FolderGit2 />}
                  onSelect={() =>
                    run(() => void navigate({ to: "/projects/$projectId", params: { projectId: project.id } }))
                  }
                >
                  {project.name}
                </Item>
              ))}
            </Command.Group>
            <Command.Group heading="Outdated packages" className={GROUP}>
              {[...packages].slice(0, 200).map((name) => (
                <Item
                  key={name}
                  value={`package ${name}`}
                  icon={<Package />}
                  onSelect={() => run(() => void navigate({ to: "/deps", search: { q: name } }))}
                >
                  {name}
                </Item>
              ))}
            </Command.Group>
            {actionRepos.size > 0 ? (
              <Command.Group heading="Outdated actions" className={GROUP}>
                {[...actionRepos].map((repo) => (
                  <Item
                    key={repo}
                    value={`action ${repo}`}
                    icon={<Workflow />}
                    onSelect={() => run(() => void navigate({ to: "/actions" }))}
                  >
                    {repo}
                  </Item>
                ))}
              </Command.Group>
            ) : null}
            <Command.Group heading="Pages" className={GROUP}>
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
                value="refresh all"
                icon={<RefreshCw />}
                onSelect={() => run(() => void svc.scheduler.runAll().then(() => queryClient.invalidateQueries()))}
              >
                Refresh everything now
              </Item>
              <Item
                value={paused ? "resume background checks" : "pause background checks"}
                icon={paused ? <Play /> : <Pause />}
                onSelect={() => run(() => svc.scheduler.setPaused(!paused))}
              >
                {paused ? "Resume background checks" : "Pause background checks"}
              </Item>
            </Command.Group>
          </Command.List>
        </Command>
      ) : null}
    </dialog>
  );
}
