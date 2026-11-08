import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useServices } from "@/app/services";
import type { ProjectWithPath } from "@/core/store";
import { DEFAULT_MAJOR_PINS } from "@/engine/outdated";
import { SettingRow, SettingsGroup } from "@/modules/settings/rows";
import { refreshProject } from "@/services/projects";
import { Button } from "@/ui/button";
import { Field, Input, Textarea } from "@/ui/field";
import { toast, toastError } from "@/ui/toast";

const lines = (text: string) =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

export function ProjectSettings({ project, detectedChecks }: { project: ProjectWithPath; detectedChecks: string[] }) {
  const svc = useServices();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [checks, setChecks] = useState(() => (project.checks ?? []).join("\n"));
  const [pins, setPins] = useState(() => (project.majorPins ?? DEFAULT_MAJOR_PINS).join("\n"));
  const [path, setPath] = useState(project.path ?? "");

  const saveForm = useMutation({
    mutationFn: async () => {
      await svc.store.updateProject(project.id, {
        checks: lines(checks).length > 0 ? lines(checks) : null,
        majorPins: lines(pins),
      });
      if (path && path !== project.path) await svc.store.setProjectPath(project.id, path.replaceAll("\\", "/"));
      await queryClient.invalidateQueries({ queryKey: ["project", project.id] });
      await refreshProject(svc, project.id, { force: true });
    },
    onSuccess: () => toast("Saved."),
    onError: toastError,
  });

  const remove = useMutation({
    mutationFn: async () => {
      await svc.store.removeProject(project.id);
      await queryClient.invalidateQueries({ queryKey: ["reports"] });
    },
    onSuccess: () => void navigate({ to: "/projects" }),
  });

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <SettingsGroup title="Checks and versions">
        <div className="flex flex-col gap-4 p-4">
          <Field label="Check commands" hint={`One per line. Empty uses ${detectedChecks.join(", ") || "none"}.`}>
            {(id) => (
              <Textarea
                id={id}
                value={checks}
                placeholder={detectedChecks.join("\n")}
                onChange={(e) => setChecks(e.target.value)}
              />
            )}
          </Field>
          <Field label="Pinned majors" hint="One per line. These stay on their current major.">
            {(id) => <Textarea id={id} value={pins} onChange={(e) => setPins(e.target.value)} />}
          </Field>
          <Field label="Folder on this device">
            {(id) => <Input id={id} value={path} onChange={(e) => setPath(e.target.value)} />}
          </Field>
          <div className="flex justify-end">
            <Button variant="primary" loading={saveForm.isPending} onClick={() => saveForm.mutate()}>
              Save
            </Button>
          </div>
        </div>
      </SettingsGroup>

      <SettingsGroup>
        <SettingRow label="Remove project" description="On every synced device. Files on disk stay.">
          <Button size="sm" variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>
            Remove
          </Button>
        </SettingRow>
      </SettingsGroup>
    </div>
  );
}
