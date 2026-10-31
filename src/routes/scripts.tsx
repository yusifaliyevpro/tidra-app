import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Square, SquareTerminal, Trash2, X } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { useApp } from "@/app/services";
import { inTauri, killProcess, listPorts } from "@/core/native";
import { display } from "@/engine/pm";
import { Badge } from "@/ui/badge";
import { IconButton } from "@/ui/button";
import { Card, Empty, Note, Page, Section, Split } from "@/ui/layout";
import { Log } from "@/ui/log";
import { Mono, Tabs } from "@/ui/misc";
import { toast, toastError } from "@/ui/toast";

export const Route = createFileRoute("/scripts")({ component: Scripts });

type Tab = "processes" | "ports";

function Scripts() {
  const [tab, setTab] = useState<Tab>("processes");
  return (
    <Page title="Scripts and ports" className="flex flex-col overflow-hidden">
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        items={[
          { id: "processes", label: "Running scripts" },
          { id: "ports", label: "Listening ports" },
        ]}
      />
      <div className="min-h-0 flex-1">{tab === "processes" ? <Processes /> : <Ports />}</div>
    </Page>
  );
}

function Processes() {
  const { processes } = useApp();
  const list = useSyncExternalStore(
    (listener) => processes.subscribe(listener),
    () => processes.snapshot(),
  );
  const [selected, setSelected] = useState<string>();
  const current = list.find((p) => p.id === selected) ?? list[0];

  if (list.length === 0) {
    return (
      <Empty icon={<SquareTerminal />} title="Nothing running">
        Start a script from a project's Scripts tab.
      </Empty>
    );
  }
  return (
    <Split
      listWidth={320}
      list={
        <div className="min-h-0 flex-1 overflow-y-auto">
          {list.map((proc) => (
            <button
              type="button"
              key={proc.id}
              aria-label={proc.label}
              onClick={() => setSelected(proc.id)}
              className={`flex w-full items-center gap-2 border-b border-line px-4 py-2 text-left hover:bg-hover ${current?.id === proc.id ? "bg-raised" : ""}`}
            >
              <span
                className={`size-2 shrink-0 rounded-full ${proc.running ? "bg-ok" : proc.exitCode === 0 ? "bg-faint" : "bg-bad"}`}
              />
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{proc.label}</span>
                <span className="truncate font-mono text-xs text-faint">{display(proc.command)}</span>
              </span>
            </button>
          ))}
        </div>
      }
      detail={
        current ? (
          <div className="flex h-full flex-col gap-3 p-4">
            <div className="flex items-center gap-2">
              <span className="font-medium">{current.label}</span>
              {current.running ? (
                <Badge tone="ok">running</Badge>
              ) : (
                <Badge tone={current.exitCode === 0 ? "neutral" : "bad"}>exit {current.exitCode ?? "killed"}</Badge>
              )}
              <span className="ml-auto flex gap-1">
                {current.running ? (
                  <IconButton
                    label="Stop"
                    icon={<Square className="size-3.5" />}
                    onClick={() => processes.stop(current.id)}
                  />
                ) : null}
                <IconButton
                  label="Close"
                  icon={<X className="size-4" />}
                  onClick={() => processes.remove(current.id)}
                />
              </span>
            </div>
            <Log text={current.output} className="min-h-0 flex-1" />
          </div>
        ) : null
      }
    />
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
      <div className="mx-auto max-w-4xl p-5">
        <Section title="Listening TCP ports">
          <Card>
            {(ports.data ?? []).map((port) => (
              <div
                key={`${port.port}:${port.pid}`}
                className="flex h-10 items-center gap-3 border-b border-line px-4 text-sm last:border-b-0"
              >
                <Mono className="w-16 font-medium">{port.port}</Mono>
                <span className="min-w-0 flex-1 truncate">{port.process}</span>
                <Mono className="text-xs text-faint">pid {port.pid}</Mono>
                <Mono className="w-28 text-xs text-faint">{port.address}</Mono>
                <IconButton
                  size="sm"
                  label={`Stop ${port.process}`}
                  icon={<Trash2 className="size-3.5" />}
                  onClick={() => kill.mutate(port.pid)}
                />
              </div>
            ))}
          </Card>
        </Section>
      </div>
    </div>
  );
}
