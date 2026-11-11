import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, Clock } from "lucide-react";
import { useId, useState } from "react";
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
import { ReleaseAge, shortSpan } from "@/ui/time";
import { toastError } from "@/ui/toast";

const ORDER: Bump[] = ["major", "minor", "patch", "prerelease"];
const GROUP_LABEL: Record<Bump, string> = {
  major: "Major",
  minor: "Minor",
  patch: "Patch",
  prerelease: "Prerelease",
  none: "",
};

const BUMP_COLOR: Record<Bump, string> = {
  major: "text-bad",
  minor: "text-warn",
  patch: "text-ok",
  prerelease: "text-muted",
  none: "text-muted",
};

const HELD_BACK = "A newer version is younger than this project's minimumReleaseAge";

/** Why a waiting update can't be picked yet, and for how long. */
function waitingNote(entry: OutdatedEntry, now = Date.now()) {
  const left = entry.readyAt ? Date.parse(entry.readyAt) - now : 0;
  return left > 0
    ? `Younger than this project's minimumReleaseAge. It can be updated in ${shortSpan(left)}.`
    : "Younger than this project's minimumReleaseAge. Check again to update it.";
}

const keyOf = (entry: OutdatedEntry) => `${entry.name}\u0000${entry.range}\u0000${entry.catalog ?? ""}`;

/** Adds all `keys`, or removes them when every one is already picked. */
function toggled(picked: ReadonlySet<string>, keys: string[]): ReadonlySet<string> {
  const next = new Set(picked);
  const all = keys.every((key) => next.has(key));
  for (const key of keys) {
    if (all) next.delete(key);
    else next.add(key);
  }
  return next;
}

const checkState = (count: number, total: number) => (count === 0 ? false : count === total ? true : "mixed");

/**
 * Picks survive background refreshes of the report; a pick whose package is no longer outdated (it was just
 * updated) simply stops counting.
 */
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
  const waiting = report.waiting ?? [];
  const keys = entries.map(keyOf);
  const waitingKeys = new Set(waiting.map(keyOf));
  const [selected, setSelected] = useState<string | undefined>(keys[0] ?? [...waitingKeys][0]);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [targets, setTargets] = useState<Record<string, string>>({});
  const chosen = entries.filter((e) => picked.has(keyOf(e)));
  const toggle = (group: string[]) => setPicked((previous) => toggled(previous, group));

  useListKeys({
    ids: [...keys, ...waitingKeys],
    selected,
    onSelect: setSelected,
    onToggle: (key) => {
      if (!waitingKeys.has(key)) toggle([key]);
    },
  });

  const update = useMutation({
    mutationFn: () =>
      startUpdate(
        svc,
        projectId,
        chosen.map((entry) => ({ entry, version: targets[keyOf(entry)] ?? entry.latest })),
      ),
    onSuccess: (id) => {
      onStarted(id);
      setPicked(new Set());
    },
    onError: toastError,
  });

  if (entries.length === 0 && waiting.length === 0) {
    return (
      <div className="p-5">
        {report.registryErrors.length > 0 ? (
          <ErrorNote>Could not check {report.registryErrors.map((e) => e.name).join(", ")}.</ErrorNote>
        ) : null}
        <Empty title="Up to date" />
      </div>
    );
  }

  const current = [...entries, ...waiting].find((e) => keyOf(e) === selected) ?? entries[0] ?? waiting[0];
  const currentKey = current ? keyOf(current) : undefined;

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
                const groupKeys = group.map(keyOf);
                return (
                  <div key={bump}>
                    <GroupHeader
                      bump={bump}
                      count={groupKeys.filter((k) => picked.has(k)).length}
                      total={group.length}
                      onToggle={() => toggle(groupKeys)}
                    />
                    {group.map((entry) => {
                      const key = keyOf(entry);
                      return (
                        <DependencyRow
                          key={key}
                          rowKey={key}
                          entry={entry}
                          target={targets[key] ?? entry.latest}
                          picked={picked.has(key)}
                          current={currentKey === key}
                          onToggle={toggle}
                          onSelect={setSelected}
                        />
                      );
                    })}
                  </div>
                );
              })}
              {waiting.length > 0 ? (
                <div>
                  <div className="sticky top-0 z-10 flex h-8 items-center gap-2.5 border-b border-line bg-canvas px-4 text-sm">
                    <span className="font-medium text-muted">Waiting for minimumReleaseAge</span>
                    <span className="ml-auto text-faint tabular">{waiting.length}</span>
                  </div>
                  {waiting.map((entry) => {
                    const key = keyOf(entry);
                    return (
                      <DependencyRow
                        key={key}
                        rowKey={key}
                        entry={entry}
                        target={entry.latest}
                        picked={false}
                        waiting
                        current={currentKey === key}
                        onToggle={toggle}
                        onSelect={setSelected}
                      />
                    );
                  })}
                </div>
              ) : null}
            </div>
          }
          detail={
            current && currentKey ? (
              <DependencyDetail
                entry={current}
                waiting={waitingKeys.has(currentKey)}
                target={targets[currentKey] ?? current.latest}
                onTarget={(version) => setTargets({ ...targets, [currentKey]: version })}
              />
            ) : null
          }
        />
      </div>
      <footer className="flex h-12 shrink-0 items-center gap-3 border-t border-line pr-5">
        <label className="flex h-full items-center gap-2.5 pr-2 pl-4 text-sm text-muted">
          <Checkbox
            label="Select all updates"
            checked={checkState(chosen.length, entries.length)}
            disabled={entries.length === 0}
            onChange={() => toggle(keys)}
          />
          {chosen.length > 0 ? `${chosen.length} selected` : `All ${entries.length}`}
        </label>
        <span className="ml-auto truncate text-sm text-faint">
          {report.checks.length > 0 ? `Checks: ${report.checks.join(", ")}` : "No checks detected"}
        </span>
        <Button
          variant="primary"
          disabled={chosen.length === 0}
          loading={update.isPending}
          onClick={() => update.mutate()}
        >
          {chosen.length > 1 ? `Update ${chosen.length} packages` : "Update"}
        </Button>
      </footer>
    </div>
  );
}

/** A section title that also picks its whole group: the full row is the hit target. */
function GroupHeader({
  bump,
  count,
  total,
  onToggle,
}: {
  bump: Bump;
  count: number;
  total: number;
  onToggle: () => void;
}) {
  return (
    <label className="sticky top-0 z-10 flex h-8 items-center gap-2.5 border-b border-line bg-canvas px-4 text-sm">
      <Checkbox label={`Select all ${bump} updates`} checked={checkState(count, total)} onChange={onToggle} />
      <span className={`font-medium ${BUMP_COLOR[bump]}`}>{GROUP_LABEL[bump]}</span>
      <span className="ml-auto text-faint tabular">{count > 0 ? `${count} of ${total}` : total}</span>
    </label>
  );
}

/** The checkbox sits in a full-height label, so the whole left edge of the row picks it. */
function DependencyRow({
  rowKey,
  entry,
  target,
  picked,
  waiting = false,
  current,
  onToggle,
  onSelect,
}: {
  rowKey: string;
  entry: OutdatedEntry;
  target: string;
  picked: boolean;
  waiting?: boolean;
  current: boolean;
  onToggle: (keys: string[]) => void;
  onSelect: (key: string) => void;
}) {
  const id = useId();
  return (
    <div
      data-row-id={rowKey}
      className={`flex h-9 items-center border-b border-line hover:bg-hover ${current ? "bg-selected" : ""}`}
    >
      <label
        htmlFor={id}
        title={waiting ? waitingNote(entry) : undefined}
        className={`flex h-full shrink-0 items-center pr-2.5 pl-4 ${waiting ? "opacity-45" : ""}`}
      >
        <Checkbox
          id={id}
          label={`Select ${entry.name}`}
          checked={picked}
          disabled={waiting}
          onChange={() => onToggle([rowKey])}
        />
        <span className="sr-only">Select {entry.name}</span>
      </label>
      <button
        type="button"
        aria-current={current || undefined}
        title={waiting ? waitingNote(entry) : undefined}
        onClick={() => onSelect(rowKey)}
        className={`flex h-full min-w-0 flex-1 items-center gap-2.5 pr-4 text-left ${waiting ? "opacity-45" : ""}`}
      >
        <span className="min-w-0 flex-1 truncate font-medium">{entry.name}</span>
        {entry.deprecated ? (
          <AlertTriangle className="size-3.5 text-warn" aria-label="Installed version is deprecated" />
        ) : null}
        {entry.heldBackByAge || waiting ? (
          <span title={waiting ? waitingNote(entry) : HELD_BACK} className="flex">
            <Clock className="size-3.5 text-faint" aria-label={waiting ? waitingNote(entry) : HELD_BACK} />
          </span>
        ) : null}
        <Mono className="text-muted">{entry.current ?? entry.range}</Mono>
        <ArrowRight className="size-3 text-faint" />
        <Mono className={BUMP_COLOR[entry.bump]}>{target}</Mono>
        <ReleaseAge value={target === entry.latest ? entry.publishedAt : undefined} />
      </button>
    </div>
  );
}

function DependencyDetail({
  entry,
  waiting,
  target,
  onTarget,
}: {
  entry: OutdatedEntry;
  waiting: boolean;
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
        {choices.length > 1 && !waiting ? (
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
        {entry.heldBackByAge ? <p className="text-sm text-muted">{HELD_BACK}.</p> : null}
        {waiting ? <p className="text-sm text-muted">{waitingNote(entry)}</p> : null}
        {entry.enginesNode ? <p className="text-sm text-muted">Requires Node {entry.enginesNode}</p> : null}
      </div>
      <ChangelogPanel name={entry.name} from={entry.current} to={target} />
    </div>
  );
}
