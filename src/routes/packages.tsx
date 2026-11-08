import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import * as z from "@zod/mini";
import { useState } from "react";
import { usePackages, useSetting } from "@/app/queries";
import { useServices } from "@/app/services";
import { JobRefresh } from "@/modules/common";
import { NPM_USERNAME_SETTING, refreshPackages } from "@/services/packages";
import { Button } from "@/ui/button";
import { Input } from "@/ui/field";
import { Card, Empty, ErrorNote, Page } from "@/ui/layout";
import { ExternalLink } from "@/ui/markdown";
import { Mono, Sparkline } from "@/ui/misc";
import { TimeAgo } from "@/ui/time";
import { toastError } from "@/ui/toast";

export const Route = createFileRoute("/packages")({ component: Packages });

const number = new Intl.NumberFormat("en", { notation: "compact" });

function Packages() {
  const svc = useServices();
  const queryClient = useQueryClient();
  const { data: username } = useSetting(NPM_USERNAME_SETTING, z.string(), "");
  const { data } = usePackages();
  const [draft, setDraft] = useState("");
  const save = useMutation({
    mutationFn: async () => {
      await svc.store.setSetting(NPM_USERNAME_SETTING, draft.trim());
      await queryClient.invalidateQueries({ queryKey: ["setting", NPM_USERNAME_SETTING] });
      await refreshPackages(svc);
    },
    onError: toastError,
  });
  const changeAccount = useMutation({
    mutationFn: async () => {
      setDraft(username ?? "");
      await svc.store.setSetting(NPM_USERNAME_SETTING, "");
      await queryClient.invalidateQueries({ queryKey: ["setting", NPM_USERNAME_SETTING] });
    },
    onError: toastError,
  });

  if (!username) {
    return (
      <Page title="Packages">
        <Empty title="Which npm account is yours?">
          <div className="mt-3 flex gap-2">
            <Input
              value={draft}
              placeholder="npm username"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && draft && save.mutate()}
            />
            <Button variant="primary" disabled={!draft.trim()} loading={save.isPending} onClick={() => save.mutate()}>
              Show packages
            </Button>
          </div>
        </Empty>
      </Page>
    );
  }

  return (
    <Page
      title="Packages"
      actions={
        <>
          <Button size="sm" variant="ghost" title="Change npm account" onClick={() => changeAccount.mutate()}>
            npm: {username}
          </Button>
          <JobRefresh jobId="packages" />
        </>
      }
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-3 p-5">
        {data?.error ? <ErrorNote>{data.error}</ErrorNote> : null}
        <Card>
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-faint">
              <tr className="h-8 border-b border-line">
                <th className="pl-4 font-normal">Package</th>
                <th className="font-normal">Version</th>
                <th className="font-normal">Published</th>
                <th className="text-right font-normal">Weekly</th>
                <th className="pl-4 font-normal">30 days</th>
                <th className="text-right font-normal">Stars</th>
                <th className="pr-4 text-right font-normal">Issues</th>
              </tr>
            </thead>
            <tbody>
              {(data?.packages ?? []).map((pkg) => (
                <tr key={pkg.name} className="h-11 border-b border-line last:border-b-0">
                  <td className="pl-4">
                    <ExternalLink
                      href={`https://www.npmjs.com/package/${pkg.name}`}
                      className="font-medium hover:underline"
                    >
                      {pkg.name}
                    </ExternalLink>
                    {pkg.description ? (
                      <div className="max-w-80 truncate text-xs text-faint">{pkg.description}</div>
                    ) : null}
                  </td>
                  <td>
                    <Mono>{pkg.version}</Mono>
                  </td>
                  <td className="text-xs">{pkg.publishedAt ? <TimeAgo value={pkg.publishedAt} /> : null}</td>
                  <td className="text-right tabular">{number.format(pkg.weekly)}</td>
                  <td className="pl-4">
                    <Sparkline values={pkg.daily} />
                  </td>
                  <td className="text-right tabular">{pkg.stars !== undefined ? number.format(pkg.stars) : "–"}</td>
                  <td className="pr-4 text-right tabular">{pkg.openIssues ?? "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </Page>
  );
}
