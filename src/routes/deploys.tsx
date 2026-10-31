import { createFileRoute, Link } from "@tanstack/react-router";
import { Rocket } from "lucide-react";
import { useDeploys, useReports } from "@/app/queries";
import type { DeployState } from "@/integrations/deploy";
import { JobRefresh } from "@/modules/common";
import { projectLink } from "@/modules/links";
import { Badge } from "@/ui/badge";
import { openExternal } from "@/ui/external";
import { Card, Empty, ErrorNote, Page } from "@/ui/layout";
import { TimeAgo } from "@/ui/time";
import type { Tone } from "@/ui/tone";

export const Route = createFileRoute("/deploys")({ component: Deploys });

const STATE_TONE: Record<DeployState, Tone> = {
  ready: "ok",
  building: "warn",
  queued: "neutral",
  error: "bad",
  canceled: "neutral",
};

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
            <Link to="/settings" className="text-accent hover:underline">
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
            .map((deploy) => {
              const project = deploy.remote ? projectByRemote.get(deploy.remote) : undefined;
              return (
                <div
                  key={`${deploy.provider}:${deploy.id}`}
                  className="flex h-11 items-center gap-3 border-b border-line px-4 text-sm last:border-b-0 hover:bg-hover"
                >
                  <Badge tone={STATE_TONE[deploy.state]}>{deploy.state}</Badge>
                  <span className="w-48 truncate font-medium">{deploy.project}</span>
                  <span className="w-28 text-faint">{deploy.provider}</span>
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
                    <button
                      type="button"
                      className="text-accent hover:underline"
                      onClick={() => openExternal(deploy.url ?? "")}
                    >
                      Open
                    </button>
                  ) : null}
                </div>
              );
            })}
        </Card>
      </div>
    </Page>
  );
}
