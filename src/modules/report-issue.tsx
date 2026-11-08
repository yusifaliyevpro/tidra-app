import { useMutation, useQuery } from "@tanstack/react-query";
import { getVersion } from "@tauri-apps/api/app";
import * as z from "@zod/mini";
import { cn } from "cn";
import { ImagePlus, X } from "lucide-react";
import { useId, useRef, useState, useSyncExternalStore, type ClipboardEvent, type DragEvent } from "react";
import { ACCENT_SETTING, DEFAULT_ACCENT } from "@/app/desktop";
import { useSetting, useSyncStatus } from "@/app/queries";
import { useServices } from "@/app/services";
import { THEME_SETTING, THEMES } from "@/app/theme";
import { inTauri } from "@/core/native";
import { CI_THRESHOLD_SETTING, readCiThreshold } from "@/services/home";
import { issueDraft } from "@/services/issue-draft";
import {
  createIssue,
  GH_ATTACH_VERSION,
  ghState,
  ISSUE_KINDS,
  type GhState,
  type IssueKind,
  type Screenshot,
} from "@/services/issues";
import { Button } from "@/ui/button";
import { Dialog } from "@/ui/dialog";
import { openExternal } from "@/ui/external";
import { Checkbox, Field, Input, Textarea } from "@/ui/field";
import { Note } from "@/ui/layout";
import { Markdown } from "@/ui/markdown";
import { Segmented } from "@/ui/misc";
import { recentErrors, subscribeToasts, toast, toastError, type RecentError } from "@/ui/toast";

const readDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () =>
      typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Couldn't read the image.")),
    );
    reader.addEventListener("error", () => reject(reader.error ?? new Error("Couldn't read the image.")));
    reader.readAsDataURL(file);
  });

/** Files a bug, regression or feature request on Tidra's GitHub repo through the user's GitHub CLI. */
export function ReportIssueDialog() {
  const { open } = useSyncExternalStore(issueDraft.subscribe, issueDraft.snapshot);
  useGh();
  return (
    <Dialog open={open} onClose={issueDraft.close} title="Report an issue" className="w-[720px]" footer={<Footer />}>
      {open ? <ReportIssueBody /> : null}
    </Dialog>
  );
}

/** Checked in the background from app start, so the dialog opens with the answer instead of a spinner. */
function useGh() {
  const svc = useServices();
  return useQuery({ queryKey: ["gh-state"], queryFn: () => ghState(svc.io), staleTime: 5 * 60_000, enabled: inTauri });
}

/** Settings that change how Tidra behaves, sent with every issue. */
function useIssueSettings(): { label: string; value: string }[] {
  const svc = useServices();
  const { data: theme } = useSetting(THEME_SETTING, z.enum(THEMES), "system");
  const { data: accent } = useSetting(ACCENT_SETTING, z.string(), DEFAULT_ACCENT);
  const { data: ci } = useQuery({ queryKey: ["setting", CI_THRESHOLD_SETTING], queryFn: () => readCiThreshold(svc) });
  const { data: sync } = useSyncStatus();
  return [
    { label: "Theme", value: theme ?? "system" },
    { label: "Accent", value: accent ?? DEFAULT_ACCENT },
    { label: "Background checks", value: svc.scheduler.isPaused() ? "paused" : "on" },
    { label: "CI audit level", value: ci ? `${ci.level}${ci.prodOnly ? ", production only" : ""}` : "default" },
    { label: "Sync", value: sync?.connected ? (sync.provider ?? "on") : "off" },
  ];
}

const chosenErrors = () => {
  const { skippedErrors } = issueDraft.snapshot();
  return recentErrors().filter((e) => !skippedErrors.includes(e.id));
};

function useSubmit(attach: boolean) {
  const svc = useServices();
  const version = useQuery({ queryKey: ["version"], queryFn: () => getVersion(), enabled: inTauri });
  const settings = useIssueSettings();
  return useMutation({
    mutationFn: () =>
      createIssue(
        svc.io,
        issueDraft.snapshot().draft,
        { version: version.data ?? "dev", platform: svc.io.platform, settings, errors: chosenErrors() },
        { attach },
      ),
    onSuccess: ({ url, screenshotsLeft }) => {
      issueDraft.clear();
      if (screenshotsLeft) {
        openExternal(url);
        toast("Issue opened. Drop your screenshots into it on GitHub.");
      } else toast("Issue opened.", "info", { label: "View", run: () => openExternal(url) });
    },
    onError: toastError,
  });
}

function Footer() {
  const { draft } = useSyncExternalStore(issueDraft.subscribe, issueDraft.snapshot);
  const gh = useGh();
  const submit = useSubmit(gh.data?.state === "ready" && gh.data.attach);
  return (
    <>
      <Button variant="ghost" onClick={issueDraft.close}>
        Cancel
      </Button>
      <Button
        variant="primary"
        loading={submit.isPending}
        disabled={gh.data?.state !== "ready" || !draft.title.trim()}
        onClick={() => submit.mutate()}
      >
        Open issue
      </Button>
    </>
  );
}

function GhUpdateNotice({ gh, screenshots }: { gh: Extract<GhState, { state: "ready" }>; screenshots: number }) {
  const svc = useServices();
  const upgrade = svc.io.platform === "windows" ? "winget upgrade --id GitHub.cli" : "brew upgrade gh";
  return (
    <Note>
      <span className="text-fg">
        GitHub CLI {gh.version} can't attach screenshots. Update to {GH_ATTACH_VERSION} or newer:
      </span>{" "}
      <code className="font-mono text-fg">{upgrade}</code>
      {screenshots > 0 ? ". Until then, the issue opens on GitHub for you to add them." : "."}
    </Note>
  );
}

function GhNotice({
  gh,
  onRetry,
  checking,
  screenshots,
}: {
  gh: GhState | undefined;
  onRetry: () => void;
  checking: boolean;
  screenshots: number;
}) {
  const svc = useServices();
  if (!gh) return null;
  if (gh.state === "ready") return gh.attach ? null : <GhUpdateNotice gh={gh} screenshots={screenshots} />;
  const install = svc.io.platform === "windows" ? "winget install --id GitHub.cli" : "brew install gh";
  return (
    <Note>
      <div className="flex items-start gap-3">
        <div className="flex flex-1 flex-col gap-1">
          {gh.state === "missing" ? (
            <>
              <span className="text-fg">Issues are filed with the GitHub CLI, which isn't installed.</span>
              <span>
                Install it with <code className="font-mono text-fg">{install}</code> or from{" "}
                <button
                  type="button"
                  className="text-accent-text hover:underline"
                  onClick={() => openExternal("https://cli.github.com")}
                >
                  cli.github.com
                </button>
                , then sign in with <code className="font-mono text-fg">gh auth login</code>.
              </span>
            </>
          ) : (
            <>
              <span className="text-fg">The GitHub CLI isn't signed in.</span>
              <span>
                Run <code className="font-mono text-fg">gh auth login</code> in a terminal.
              </span>
            </>
          )}
        </div>
        <Button size="sm" loading={checking} onClick={onRetry}>
          Check again
        </Button>
      </div>
    </Note>
  );
}

function ReportIssueBody() {
  const { draft } = useSyncExternalStore(issueDraft.subscribe, issueDraft.snapshot);
  const gh = useGh();
  return (
    <div className="flex flex-col gap-4">
      <GhNotice
        gh={gh.data}
        checking={gh.isFetching}
        onRetry={() => void gh.refetch()}
        screenshots={draft.screenshots.length}
      />
      <div className="flex items-end gap-3">
        <div className="flex-1">
          <Field label="Title">
            {(id) => (
              <Input
                id={id}
                value={draft.title}
                // oxlint-disable-next-line jsx-a11y/no-autofocus -- the dialog exists to type this
                autoFocus
                spellCheck
                placeholder="Revert leaves pnpm-workspace.yaml changed"
                onChange={(e) => issueDraft.edit({ title: e.target.value })}
              />
            )}
          </Field>
        </div>
        <Segmented<IssueKind>
          label="Type"
          options={ISSUE_KINDS.map((k) => ({ id: k.value, label: k.label }))}
          value={draft.kind}
          onChange={(kind) => issueDraft.edit({ kind })}
        />
      </div>
      <Description />
      <RecentErrors />
    </div>
  );
}

/** Errors from this session go with the issue unless unchecked; they can hold paths or names. */
function RecentErrors() {
  const { skippedErrors } = useSyncExternalStore(issueDraft.subscribe, issueDraft.snapshot);
  const errors = useSyncExternalStore(subscribeToasts, recentErrors);
  if (errors.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-fg">Recent errors</span>
      <div className="flex max-h-32 flex-col overflow-y-auto rounded-md border border-line-strong bg-surface py-1">
        {errors.toReversed().map((error) => (
          <ErrorRow key={error.id} error={error} checked={!skippedErrors.includes(error.id)} />
        ))}
      </div>
    </div>
  );
}

function ErrorRow({ error, checked }: { error: RecentError; checked: boolean }) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex h-7 shrink-0 items-center gap-2.5 px-2.5 text-sm hover:bg-hover">
      <Checkbox id={id} label="Send this error" checked={checked} onChange={() => issueDraft.toggleError(error.id)} />
      <span className="shrink-0 font-mono text-xs text-faint">{error.at.slice(11, 19)}</span>
      <span className={cn("truncate", checked ? "text-fg" : "text-faint line-through")} title={error.message}>
        {error.message}
      </span>
    </label>
  );
}

function removeScreenshot(name: string) {
  const { body, screenshots } = issueDraft.snapshot().draft;
  issueDraft.edit({
    screenshots: screenshots.filter((s) => s.name !== name),
    body: body
      .split("\n")
      .filter((line) => !(line.trim().startsWith("![") && line.trim().endsWith(`](${name})`)))
      .join("\n"),
  });
}

function Description() {
  const { draft } = useSyncExternalStore(issueDraft.subscribe, issueDraft.snapshot);
  const [mode, setMode] = useState<"write" | "preview">("write");
  const area = useRef<HTMLTextAreaElement>(null);
  const files = useRef<HTMLInputElement>(null);

  // Screenshots go in at the cursor as a Markdown image, like on GitHub; the file is uploaded when the issue opens.
  const addImages = async (list: File[]) => {
    const images = list.filter((f) => f.type.startsWith("image/"));
    if (images.length === 0) return false;
    const at = area.current?.selectionStart ?? draft.body.length;
    const added: Screenshot[] = [];
    let n = draft.screenshots.length;
    for (const file of images) {
      n += 1;
      added.push({ name: `screenshot-${n}.${file.type.split("/")[1] ?? "png"}`, dataUrl: await readDataUrl(file) });
    }
    const refs = added.map((s) => `![${s.name.replace(/\.\w+$/, "")}](${s.name})`).join("\n");
    const { body, screenshots } = issueDraft.snapshot().draft;
    issueDraft.edit({
      body: `${body.slice(0, at)}${at > 0 && body[at - 1] !== "\n" ? "\n" : ""}${refs}\n${body.slice(at)}`,
      screenshots: [...screenshots, ...added],
    });
    return true;
  };
  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = [...event.clipboardData.files];
    if (pasted.some((f) => f.type.startsWith("image/"))) {
      event.preventDefault();
      void addImages(pasted).catch(toastError);
    }
  };
  const onDrop = (event: DragEvent<HTMLTextAreaElement>) => {
    const dropped = [...event.dataTransfer.files];
    if (dropped.length > 0) {
      event.preventDefault();
      void addImages(dropped).catch(toastError);
    }
  };
  // The preview shows pasted images from memory until they are uploaded.
  const preview = draft.screenshots.reduce((text, s) => text.split(`](${s.name})`).join(`](${s.dataUrl})`), draft.body);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center">
        <span className="text-sm font-medium text-fg">Description</span>
        <span className="ml-auto">
          <Segmented
            label="Description view"
            options={[
              { id: "write", label: "Write" },
              { id: "preview", label: "Preview" },
            ]}
            value={mode}
            onChange={setMode}
          />
        </span>
      </div>
      {mode === "write" ? (
        <Textarea
          ref={area}
          aria-label="Description"
          value={draft.body}
          spellCheck
          placeholder={"What happened, and what did you expect?\nPaste or drop screenshots here."}
          className="h-64 resize-none font-sans text-base"
          onChange={(e) => issueDraft.edit({ body: e.target.value })}
          onPaste={onPaste}
          onDrop={onDrop}
          onDragOver={(e) => e.preventDefault()}
        />
      ) : (
        <div className="h-64 overflow-y-auto rounded-md border border-line-strong bg-surface px-3 py-2">
          {draft.body.trim() ? <Markdown source={preview} /> : <span className="text-faint">Nothing to preview</span>}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {draft.screenshots.map((shot) => (
          <span key={shot.name} className="group relative">
            <img src={shot.dataUrl} alt={shot.name} className="h-14 rounded-md border border-line object-cover" />
            <button
              type="button"
              aria-label={`Remove ${shot.name}`}
              onClick={() => removeScreenshot(shot.name)}
              className="absolute -top-1.5 -right-1.5 hidden size-5 items-center justify-center rounded-full border border-line-strong bg-raised text-muted group-hover:flex hover:text-fg focus-visible:flex"
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        <Button
          size="sm"
          variant="ghost"
          icon={<ImagePlus className="size-3.5" />}
          onClick={() => files.current?.click()}
        >
          Add screenshot
        </Button>
        <input
          ref={files}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            void addImages([...(e.target.files ?? [])]).catch(toastError);
            e.target.value = "";
          }}
        />
        <span className="ml-auto text-xs text-faint">Markdown, like on GitHub</span>
      </div>
    </div>
  );
}
