import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { cn } from "cn";
import { Play, RotateCcw, Search, Square, SquareTerminal, Trash2, X } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { useReports } from "@/app/queries";
import { useApp } from "@/app/services";
import { inTauri, killProcess, listPorts } from "@/core/native";
import { display, scriptCommand } from "@/engine/pm";
import type { ManagedProcess } from "@/services/processes";
import type { readAllReports } from "@/services/projects";
import { Button, IconButton } from "@/ui/button";
import { ErrorBoundary } from "@/ui/error-boundary";
import { Empty, Note, Page, Split } from "@/ui/layout";
import { Log } from "@/ui/log";
import { Mono, Tabs } from "@/ui/misc";
import { toast, toastError } from "@/ui/toast";

export const Route = createFileRoute("/scripts")({ component: Scripts });

type Tab = "scripts" | "ports";
type Row = Awaited<ReturnType<typeof readAllReports>>[number];
type Selection = { kind: "process"; id: string } | { kind: "project"; id: string };

function Scripts() {
  const [tab, setTab] = useState<Tab>("scripts");
  return (
    <Page title="Scripts" className="flex flex-col overflow-hidden">
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        items={[
          { id: "scripts", label: "Scripts" },
          { id: "ports", label: "Listening ports" },
        ]}
      />
      <div className="min-h-0 flex-1">{tab === "scripts" ? <Launcher /> : <Ports />}</div>
    </Page>
  );
}

function useProcesses() {
  const { processes } = useApp();
  const list = useSyncExternalStore(
    (listener) => processes.subscribe(listener),
    () => processes.snapshot(),
  );
  return { processes, list };
}

/** Running scripts on top, every project below; pick a project to start any of its scripts without a terminal. */
function Launcher() {
  const { processes, list } = useProcesses();
  const { data: rows = [] } = useReports();
  const [query, setQuery] = useState("");
  const [selection, setSelection] = useState<Selection>();
  const q = query.trim().toLowerCase();
  const projects = rows.filter(
    ({ project, report }) =>
      Object.keys(report?.scripts ?? {}).length > 0 && (!q || project.name.toLowerCase().includes(q)),
  );
  const current: Selection | undefined =
    selection ??
    (list[0]
      ? { kind: "process", id: list[0].id }
      : projects[0]
        ? { kind: "project", id: projects[0].project.id }
        : undefined);

  const run = (row: Row, name: string) => {
    if (!row.report || !row.project.path) return;
    const id = processes.start({
      label: `${row.project.name}: ${name}`,
      command: scriptCommand(row.report.pm, name),
      cwd: row.project.path,
      projectId: row.project.id,
    });
    setSelection({ kind: "process", id });
  };

  return (
    <Split
      listWidth={300}
      list={
        <div className="flex min-h-0 flex-1 flex-col">
          <label className="relative flex items-center border-b border-line">
            <Search className="pointer-events-none absolute left-4 size-3.5 text-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter projects"
              aria-label="Filter projects"
              spellCheck={false}
              className="h-10 w-full bg-transparent pr-3 pl-10 text-base placeholder:text-faint focus:outline-none"
            />
          </label>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {list.length > 0 ? <ListHeading>Running</ListHeading> : null}
            {list.map((proc) => (
              <ProcessItem
                key={proc.id}
                proc={proc}
                selected={current?.kind === "process" && current.id === proc.id}
                onSelect={() => setSelection({ kind: "process", id: proc.id })}
              />
            ))}
            <ListHeading>Projects</ListHeading>
            {projects.map(({ project, report }) => (
              <button
                key={project.id}
                type="button"
                onClick={() => setSelection({ kind: "project", id: project.id })}
                className={cn(
                  "flex h-10 w-full items-center gap-2 border-b border-line px-4 text-left hover:bg-hover",
                  current?.kind === "project" && current.id === project.id && "bg-raised",
                )}
              >
                <span className="min-w-0 flex-1 truncate">{project.name}</span>
                <span className="text-xs text-faint tabular">{Object.keys(report?.scripts ?? {}).length}</span>
              </button>
            ))}
          </div>
        </div>
      }
      detail={
        <ErrorBoundary key={current ? `${current.kind}:${current.id}` : "none"}>
          {current?.kind === "process" ? (
            <ProcessDetail
              proc={list.find((p) => p.id === current.id)}
              onRestart={(proc) =>
                setSelection({
                  kind: "process",
                  id: processes.start({
                    label: proc.label,
                    command: proc.command,
                    cwd: proc.cwd,
                    projectId: proc.projectId,
                  }),
                })
              }
              onStop={(id) => processes.stop(id)}
              onClose={(id) => {
                processes.remove(id);
                setSelection(undefined);
              }}
            />
          ) : current?.kind === "project" ? (
            <ProjectScripts row={rows.find((r) => r.project.id === current.id)} onRun={run} />
          ) : (
            <Empty icon={<SquareTerminal />} title="No scripts" />
          )}
        </ErrorBoundary>
      }
    />
  );
}

function ListHeading({ children }: { children: string }) {
  return (
    <div className="sticky top-0 z-10 flex h-7 items-center border-b border-line bg-bg px-4 text-xs text-faint">
      {children}
    </div>
  );
}

function ProcessItem({ proc, selected, onSelect }: { proc: ManagedProcess; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      aria-label={proc.label}
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-2.5 border-b border-line px-4 py-2 text-left hover:bg-hover",
        selected && "bg-raised",
      )}
    >
      <span
        className={cn(
          "size-2 shrink-0 rounded-full",
          proc.running ? "bg-ok" : proc.exitCode === 0 ? "bg-faint" : "bg-bad",
        )}
      />
      <span className="flex min-w-0 flex-col">
        <span className="truncate">{proc.label}</span>
        <span className="truncate font-mono text-xs text-faint">{display(proc.command)}</span>
      </span>
    </button>
  );
}

/** Scripts people start most come first; the rest keep package.json order. */
const PREFERRED = ["dev", "start", "build", "test", "check", "lint", "typecheck", "format"];
const rank = (name: string) => {
  const index = PREFERRED.indexOf(name);
  return index === -1 ? PREFERRED.length : index;
};

function ProjectScripts({ row, onRun }: { row: Row | undefined; onRun: (row: Row, name: string) => void }) {
  if (!row?.report) return <Empty title="Project not checked yet" />;
  const scripts = Object.entries(row.report.scripts).toSorted(([a], [b]) => rank(a) - rank(b));
  return (
    <div className="flex flex-col">
      <div className="flex h-12 items-center gap-3 border-b border-line px-5">
        <span className="font-medium">{row.project.name}</span>
        <span className="text-sm text-faint">{row.report.pm.name}</span>
      </div>
      {scripts.map(([name, command]) => (
        <div key={name} className="flex h-11 items-center gap-3 border-b border-line px-5 hover:bg-hover">
          <span className="w-40 shrink-0 truncate font-medium">{name}</span>
          <Mono className="min-w-0 flex-1 truncate text-muted">{command}</Mono>
          <Button size="sm" icon={<Play className="size-3.5" />} onClick={() => onRun(row, name)}>
            Run
          </Button>
        </div>
      ))}
    </div>
  );
}

function ProcessDetail({
  proc,
  onRestart,
  onStop,
  onClose,
}: {
  proc: ManagedProcess | undefined;
  onRestart: (proc: ManagedProcess) => void;
  onStop: (id: string) => void;
  onClose: (id: string) => void;
}) {
  if (!proc) return <Empty title="This script was closed" />;
  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <span className="font-medium">{proc.label}</span>
        <span className={cn("text-sm", proc.running ? "text-ok" : proc.exitCode === 0 ? "text-muted" : "text-bad")}>
          {proc.running ? "Running" : proc.exitCode === 0 ? "Finished" : `Exited ${proc.exitCode ?? "(stopped)"}`}
        </span>
        <span className="ml-auto flex gap-1">
          {proc.running ? (
            <Button size="sm" icon={<Square className="size-3.5" />} onClick={() => onStop(proc.id)}>
              Stop
            </Button>
          ) : (
            <Button size="sm" icon={<RotateCcw className="size-3.5" />} onClick={() => onRestart(proc)}>
              Run again
            </Button>
          )}
          <IconButton label="Close" icon={<X className="size-4" />} onClick={() => onClose(proc.id)} />
        </span>
      </div>
      <Log text={proc.output} className="min-h-0 flex-1" />
    </div>
  );
}

function Ports() {
  const ports = useQuery({
    queryKey: ["ports"],
    queryFn: listPorts,
    enabled: inTauri,
    refetchInterval: 5000,
    staleTime: 0,
  });
  const kill = useMutation({
    mutationFn: (pid: number) => killProcess(pid),
    onSuccess: () => {
      toast("Process stopped.");
      void ports.refetch();
    },
    onError: toastError,
  });
  if (!inTauri)
    return (
      <div className="p-5">
        <Note>Ports are only available in the desktop app.</Note>
      </div>
    );
  return (
    <div className="h-full overflow-y-auto">
      <table className="w-full table-fixed text-left text-sm">
        <thead className="sticky top-0 bg-bg text-xs text-faint">
          <tr className="h-8 border-b border-line">
            <th className="w-24 pl-5 font-normal">Port</th>
            <th className="font-normal">Process</th>
            <th className="w-28 font-normal">PID</th>
            <th className="w-40 font-normal">Address</th>
            <th className="w-16 pr-5 font-normal">
              <span className="sr-only">Stop</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {(ports.data ?? []).map((port) => (
            <tr key={`${port.port}:${port.pid}`} className="h-10 border-b border-line hover:bg-hover">
              <td className="pl-5">
                <Mono className="font-medium">{port.port}</Mono>
              </td>
              <td className="truncate">{port.process}</td>
              <td>
                <Mono className="text-xs text-faint">{port.pid}</Mono>
              </td>
              <td>
                <Mono className="text-xs text-faint">{port.address}</Mono>
              </td>
              <td className="pr-5 text-right">
                <IconButton
                  size="sm"
                  label={`Stop ${port.process}`}
                  icon={<Trash2 className="size-3.5" />}
                  onClick={() => kill.mutate(port.pid)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
