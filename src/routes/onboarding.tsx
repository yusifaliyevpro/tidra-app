import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { cn } from "cn";
import { Check, FolderGit2, Plus, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useReports } from "@/app/queries";
import { useServices } from "@/app/services";
import { AddProjectsDialog } from "@/modules/projects/add-project";
import { GitHubSettings } from "@/modules/settings/github";
import { SettingsGroup } from "@/modules/settings/rows";
import { SyncSettings } from "@/modules/settings/sync";
import { Button, IconButton } from "@/ui/button";

export const Route = createFileRoute("/onboarding")({ component: Onboarding });

const STEPS = [
  {
    id: "projects",
    label: "Projects",
    title: "Add your projects",
    detail: "A project folder, or a folder of projects.",
  },
  {
    id: "github",
    label: "GitHub",
    title: "Connect GitHub",
    detail: "Without a token GitHub allows 60 requests an hour.",
  },
  {
    id: "sync",
    label: "Sync",
    title: "Sync between devices",
    detail: "Optional. Your own database, end-to-end encrypted.",
  },
] as const;

function Onboarding() {
  const svc = useServices();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [reached, setReached] = useState(0);
  const current = STEPS[step] ?? STEPS[0];
  const last = step === STEPS.length - 1;

  const finish = useMutation({
    mutationFn: async () => {
      await svc.store.setLocal("onboarded", true);
      await queryClient.invalidateQueries({ queryKey: ["onboarded"] });
    },
    onSuccess: () => void navigate({ to: "/" }),
  });

  const go = (index: number) => {
    setStep(index);
    setReached(Math.max(reached, index));
  };

  return (
    <div className="flex h-full">
      <nav className="flex w-56 shrink-0 flex-col border-r border-line px-3 py-6">
        <h1 className="px-2 pb-5 text-lg font-medium">Set up Tidra</h1>
        <ol className="flex flex-col gap-0.5">
          {STEPS.map((s, index) => (
            <li key={s.id}>
              <StepButton
                index={index}
                label={s.label}
                state={index === step ? "current" : index < reached || index < step ? "done" : "todo"}
                disabled={index > reached}
                onClick={() => go(index)}
              />
            </li>
          ))}
        </ol>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex max-w-2xl flex-col gap-6 px-10 py-8">
            <header className="flex flex-col gap-1">
              <h2 className="text-xl font-medium">{current.title}</h2>
              <p className="text-muted">{current.detail}</p>
            </header>
            {current.id === "projects" ? <ProjectsStep /> : null}
            {current.id === "github" ? (
              <SettingsGroup>
                <GitHubSettings />
              </SettingsGroup>
            ) : null}
            {current.id === "sync" ? (
              <div className="rounded-lg border border-line bg-surface p-4">
                <SyncSettings />
              </div>
            ) : null}
          </div>
        </div>

        <footer className="flex h-14 shrink-0 items-center gap-2 border-t border-line px-6">
          <Button variant="ghost" onClick={() => finish.mutate()}>
            Skip setup
          </Button>
          <span className="ml-auto" />
          {step > 0 ? <Button onClick={() => setStep(step - 1)}>Back</Button> : null}
          <Button variant="primary" loading={finish.isPending} onClick={() => (last ? finish.mutate() : go(step + 1))}>
            {last ? "Finish" : "Continue"}
          </Button>
        </footer>
      </div>
    </div>
  );
}

function StepButton({
  index,
  label,
  state,
  disabled,
  onClick,
}: {
  index: number;
  label: string;
  state: "done" | "current" | "todo";
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-current={state === "current" ? "step" : undefined}
      onClick={onClick}
      className={cn(
        "flex h-9 w-full items-center gap-3 rounded-md px-2 text-left",
        state === "current" ? "bg-raised text-fg" : "text-muted enabled:hover:bg-hover enabled:hover:text-fg",
        disabled && "text-faint",
      )}
    >
      <span
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-full border text-xs tabular",
          state === "current" && "border-accent bg-accent text-accent-fg",
          state === "done" && "border-accent text-accent",
          state === "todo" && "border-line-strong",
        )}
      >
        {state === "done" ? <Check className="size-3" /> : index + 1}
      </span>
      {label}
    </button>
  );
}

function ProjectsStep() {
  const svc = useServices();
  const queryClient = useQueryClient();
  const { data: rows } = useReports();
  const [adding, setAdding] = useState(false);
  const remove = useMutation({
    mutationFn: async (id: string) => {
      await svc.store.removeProject(id);
      await queryClient.invalidateQueries({ queryKey: ["reports"] });
    },
  });

  let list: ReactNode;
  if (!rows?.length) {
    list = (
      <div className="flex h-24 items-center justify-center gap-2 text-muted">
        <FolderGit2 className="size-4" />
        No projects yet
      </div>
    );
  } else {
    list = rows.map(({ project }) => (
      <div key={project.id} className="flex h-11 items-center gap-3 px-4">
        <FolderGit2 className="size-4 shrink-0 text-muted" />
        <span className="font-medium">{project.name}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-faint">{project.subdir || project.path}</span>
        <IconButton
          size="sm"
          label={`Remove ${project.name}`}
          icon={<X className="size-3.5" />}
          onClick={() => remove.mutate(project.id)}
        />
      </div>
    ));
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col divide-y divide-line rounded-lg border border-line bg-surface">{list}</div>
      <Button className="self-start" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>
        Add projects
      </Button>
      <AddProjectsDialog open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}
