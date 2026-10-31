import { useQuery } from "@tanstack/react-query";
import type * as z from "@zod/mini";
import type { SecretKey } from "@/core/secrets";
import { readActions } from "@/services/actions";
import type { TimelineItem } from "@/services/changelogs";
import { readDeploys } from "@/services/deploys";
import { readBotPulls, readCi, readInbox } from "@/services/github-feed";
import { dismissedAdvisories, homeSummary, readCiThreshold } from "@/services/home";
import { readPackages } from "@/services/packages";
import { readAllReports, readReport } from "@/services/projects";
import { readSecurity } from "@/services/security";
import { readSnapshot } from "@/services/snapshot";
import { syncStatus } from "@/services/sync";
import { readToolchain } from "@/services/toolchain";
import { useServices } from "./services";

/** Every hook reads local data only; background jobs refresh it and invalidate these keys. */
export function useReports() {
  const svc = useServices();
  return useQuery({ queryKey: ["reports"], queryFn: () => readAllReports(svc) });
}

export function useProject(projectId: string) {
  const svc = useServices();
  return useQuery({
    queryKey: ["project", projectId],
    queryFn: async () => (await svc.store.getProject(projectId)) ?? null,
  });
}

export function useReport(projectId: string) {
  const svc = useServices();
  return useQuery({ queryKey: ["report", projectId], queryFn: async () => (await readReport(svc, projectId)) ?? null });
}

export function useHome() {
  const svc = useServices();
  return useQuery({ queryKey: ["home"], queryFn: () => homeSummary(svc) });
}

export function useSecurity() {
  const svc = useServices();
  return useQuery({
    queryKey: ["security"],
    queryFn: async () => {
      const [projects, threshold, dismissed] = await Promise.all([
        svc.store.listProjects(),
        readCiThreshold(svc),
        dismissedAdvisories(svc),
      ]);
      const reports = await Promise.all(
        projects.map(async (project) => ({ project, report: await readSecurity(svc, project.id) })),
      );
      return { reports, threshold, dismissed };
    },
  });
}

export function useActions() {
  const svc = useServices();
  return useQuery({
    queryKey: ["actions"],
    queryFn: async () => {
      const projects = await svc.store.listProjects();
      return Promise.all(projects.map(async (project) => ({ project, report: await readActions(svc, project.id) })));
    },
  });
}

export function useTimeline() {
  const svc = useServices();
  return useQuery({
    queryKey: ["timeline"],
    queryFn: async () =>
      (await readSnapshot<{ items: TimelineItem[]; errors: string[] }>(svc, "timeline"))?.data ?? null,
  });
}

export function useInbox() {
  const svc = useServices();
  return useQuery({ queryKey: ["inbox"], queryFn: async () => (await readInbox(svc)) ?? null });
}

export function useCi() {
  const svc = useServices();
  return useQuery({ queryKey: ["ci"], queryFn: async () => (await readCi(svc)) ?? null });
}

export function useBotPulls() {
  const svc = useServices();
  return useQuery({ queryKey: ["bot-pulls"], queryFn: async () => (await readBotPulls(svc)) ?? null });
}

export function useDeploys() {
  const svc = useServices();
  return useQuery({ queryKey: ["deploys"], queryFn: async () => (await readDeploys(svc)) ?? null });
}

export function usePackages() {
  const svc = useServices();
  return useQuery({ queryKey: ["packages"], queryFn: async () => (await readPackages(svc)) ?? null });
}

export function useToolchain() {
  const svc = useServices();
  return useQuery({ queryKey: ["toolchain"], queryFn: async () => (await readToolchain(svc)) ?? null });
}

export function useSyncStatus() {
  const svc = useServices();
  return useQuery({ queryKey: ["sync"], queryFn: () => syncStatus(svc) });
}

export function useJobs() {
  const svc = useServices();
  return useQuery({ queryKey: ["jobs"], queryFn: () => svc.jobStates(), staleTime: 0 });
}

export function useSetting<S extends z.ZodMiniType>(key: string, schema: S, fallback: z.input<S>) {
  const svc = useServices();
  return useQuery({ queryKey: ["setting", key], queryFn: () => svc.store.getSetting(key, schema, fallback) });
}

export function useSecretPresence(keys: SecretKey[]) {
  const svc = useServices();
  return useQuery({
    queryKey: ["secrets", ...keys],
    queryFn: async () => {
      const entries = await Promise.all(keys.map(async (key) => [key, Boolean(await svc.secrets.get(key))] as const));
      return Object.fromEntries(entries);
    },
  });
}
