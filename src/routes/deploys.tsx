import { createFileRoute, Link } from "@tanstack/react-router";
import { ExternalLink as ExternalLinkIcon, Rocket } from "lucide-react";
import { useDeploys, useReports } from "@/app/queries";
import type { DeployState } from "@/integrations/deploy";
import { JobRefresh } from "@/modules/common";
import { projectLink } from "@/modules/links";
import { IconButton } from "@/ui/button";
import { openExternal } from "@/ui/external";
import { Card, Empty, ErrorNote, Page } from "@/ui/layout";
import { TimeAgo } from "@/ui/time";

export const Route = createFileRoute("/deploys")({ component: Deploys });

const STATE_DOT: Record<DeployState, string> = {
  ready: "bg-ok",
  building: "bg-warn animate-pulse",
  queued: "bg-faint",
  error: "bg-bad",
  canceled: "bg-faint",
};
const STATE_ORDER: DeployState[] = ["error", "building", "queued", "ready", "canceled"];

function Deploys() {
  const { data } = useDeploys();
  const { data: reports } = useReports();
  const projectByRemote = new Map(
    (reports ?? []).flatMap(({ project }) => (project.remote ? [[project.remote, project] as const] : [])),
  );

  if (data && data.configured.length === 0) {
    return (
      <Page title="Deploys">
        <Empty
          icon={<Rocket />}
          title="No deploy providers connected"
          action={
            <Link to="/settings" search={{ section: "deploys" }} className="text-accent hover:underline">
              Connect Vercel, Netlify or Cloudflare
            </Link>
          }
        >
          Add a token in Settings and Tidra shows the latest deployment of every site, matched to your projects by
          repository.
        </Empty>
      </Page>
    );
  }

  return (
    <Page title="Deploys" subtitle="Latest per site" actions={<JobRefresh jobId="deploys" />}>
      <div className="mx-auto flex max-w-5xl flex-col gap-3 p-5">
        {data?.errors.map((e) => (
          <ErrorNote key={e.provider}>
            {e.provider}: {e.message}
          </ErrorNote>
        ))}
        <Card>
          {(data?.deployments ?? [])
            .filter((d, i, all) => all.findIndex((x) => x.provider === d.provider && x.project === d.project) === i)
            .toSorted((a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state))
            .map((deploy) => {
              const project = deploy.remote ? projectByRemote.get(deploy.remote) : undefined;
              return (
                <div
                  key={`${deploy.provider}:${deploy.id}`}
                  className="flex h-11 items-center gap-3 border-b border-line px-4 text-sm last:border-b-0 hover:bg-hover"
                >
                  <span title={deploy.state} className={`size-2 shrink-0 rounded-full ${STATE_DOT[deploy.state]}`} />
                  <span className="w-48 truncate font-medium">{deploy.project}</span>
                  <span className="w-20 text-xs text-faint">{deploy.provider}</span>
                  <span className="min-w-0 flex-1 truncate text-muted">{deploy.message}</span>
                  {project ? (
                    <Link {...projectLink(project.id)} className="text-faint hover:text-fg">
                      {project.name}
                    </Link>
                  ) : null}
                  <span className="font-mono text-xs text-faint">{deploy.branch}</span>
                  <span className="w-20 text-right text-xs">
                    <TimeAgo value={deploy.createdAt} />
                  </span>
                  {deploy.url ? (
                    <IconButton
                      size="sm"
                      label={`Open ${deploy.project}`}
                      icon={<ExternalLinkIcon className="size-3.5" />}
                      onClick={() => openExternal(deploy.url ?? "")}
                    />
                  ) : (
                    <span className="w-6" />
                  )}
                </div>
              );
            })}
        </Card>
      </div>
    </Page>
  );
}
