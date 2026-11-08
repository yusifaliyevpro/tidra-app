import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { cn } from "cn";
import { Copy, Play, Trash2 } from "lucide-react";
import { useState } from "react";
import { useToolchain } from "@/app/queries";
import { useApp, useServices } from "@/app/services";
import { parseCommandLine } from "@/engine/pm";
import { chocolateyNodeUpdate, type GlobalPackage } from "@/engine/toolchain";
import { JobRefresh } from "@/modules/common";
import { ProcessDialog } from "@/modules/process-dialog";
import { refreshGlobals } from "@/services/toolchain";
import { Badge } from "@/ui/badge";
import { Button, IconButton } from "@/ui/button";
import { Dialog } from "@/ui/dialog";
import { Card, Page, Section } from "@/ui/layout";
import { Mono } from "@/ui/misc";
import { toast, toastError } from "@/ui/toast";

export const Route = createFileRoute("/toolchain")({ component: Toolchain });

function Toolchain() {
  const { svc, processes } = useApp();
  const { data } = useToolchain();
  const [shown, setShown] = useState<string>();

  const runCommand = (label: string, line: string, onExit?: () => void) => {
    const command = parseCommandLine(line);
    if (command) setShown(processes.start({ label, command, onExit }));
  };

  return (
    <Page title="Toolchain" actions={<JobRefresh jobId="toolchain" />}>
      <ProcessDialog processId={shown} onClose={() => setShown(undefined)} onRestarted={setShown} />
      <div className="mx-auto flex max-w-4xl flex-col gap-6 p-5">
        <Section title="Runtimes and tools">
          <Card>
            {(data?.tools ?? []).map((tool) => (
              <div
                key={tool.id}
                className="flex h-11 items-center gap-3 border-b border-line px-4 text-sm last:border-b-0"
              >
                <span className="w-28 font-medium">{tool.label}</span>
                <Mono className="w-24">{tool.installed ?? <span className="text-faint">not found</span>}</Mono>
                {tool.outdated ? (
                  <Badge tone="warn">{tool.latest} available</Badge>
                ) : tool.installed ? (
                  <Badge tone="ok">current</Badge>
                ) : null}
                {tool.note ? <span className="text-xs text-faint">{tool.note}</span> : null}
                {tool.id === "node" && tool.outdated && tool.latest && svc.io.env.OS === "Windows_NT" ? (
                  <NodeUpdate version={tool.latest} />
                ) : null}
                {tool.outdated && tool.updateHint ? (
                  <span className="ml-auto flex items-center gap-1">
                    <Mono className="text-xs text-muted">{tool.updateHint}</Mono>
                    <IconButton
                      size="sm"
                      label="Copy command"
                      icon={<Copy className="size-3.5" />}
                      onClick={() =>
                        void navigator.clipboard.writeText(tool.updateHint ?? "").then(() => toast("Copied."))
                      }
                    />
                    <IconButton
                      size="sm"
                      label="Run command"
                      icon={<Play className="size-3.5" />}
                      onClick={() => runCommand(`Update ${tool.label}`, tool.updateHint ?? "")}
                    />
                  </span>
                ) : null}
              </div>
            ))}
          </Card>
        </Section>

        <Section title="Global pnpm packages">
          <GlobalPackages packages={data?.globals ?? []} runCommand={runCommand} />
        </Section>

        {data?.wingetAvailable ? (
          <Section title="winget upgrades">
            <Card>
              {(data?.winget ?? []).length === 0 ? (
                <p className="p-4 text-sm text-muted">No upgrades available.</p>
              ) : null}
              {(data?.winget ?? []).map((pkg) => (
                <div
                  key={pkg.id}
                  className="flex h-10 items-center gap-3 border-b border-line px-4 text-sm last:border-b-0"
                >
                  <CopyName name={pkg.name} className="min-w-0 flex-1" />
                  <Mono className="text-xs text-faint">{pkg.id}</Mono>
                  <Mono className="text-muted">{pkg.version}</Mono>
                  <span className="text-faint">→</span>
                  <Mono className="text-warn">{pkg.available}</Mono>
                  <Button
                    size="sm"
                    onClick={() =>
                      runCommand(
                        `winget: ${pkg.name}`,
                        `winget upgrade --id ${pkg.id} --exact --silent --accept-package-agreements --accept-source-agreements`,
                      )
                    }
                  >
                    Upgrade
                  </Button>
                </div>
              ))}
            </Card>
          </Section>
        ) : null}
      </div>
    </Page>
  );
}

type RunCommand = (label: string, line: string, onExit?: () => void) => void;

function GlobalPackages({ packages, runCommand }: { packages: GlobalPackage[]; runCommand: RunCommand }) {
  const svc = useServices();
  const [removing, setRemoving] = useState<string>();
  // Whatever the command did, the rows should show what is installed now.
  const recheck = () => void refreshGlobals(svc).catch(toastError);
  return (
    <Card>
      <RemoveGlobalDialog
        name={removing}
        onClose={() => setRemoving(undefined)}
        onConfirm={(name) => {
          setRemoving(undefined);
          runCommand(`Remove ${name}`, `pnpm remove -g ${name}`, recheck);
        }}
      />
      {packages.length === 0 ? <p className="p-4 text-sm text-muted">No global packages</p> : null}
      {packages.map((pkg) => (
        <div
          key={pkg.name}
          className="flex h-10 items-center gap-3 border-b border-line pr-2 pl-4 text-sm last:border-b-0"
        >
          <CopyName name={pkg.name} className="min-w-0 flex-1" />
          <Mono className="w-24 text-right text-muted">{pkg.version}</Mono>
          <span className="flex w-52 items-center gap-3">
            {pkg.latest ? (
              <>
                <span className="text-faint">→</span>
                <Mono className="flex-1 text-warn">{pkg.latest}</Mono>
                <Button
                  size="sm"
                  onClick={() => runCommand(`Update ${pkg.name}`, `pnpm add -g ${pkg.name}@${pkg.latest}`, recheck)}
                >
                  Update
                </Button>
              </>
            ) : null}
          </span>
          <IconButton
            size="sm"
            label={`Remove ${pkg.name}`}
            icon={<Trash2 className="size-3.5" />}
            onClick={() => setRemoving(pkg.name)}
          />
        </div>
      ))}
    </Card>
  );
}

function RemoveGlobalDialog({
  name,
  onClose,
  onConfirm,
}: {
  name: string | undefined;
  onClose: () => void;
  onConfirm: (name: string) => void;
}) {
  return (
    <Dialog
      open={Boolean(name)}
      onClose={onClose}
      title={`Remove ${name ?? ""}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="danger" onClick={() => name && onConfirm(name)}>
            Remove
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted">
        Runs <Mono>pnpm remove -g {name}</Mono>. Projects that depend on it keep their own copy.
      </p>
    </Dialog>
  );
}

async function copyName(name: string) {
  try {
    await navigator.clipboard.writeText(name);
    toast(`Copied ${name}.`);
  } catch (error) {
    toastError(error);
  }
}

/** A package name that copies itself when clicked. */
function CopyName({ name, className }: { name: string; className?: string }) {
  return (
    <button
      type="button"
      title="Copy name"
      className={cn("truncate text-left font-medium hover:text-fg", className)}
      onClick={() => void copyName(name)}
    >
      {name}
    </button>
  );
}

/** Installs the target Node.js with Chocolatey; Windows asks for admin rights first. */
function NodeUpdate({ version }: { version: string }) {
  const svc = useServices();
  const queryClient = useQueryClient();
  const install = useMutation({
    mutationFn: async () => {
      toast("Approve the administrator prompt to install Node.js.");
      const { program, args } = chocolateyNodeUpdate(version);
      const result = await svc.io.run(program, args);
      if (result.code !== 0) throw new Error("Node.js was not updated. The installer window shows why.");
      await svc.scheduler.runNow("toolchain");
      await queryClient.invalidateQueries({ queryKey: ["toolchain"] });
    },
    onSuccess: () => toast(`Node.js ${version} installed. Restart open terminals to use it.`),
    onError: toastError,
  });
  return (
    <Button
      size="sm"
      variant="primary"
      className="ml-auto"
      loading={install.isPending}
      onClick={() => install.mutate()}
    >
      Update
    </Button>
  );
}
