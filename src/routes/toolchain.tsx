import { createFileRoute } from "@tanstack/react-router";
import { Copy, Play } from "lucide-react";
import { useToolchain } from "@/app/queries";
import { useApp } from "@/app/services";
import { parseCommandLine } from "@/engine/pm";
import { JobRefresh } from "@/modules/common";
import { Badge } from "@/ui/badge";
import { Button, IconButton } from "@/ui/button";
import { Card, Note, Page, Section } from "@/ui/layout";
import { Mono } from "@/ui/misc";
import { toast } from "@/ui/toast";

export const Route = createFileRoute("/toolchain")({ component: Toolchain });

function Toolchain() {
  const { processes } = useApp();
  const { data } = useToolchain();

  const runCommand = (label: string, line: string) => {
    const command = parseCommandLine(line);
    if (!command) return;
    processes.start({ label, command });
    toast(`Started: ${line}. Follow it in Scripts and ports.`);
  };

  return (
    <Page title="Toolchain" actions={<JobRefresh jobId="toolchain" />}>
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
                {tool.outdated && tool.updateHint ? (
                  <span className="ml-auto flex items-center gap-1">
                    <Mono className="text-xs text-muted">{tool.updateHint}</Mono>
                    <IconButton
                      size="sm"
                      label="Copy command"
                      icon={<Copy className="size-3.5" />}
                      onClick={() => void navigator.clipboard.writeText(tool.updateHint ?? "")}
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
          <Card>
            {(data?.globals ?? []).length === 0 ? (
              <p className="p-4 text-sm text-muted">Every global package is up to date.</p>
            ) : null}
            {(data?.globals ?? []).map((pkg) => (
              <div
                key={pkg.name}
                className="flex h-10 items-center gap-3 border-b border-line px-4 text-sm last:border-b-0"
              >
                <span className="flex-1 font-medium">{pkg.name}</span>
                <Mono className="text-muted">{pkg.current}</Mono>
                <span className="text-faint">→</span>
                <Mono className="text-warn">{pkg.latest}</Mono>
              </div>
            ))}
            {(data?.globals ?? []).length > 0 ? (
              <div className="flex justify-end p-3">
                <Button size="sm" onClick={() => runCommand("Update global pnpm packages", "pnpm update -g --latest")}>
                  Update all
                </Button>
              </div>
            ) : null}
          </Card>
        </Section>

        <Section title="winget upgrades">
          {data && !data.wingetAvailable ? (
            <Note>winget is only available on Windows.</Note>
          ) : (
            <Card>
              {(data?.winget ?? []).length === 0 ? (
                <p className="p-4 text-sm text-muted">No upgrades available.</p>
              ) : null}
              {(data?.winget ?? []).map((pkg) => (
                <div
                  key={pkg.id}
                  className="flex h-10 items-center gap-3 border-b border-line px-4 text-sm last:border-b-0"
                >
                  <span className="min-w-0 flex-1 truncate font-medium">{pkg.name}</span>
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
          )}
        </Section>
      </div>
    </Page>
  );
}
