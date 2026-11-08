import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { FolderGit2, Plus, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useReports } from "@/app/queries";
import { useServices } from "@/app/services";
import { AddProjectsDialog } from "@/modules/projects/add-project";
import { GitHubSettings } from "@/modules/settings/github";
import { SettingsGroup } from "@/modules/settings/rows";
import { Button, IconButton } from "@/ui/button";

export const Route = createFileRoute("/onboarding")({ component: Onboarding });

function Onboarding() {
  const svc = useServices();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data: rows } = useReports();
  const finish = useMutation({
    mutationFn: async () => {
      await svc.store.setLocal("onboarded", true);
      await queryClient.invalidateQueries({ queryKey: ["onboarded"] });
    },
    onSuccess: () => void navigate({ to: "/" }),
  });

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-xl flex-col gap-8 px-8 py-12">
          <header className="flex flex-col gap-2">
            <img src="/logo.svg" alt="" className="size-8" draggable={false} />
            <h1 className="text-2xl font-semibold tracking-[-0.02em]">Add your projects</h1>
            <p className="text-muted">A project folder, or a folder that holds several.</p>
          </header>
          <ProjectsStep />
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium text-muted">GitHub, for CI and pull requests</h2>
            <SettingsGroup>
              <GitHubSettings />
            </SettingsGroup>
          </section>
        </div>
      </div>
      <footer className="flex h-14 shrink-0 items-center gap-2 border-t border-line px-6">
        <span className="text-sm text-faint">Sync between devices is in Settings.</span>
        <Button variant="primary" className="ml-auto" loading={finish.isPending} onClick={() => finish.mutate()}>
          {rows?.length ? "Done" : "Skip for now"}
        </Button>
      </footer>
    </div>
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
