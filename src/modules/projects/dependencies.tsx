import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, Clock } from "lucide-react";
import { useState } from "react";
import { useServices } from "@/app/services";
import { useListKeys } from "@/app/shortcuts";
import type { OutdatedEntry } from "@/engine/outdated";
import type { Bump } from "@/engine/versions";
import { ChangelogPanel } from "@/modules/changelog-panel";
import type { ProjectReport } from "@/services/projects";
import { startUpdate } from "@/services/updates";
import { Badge, BumpBadge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { Checkbox } from "@/ui/field";
import { Empty, ErrorNote, Split } from "@/ui/layout";
import { Mono } from "@/ui/misc";
import { toastError } from "@/ui/toast";

const ORDER: Bump[] = ["major", "minor", "patch", "prerelease"];
const GROUP_LABEL: Record<Bump, string> = {
  major: "Major",
  minor: "Minor",
  patch: "Patch",
  prerelease: "Prerelease",
  none: "",
};

const keyOf = (entry: OutdatedEntry) => `${entry.name}\u0000${entry.range}\u0000${entry.catalog ?? ""}`;

/** `onStarted` lives with the page: a finished run refreshes the report, which remounts this list. */
export function Dependencies({
  projectId,
  report,
  onStarted,
}: {
  projectId: string;
  report: ProjectReport;
  onStarted: (runId: string) => void;
}) {
  const svc = useServices();
  const entries = ORDER.flatMap((bump) => report.outdated.filter((e) => e.bump === bump));
  const [selected, setSelected] = useState<string | undefined>(entries[0] ? keyOf(entries[0]) : undefined);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [targets, setTargets] = useState<Record<string, string>>({});

  const toggle = (key: string) => {
    const next = new Set(picked);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setPicked(next);
  };

  useListKeys({ ids: entries.map(keyOf), selected, onSelect: setSelected, onToggle: toggle });

  const update = useMutation({
    mutationFn: (keys: Set<string>) =>
      startUpdate(
        svc,
        projectId,
        entries
          .filter((e) => keys.has(keyOf(e)))
          .map((entry) => ({ entry, version: targets[keyOf(entry)] ?? entry.latest })),
      ),
    onSuccess: (id) => {
      onStarted(id);
      setPicked(new Set());
    },
    onError: toastError,
  });

  if (entries.length === 0) {
    return (
      <div className="p-5">
        {report.registryErrors.length > 0 ? (
          <ErrorNote>Could not check {report.registryErrors.map((e) => e.name).join(", ")}.</ErrorNote>
        ) : null}
        <Empty title="Up to date" />
      </div>
    );
  }

  const current = entries.find((e) => keyOf(e) === selected);
  const setTarget = (key: string, version: string) => setTargets({ ...targets, [key]: version });
  const pickGroup = (bump: Bump) => {
    const next = new Set(picked);
    const keys = entries.filter((e) => e.bump === bump).map(keyOf);
    const all = keys.every((k) => next.has(k));
    for (const k of keys) {
      if (all) next.delete(k);
      else next.add(k);
    }
    setPicked(next);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1">
        <Split
          listWidth={420}
          list={
            <div className="min-h-0 flex-1 overflow-y-auto">
              {ORDER.map((bump) => {
                const group = entries.filter((e) => e.bump === bump);
                if (group.length === 0) return null;
                const keys = group.map(keyOf);
                const count = keys.filter((k) => picked.has(k)).length;
                return (
                  <div key={bump}>
                    <div className="sticky top-0 z-10 flex h-8 items-center gap-2.5 border-b border-line bg-bg px-4 text-xs text-faint">
                      <Checkbox
                        label={`Select all ${bump} updates`}
                        checked={count === 0 ? false : count === keys.length ? true : "mixed"}
                        onChange={() => pickGroup(bump)}
                      />
                      {GROUP_LABEL[bump]} · {group.length}
                    </div>
                    {group.map((entry) => {
                      const key = keyOf(entry);
                      const target = targets[key] ?? entry.latest;
                      return (
                        <div
                          key={key}
                          data-row-id={key}
                          className={`flex h-10 items-center gap-2.5 border-b border-line pl-4 hover:bg-hover ${selected === key ? "bg-raised" : ""}`}
                        >
                          <Checkbox
                            label={`Select ${entry.name}`}
                            checked={picked.has(key)}
                            onChange={() => toggle(key)}
                          />
                          <button
                            type="button"
                            aria-current={selected === key || undefined}
                            onClick={() => setSelected(key)}
                            className="flex h-full min-w-0 flex-1 items-center gap-2.5 pr-4 text-left"
                          >
                            <span className="min-w-0 flex-1 truncate font-medium">{entry.name}</span>
                            {entry.deprecated ? (
                              <AlertTriangle
                                className="size-3.5 text-warn"
                                aria-label="Installed version is deprecated"
                              />
                            ) : null}
                            {entry.heldBackByAge ? (
                              <Clock
                                className="size-3.5 text-faint"
                                aria-label="Newer versions are younger than minimumReleaseAge"
                              />
                            ) : null}
                            <Mono className="text-muted">{entry.current ?? entry.range}</Mono>
                            <ArrowRight className="size-3 text-faint" />
                            <Mono
                              className={bump === "major" ? "text-bad" : bump === "minor" ? "text-warn" : "text-ok"}
                            >
                              {target}
                            </Mono>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          }
          detail={
            current ? (
              <DependencyDetail
                entry={current}
                target={targets[keyOf(current)] ?? current.latest}
                onTarget={(version) => setTarget(keyOf(current), version)}
              />
            ) : null
          }
        />
      </div>
      <footer className="flex h-12 shrink-0 items-center gap-3 border-t border-line px-5">
        {picked.size > 0 ? <span className="text-sm text-muted">{picked.size} selected</span> : null}
        <span className="ml-auto text-sm text-faint">
          {report.checks.length > 0 ? `Checks: ${report.checks.join(", ")}` : "No checks detected"}
        </span>
        <Button
          variant="primary"
          disabled={picked.size === 0}
          loading={update.isPending}
          onClick={() => update.mutate(new Set(picked))}
        >
          {picked.size > 1 ? `Update ${picked.size} packages` : "Update"}
        </Button>
      </footer>
    </div>
  );
}

function DependencyDetail({
  entry,
  target,
  onTarget,
}: {
  entry: OutdatedEntry;
  target: string;
  onTarget: (version: string) => void;
}) {
  const choices = [
    ...new Set([entry.latest, entry.wanted].filter((v): v is string => Boolean(v) && v !== entry.current)),
  ];
  return (
    <div className="flex flex-col gap-4 p-5">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-medium">{entry.name}</h2>
          <BumpBadge bump={entry.bump} />
          {entry.catalog ? <Badge>catalog: {entry.catalog}</Badge> : null}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
          <span>
            Installed <Mono className="text-fg">{entry.current ?? "unknown"}</Mono>
            {!entry.currentFromLockfile ? " (from range)" : null}
          </span>
          <span>
            Range <Mono className="text-fg">{entry.range}</Mono>
          </span>
          <span>Used in {entry.usages.map((u) => (u.importer === "." ? "root" : u.importer)).join(", ")}</span>
        </div>
        {choices.length > 1 ? (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted">Update to</span>
            {choices.map((version) => (
              <Button
                key={version}
                size="sm"
                variant={target === version ? "primary" : "secondary"}
                onClick={() => onTarget(version)}
              >
                {version}
                {version === entry.latest ? " (latest)" : " (in range)"}
              </Button>
            ))}
          </div>
        ) : null}
        {entry.deprecated ? <ErrorNote>Installed version is deprecated: {entry.deprecated}</ErrorNote> : null}
        {entry.heldBackByAge ? (
          <p className="text-sm text-muted">
            A newer version exists but is younger than this project's minimumReleaseAge.
          </p>
        ) : null}
        {entry.enginesNode ? <p className="text-sm text-muted">Requires Node {entry.enginesNode}</p> : null}
      </div>
      <ChangelogPanel name={entry.name} from={entry.current} to={target} />
    </div>
  );
}
