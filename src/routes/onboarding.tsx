import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Check, Plus } from "lucide-react";
import { useState } from "react";
import { useReports } from "@/app/queries";
import { useServices } from "@/app/services";
import { AddProjectsDialog } from "@/modules/projects/add-project";
import { GitHubSettings } from "@/modules/settings/github";
import { SettingsGroup } from "@/modules/settings/rows";
import { SyncSettings } from "@/modules/settings/sync";
import { Button } from "@/ui/button";

export const Route = createFileRoute("/onboarding")({ component: Onboarding });

const STEPS = ["Projects", "GitHub", "Sync"] as const;

function Onboarding() {
  const svc = useServices();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [adding, setAdding] = useState(false);
  const { data: reports } = useReports();

  const finish = useMutation({
    mutationFn: async () => {
      await svc.store.setLocal("onboarded", true);
      await queryClient.invalidateQueries({ queryKey: ["onboarded"] });
    },
    onSuccess: () => void navigate({ to: "/" }),
  });

  const next = () => (step < STEPS.length - 1 ? setStep(step + 1) : finish.mutate());

  return (
    <div data-tauri-drag-region className="flex h-full items-center justify-center bg-bg p-8">
      <div className="flex w-full max-w-xl flex-col gap-6">
        <div className="flex items-center gap-3">
          <img src="/logo.svg" alt="" className="size-8" />
          <div>
            <h1 className="text-xl font-medium">Set up Tidra</h1>
            <p className="text-sm text-muted">Every step can be skipped.</p>
          </div>
        </div>

        <ol className="flex gap-2">
          {STEPS.map((label, index) => (
            <li
              key={label}
              className={`flex flex-1 items-center gap-2 border-t-2 pt-2 text-sm ${index <= step ? "border-accent text-fg" : "border-line text-faint"}`}
            >
              {index < step ? (
                <Check className="size-3.5 text-accent" />
              ) : (
                <span className="text-xs tabular">{index + 1}</span>
              )}
              {label}
            </li>
          ))}
        </ol>

        <div className="flex flex-col gap-4">
          {step === 0 ? (
            <>
              <div>
                <h2 className="font-medium">Add your projects</h2>
                <p className="text-sm text-muted">A project folder, or a folder of projects.</p>
              </div>
              {reports?.length ? (
                <ul className="flex flex-col rounded-lg border border-line bg-surface px-4 text-sm">
                  {reports.map(({ project }) => (
                    <li key={project.id} className="flex h-8 items-center gap-2 border-b border-line last:border-b-0">
                      <Check className="size-3.5 text-ok" />
                      {project.name}
                    </li>
                  ))}
                </ul>
              ) : null}
              <Button className="self-start" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>
                Add projects
              </Button>
            </>
          ) : step === 1 ? (
            <>
              <div>
                <h2 className="font-medium">Connect GitHub</h2>
                <p className="text-sm text-muted">Without a token GitHub allows 60 requests an hour.</p>
              </div>
              <SettingsGroup>
                <GitHubSettings />
              </SettingsGroup>
            </>
          ) : (
            <>
              <div>
                <h2 className="font-medium">Sync between devices</h2>
                <p className="text-sm text-muted">Your own Turso or Supabase database, end-to-end encrypted.</p>
              </div>
              <div className="rounded-lg border border-line bg-surface p-4">
                <SyncSettings />
              </div>
            </>
          )}
        </div>

        <div className="flex justify-between">
          <Button variant="ghost" disabled={step === 0} onClick={() => setStep(step - 1)}>
            Back
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => finish.mutate()}>
              Skip setup
            </Button>
            <Button variant="primary" loading={finish.isPending} onClick={next}>
              {step === STEPS.length - 1 ? "Finish" : "Continue"}
            </Button>
          </div>
        </div>
      </div>
      <AddProjectsDialog open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}
