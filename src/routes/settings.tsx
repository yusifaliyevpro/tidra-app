import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { getVersion } from "@tauri-apps/api/app";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import * as z from "@zod/mini";
import { cn } from "cn";
import {
  Bell,
  Cloud,
  Database,
  GitPullRequest,
  Monitor,
  RefreshCw,
  Rocket,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { DEFAULT_PALETTE_SHORTCUT, PALETTE_SHORTCUT_SETTING } from "@/app/accelerator";
import {
  ACCENT_SETTING,
  applyAppearance,
  applyHotkey,
  DEFAULT_ACCENT,
  DEFAULT_HOTKEY,
  HOTKEY_SETTING,
} from "@/app/desktop";
import { useJobs, useSetting } from "@/app/queries";
import { useServices } from "@/app/services";
import { inTauri } from "@/core/native";
import { SEVERITIES, type Severity } from "@/engine/advisories";
import { AI_PROVIDERS, DEFAULT_AI_CONFIG } from "@/integrations/ai";
import { DEPLOY_PROVIDERS } from "@/integrations/deploy";
import { DeleteAllData } from "@/modules/settings/delete-data";
import { GitHubSettings } from "@/modules/settings/github";
import { SettingRow, SettingsGroup } from "@/modules/settings/rows";
import { SecretField } from "@/modules/settings/secret-field";
import { ShortcutInput } from "@/modules/settings/shortcut-input";
import { SyncSettings } from "@/modules/settings/sync";
import { AI_CONFIG_SETTING, readAiConfig } from "@/services/ai";
import { CI_THRESHOLD_SETTING, readCiThreshold } from "@/services/home";
import { JOB_INTERVALS_SETTING, JOBS, readJobIntervals } from "@/services/jobs";
import { NOTIFICATION_KINDS, NOTIFY_SETTING, readNotifyPrefs } from "@/services/notify";
import { Button } from "@/ui/button";
import { Input, Select, Switch } from "@/ui/field";
import { ErrorNote } from "@/ui/layout";
import { ExternalLink } from "@/ui/markdown";
import { TimeAgo } from "@/ui/time";
import { toast, toastError } from "@/ui/toast";

const SECTIONS = [
  { id: "general", label: "General", icon: Monitor },
  { id: "github", label: "GitHub", icon: GitPullRequest },
  { id: "sync", label: "Sync", icon: Cloud },
  { id: "deploys", label: "Deploys", icon: Rocket },
  { id: "ai", label: "AI", icon: Sparkles },
  { id: "security", label: "Security", icon: ShieldCheck },
  { id: "checks", label: "Background checks", icon: RefreshCw },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "data", label: "Data", icon: Database },
] as const satisfies readonly { id: string; label: string; icon: LucideIcon }[];

type SectionId = (typeof SECTIONS)[number]["id"];

export const Route = createFileRoute("/settings")({
  validateSearch: z.object({ section: z.optional(z.enum(SECTIONS.map((s) => s.id))) }),
  component: Settings,
});

const PANES: Record<SectionId, () => ReactNode> = {
  general: GeneralPane,
  github: () => (
    <SettingsGroup>
      <GitHubSettings />
    </SettingsGroup>
  ),
  sync: () => (
    <div className="rounded-lg border border-line bg-surface p-4">
      <SyncSettings />
    </div>
  ),
  deploys: DeploysPane,
  ai: AiPane,
  security: SecurityPane,
  checks: ChecksPane,
  notifications: NotificationsPane,
  data: () => (
    <SettingsGroup>
      <DeleteAllData />
    </SettingsGroup>
  ),
};

function Settings() {
  const navigate = useNavigate();
  const section = Route.useSearch().section ?? "general";
  const current = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0];
  const Pane = PANES[current.id];

  return (
    <div className="flex h-full">
      <nav className="flex w-56 shrink-0 flex-col gap-0.5 border-r border-line p-2">
        <h1 className="px-2.5 pt-2 pb-3 text-lg font-medium">Settings</h1>
        {SECTIONS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            aria-current={id === current.id || undefined}
            onClick={() => void navigate({ to: "/settings", search: { section: id }, replace: true })}
            className={cn(
              "flex h-8 items-center gap-2.5 rounded-md px-2.5 text-left text-muted hover:bg-hover hover:text-fg",
              id === current.id && "bg-raised text-fg",
            )}
          >
            <Icon className="size-4" />
            {label}
          </button>
        ))}
      </nav>
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-6 px-8 py-6">
          <h2 className="text-xl font-medium">{current.label}</h2>
          <Pane />
        </div>
      </div>
    </div>
  );
}

function GeneralPane() {
  const svc = useServices();
  const queryClient = useQueryClient();
  const { data: hotkey } = useSetting(HOTKEY_SETTING, z.string(), DEFAULT_HOTKEY);
  const { data: paletteKey } = useSetting(PALETTE_SHORTCUT_SETTING, z.string(), DEFAULT_PALETTE_SHORTCUT);
  const { data: accent } = useSetting(ACCENT_SETTING, z.string(), DEFAULT_ACCENT);
  const autostart = useQuery({ queryKey: ["autostart"], queryFn: () => isEnabled(), enabled: inTauri });
  const version = useQuery({ queryKey: ["version"], queryFn: () => getVersion(), enabled: inTauri });
  const [hotkeyError, setHotkeyError] = useState<string>();

  const saveHotkey = useMutation({
    mutationFn: async (value: string) => {
      await svc.store.setSetting(HOTKEY_SETTING, value);
      setHotkeyError(await applyHotkey(svc));
      await queryClient.invalidateQueries({ queryKey: ["setting", HOTKEY_SETTING] });
    },
  });
  const savePaletteKey = useMutation({
    mutationFn: async (value: string) => {
      await svc.store.setSetting(PALETTE_SHORTCUT_SETTING, value || DEFAULT_PALETTE_SHORTCUT);
      await queryClient.invalidateQueries({ queryKey: ["setting", PALETTE_SHORTCUT_SETTING] });
    },
  });
  const saveAccent = useMutation({
    mutationFn: async (value: string) => {
      await svc.store.setSetting(ACCENT_SETTING, value);
      await applyAppearance(svc);
      await queryClient.invalidateQueries({ queryKey: ["setting", ACCENT_SETTING] });
    },
  });
  const toggleAutostart = useMutation({
    mutationFn: async (on: boolean) => (on ? enable() : disable()),
    onSuccess: () => void autostart.refetch(),
    onError: toastError,
  });
  const update = useMutation({
    mutationFn: async () => {
      const found = await check();
      if (!found) return false;
      await found.downloadAndInstall();
      await relaunch();
      return true;
    },
    onSuccess: (updated) => !updated && toast("You're on the latest version."),
    onError: toastError,
  });

  return (
    <>
      {inTauri ? (
        <SettingsGroup>
          <SettingRow label="Start with Windows" description="Opens in the tray">
            <Switch
              label="Start with Windows"
              checked={autostart.data ?? false}
              onChange={(on) => toggleAutostart.mutate(on)}
            />
          </SettingRow>
          <SettingRow label="Version" description={version.data}>
            <Button size="sm" loading={update.isPending} onClick={() => update.mutate()}>
              Check for updates
            </Button>
          </SettingRow>
        </SettingsGroup>
      ) : null}
      <SettingsGroup title="Shortcuts">
        <SettingRow label="Show or hide Tidra" description="Backspace turns it off">
          {(id) => <ShortcutInput id={id} value={hotkey ?? ""} onChange={(value) => saveHotkey.mutate(value)} />}
        </SettingRow>
        <SettingRow label="Command palette">
          {(id) => (
            <ShortcutInput id={id} value={paletteKey ?? ""} onChange={(value) => savePaletteKey.mutate(value)} />
          )}
        </SettingRow>
      </SettingsGroup>
      {hotkeyError ? <ErrorNote>Another app uses this shortcut: {hotkeyError}</ErrorNote> : null}
      <SettingsGroup title="Appearance">
        <SettingRow label="Accent color">
          {(id) => (
            <>
              {accent && accent !== DEFAULT_ACCENT ? (
                <Button size="sm" variant="ghost" onClick={() => saveAccent.mutate(DEFAULT_ACCENT)}>
                  Reset
                </Button>
              ) : null}
              <input
                id={id}
                type="color"
                value={accent ?? DEFAULT_ACCENT}
                onChange={(e) => saveAccent.mutate(e.target.value)}
                className="h-7 w-10 rounded-md border border-line-strong bg-surface"
              />
            </>
          )}
        </SettingRow>
      </SettingsGroup>
    </>
  );
}

function DeploysPane() {
  return (
    <>
      {DEPLOY_PROVIDERS.map((provider) => (
        <SettingsGroup key={provider.id} title={provider.label}>
          {provider.fields.map((field) => (
            <SecretField
              key={field.key}
              secretKey={field.key}
              label={field.label}
              description={<FieldHint hint={field.hint} url={field.url} />}
              secret={!field.key.endsWith("account")}
            />
          ))}
        </SettingsGroup>
      ))}
    </>
  );
}

function AiPane() {
  const svc = useServices();
  const queryClient = useQueryClient();
  const { data: config } = useQuery({ queryKey: ["setting", AI_CONFIG_SETTING], queryFn: () => readAiConfig(svc) });
  const current = config ?? DEFAULT_AI_CONFIG;
  const provider = AI_PROVIDERS.find((p) => p.id === current.provider) ?? AI_PROVIDERS[0];
  const save = useMutation({
    mutationFn: async (next: typeof current) => {
      await svc.store.setSetting(AI_CONFIG_SETTING, next);
      await queryClient.invalidateQueries({ queryKey: ["setting", AI_CONFIG_SETTING] });
      await queryClient.invalidateQueries({ queryKey: ["ai-ready"] });
    },
  });
  const [model, setModel] = useState<string>();
  const [baseUrl, setBaseUrl] = useState<string>();

  return (
    <SettingsGroup>
      <SettingRow label="Provider" description="Summarizes breaking changes in release notes">
        {(id) => (
          <Select
            id={id}
            className="w-64"
            value={current.provider}
            onChange={(e) => {
              const next = AI_PROVIDERS.find((p) => p.id === e.target.value);
              if (next) save.mutate({ provider: next.id, model: next.defaultModel, baseUrl: current.baseUrl });
            }}
          >
            {AI_PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        )}
      </SettingRow>
      <SettingRow label="Model">
        {(id) => (
          <Input
            id={id}
            className="w-64"
            value={model ?? current.model}
            onChange={(e) => setModel(e.target.value)}
            onBlur={() => model && save.mutate({ ...current, model })}
          />
        )}
      </SettingRow>
      {provider?.needsBaseUrl ? (
        <SettingRow label="Base URL" description="Any OpenAI-compatible API">
          {(id) => (
            <Input
              id={id}
              className="w-64"
              value={baseUrl ?? current.baseUrl ?? ""}
              placeholder="https://api.openai.com/v1"
              onChange={(e) => setBaseUrl(e.target.value)}
              onBlur={() => baseUrl !== undefined && save.mutate({ ...current, baseUrl })}
            />
          )}
        </SettingRow>
      ) : null}
      {provider ? <SecretField secretKey={provider.secretKey} label="API key" /> : null}
    </SettingsGroup>
  );
}

function SecurityPane() {
  const svc = useServices();
  const queryClient = useQueryClient();
  const { data: threshold } = useQuery({
    queryKey: ["setting", CI_THRESHOLD_SETTING],
    queryFn: () => readCiThreshold(svc),
  });
  const save = useMutation({
    mutationFn: async (next: { level: Severity; prodOnly: boolean }) => {
      await svc.store.setSetting(CI_THRESHOLD_SETTING, next);
      await queryClient.invalidateQueries();
    },
  });
  if (!threshold) return null;
  return (
    <SettingsGroup title="CI audit">
      <SettingRow label="Fail at" description="Matches your CI's pnpm audit --audit-level">
        {(id) => (
          <Select
            id={id}
            className="w-40"
            value={threshold.level}
            onChange={(e) =>
              save.mutate({ ...threshold, level: SEVERITIES.find((s) => s === e.target.value) ?? threshold.level })
            }
          >
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s[0]?.toUpperCase() + s.slice(1)}
              </option>
            ))}
          </Select>
        )}
      </SettingRow>
      <SettingRow label="Production dependencies only" description="Like --prod">
        <Switch
          label="Production dependencies only"
          checked={threshold.prodOnly}
          onChange={(prodOnly) => save.mutate({ ...threshold, prodOnly })}
        />
      </SettingRow>
    </SettingsGroup>
  );
}

function ChecksPane() {
  const svc = useServices();
  const queryClient = useQueryClient();
  const { data: jobs } = useJobs();
  const { data: intervals } = useQuery({
    queryKey: ["setting", JOB_INTERVALS_SETTING],
    queryFn: () => readJobIntervals(svc),
  });
  const [paused, setPaused] = useState(() => svc.scheduler.isPaused());
  const save = useMutation({
    mutationFn: async (next: Record<string, number>) => {
      await svc.store.setSetting(JOB_INTERVALS_SETTING, next);
      await queryClient.invalidateQueries({ queryKey: ["setting", JOB_INTERVALS_SETTING] });
    },
    onSuccess: () => toast("Applies after restart."),
  });
  return (
    <>
      <SettingsGroup>
        <SettingRow label="Pause background checks">
          <Switch
            label="Pause background checks"
            checked={paused}
            onChange={(value) => {
              svc.scheduler.setPaused(value);
              setPaused(value);
            }}
          />
        </SettingRow>
      </SettingsGroup>
      <SettingsGroup title="Every (minutes)">
        {JOBS.map((job) => {
          const state = jobs?.find((j) => j.id === job.id);
          return (
            <SettingRow
              key={job.id}
              label={job.title}
              description={
                state?.lastError ? (
                  <span className="text-bad" title={state.lastError}>
                    {state.lastError}
                  </span>
                ) : state?.lastRun ? (
                  <>
                    Last run <TimeAgo value={state.lastRun} />
                  </>
                ) : undefined
              }
            >
              {(id) => (
                <Input
                  id={id}
                  type="number"
                  min={1}
                  className="w-20 text-right tabular"
                  defaultValue={intervals?.[job.id] ?? job.defaultMinutes}
                  onBlur={(e) => {
                    const minutes = Number(e.target.value);
                    if (minutes >= 1 && minutes !== (intervals?.[job.id] ?? job.defaultMinutes))
                      save.mutate({ ...intervals, [job.id]: minutes });
                  }}
                />
              )}
            </SettingRow>
          );
        })}
      </SettingsGroup>
    </>
  );
}

function NotificationsPane() {
  const svc = useServices();
  const queryClient = useQueryClient();
  const { data: prefs } = useQuery({ queryKey: ["setting", NOTIFY_SETTING], queryFn: () => readNotifyPrefs(svc) });
  const save = useMutation({
    mutationFn: async (next: Record<string, boolean>) => {
      await svc.store.setSetting(NOTIFY_SETTING, next);
      await queryClient.invalidateQueries({ queryKey: ["setting", NOTIFY_SETTING] });
    },
  });
  return (
    <SettingsGroup>
      {Object.entries(NOTIFICATION_KINDS).map(([kind, label]) => (
        <SettingRow key={kind} label={label}>
          <Switch
            label={label}
            checked={prefs?.[kind] !== false}
            onChange={(on) => save.mutate({ ...prefs, [kind]: on })}
          />
        </SettingRow>
      ))}
    </SettingsGroup>
  );
}

function FieldHint({ hint, url }: { hint?: string; url?: string }) {
  if (!hint && !url) return null;
  return (
    <>
      {hint}
      {hint && url ? " · " : null}
      {url ? <ExternalLink href={url}>Create a token</ExternalLink> : null}
    </>
  );
}
