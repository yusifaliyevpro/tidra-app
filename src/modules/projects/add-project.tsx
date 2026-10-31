import { useMutation, useQueryClient } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen } from "lucide-react";
import { useState } from "react";
import { useServices } from "@/app/services";
import { inTauri } from "@/core/native";
import { repoLabel, type FoundProject } from "@/engine/discover";
import { basename } from "@/engine/path";
import { addProject, refreshProject, scanForProjects } from "@/services/projects";
import { Button } from "@/ui/button";
import { Dialog } from "@/ui/dialog";
import { Checkbox, Field, Input } from "@/ui/field";
import { ErrorNote } from "@/ui/layout";
import { toast } from "@/ui/toast";

async function pickFolder(): Promise<string | undefined> {
  if (!inTauri) return undefined;
  const picked = await open({
    directory: true,
    multiple: false,
    title: "Choose a project folder or a folder of projects",
  });
  return typeof picked === "string" ? picked.replaceAll("\\", "/") : undefined;
}

/** Pick one folder: if it is a project, add it; if it holds several, choose which ones to add. */
export function AddProjectsDialog({ open: isOpen, onClose }: { open: boolean; onClose: () => void }) {
  const svc = useServices();
  const queryClient = useQueryClient();
  const [folder, setFolder] = useState(svc.preview ? "/demo" : "");
  const [found, setFound] = useState<FoundProject[] | undefined>();
  const [chosen, setChosen] = useState<Set<string>>(new Set());

  const scan = useMutation({
    mutationFn: async (path: string) => scanForProjects(svc, path),
    onSuccess: (projects) => {
      setFound(projects);
      setChosen(new Set(projects.map((p) => p.path)));
    },
  });

  const add = useMutation({
    mutationFn: async () => {
      const ids = [];
      for (const path of chosen) ids.push(await addProject(svc, path));
      await queryClient.invalidateQueries({ queryKey: ["reports"] });
      await queryClient.invalidateQueries({ queryKey: ["home"] });
      return ids;
    },
    onSuccess: (ids) => {
      toast(
        ids.length === 1
          ? "Project added. Checking for updates…"
          : `${ids.length} projects added. Checking for updates…`,
      );
      close();
      void Promise.all(ids.map((id) => refreshProject(svc, id)));
    },
  });

  const close = () => {
    setFound(undefined);
    setChosen(new Set());
    scan.reset();
    add.reset();
    onClose();
  };

  const browse = async () => {
    const picked = await pickFolder();
    if (picked) {
      setFolder(picked);
      scan.mutate(picked);
    }
  };

  return (
    <Dialog
      open={isOpen}
      onClose={close}
      title="Add projects"
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" disabled={chosen.size === 0} loading={add.isPending} onClick={() => add.mutate()}>
            {chosen.size > 1 ? `Add ${chosen.size} projects` : "Add project"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Folder">
          {(id) => (
            <div className="flex gap-2">
              <Input
                id={id}
                value={folder}
                placeholder="C:/Users/you/code"
                onChange={(e) => setFolder(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && folder) scan.mutate(folder);
                }}
              />
              {inTauri ? (
                <Button icon={<FolderOpen className="size-4" />} onClick={() => void browse()}>
                  Browse
                </Button>
              ) : null}
              <Button disabled={!folder} loading={scan.isPending} onClick={() => scan.mutate(folder)}>
                Scan
              </Button>
            </div>
          )}
        </Field>

        {scan.error ? <ErrorNote>{scan.error.message}</ErrorNote> : null}
        {add.error ? <ErrorNote>{add.error.message}</ErrorNote> : null}
        {found?.length === 0 ? <ErrorNote>No package.json found here.</ErrorNote> : null}

        {found && found.length > 0 ? (
          <div className="flex max-h-72 flex-col overflow-y-auto rounded-md border border-line">
            {groupByRepo(found).map(([repo, projects]) => (
              <div key={repo ?? ""}>
                {repo ? (
                  <div className="sticky top-0 border-b border-line bg-raised px-3 py-1.5 text-xs text-muted">
                    {repo}
                  </div>
                ) : null}
                {projects.map((project) => (
                  <FoundRow
                    key={project.path}
                    project={project}
                    checked={chosen.has(project.path)}
                    onChange={(checked) => {
                      const next = new Set(chosen);
                      if (checked) next.add(project.path);
                      else next.delete(project.path);
                      setChosen(next);
                    }}
                  />
                ))}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}

/** Projects in the same repo sit under the repo's name; standalone ones come first without a header. */
function groupByRepo(found: FoundProject[]): [string | undefined, FoundProject[]][] {
  const groups = new Map<string | undefined, FoundProject[]>();
  for (const project of found) {
    const key = project.subdir ? repoLabel(null, project.repoRoot) : undefined;
    groups.set(key, [...(groups.get(key) ?? []), project]);
  }
  return [...groups].toSorted(([a], [b]) => (a === undefined ? -1 : b === undefined ? 1 : a.localeCompare(b)));
}

function FoundRow({
  project,
  checked,
  onChange,
}: {
  project: FoundProject;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2.5 border-b border-line px-3 py-2 last:border-b-0 hover:bg-hover">
      <Checkbox label={project.path} checked={checked} onChange={onChange} />
      <span className="font-medium">{project.subdir || basename(project.path)}</span>
      <span className="min-w-0 truncate font-mono text-xs text-faint">{project.path}</span>
    </label>
  );
}
