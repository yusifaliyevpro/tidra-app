import { SECRET_KEYS, type SecretKey } from "@/core/secrets";
import { DEPLOY_PROVIDERS, type Deployment } from "@/integrations/deploy";
import type { Services } from "./context";
import { readSnapshot, writeSnapshot } from "./snapshot";

export interface DeploysSnapshot {
  deployments: Deployment[];
  errors: { provider: string; message: string }[];
  configured: string[];
  updatedAt: string;
}

export async function refreshDeploys(svc: Services): Promise<DeploysSnapshot> {
  const keys = Object.values(SECRET_KEYS).filter((key) => key.startsWith("deploy."));
  const values = await Promise.all(keys.map((key) => svc.secrets.get(key)));
  const secrets: Partial<Record<SecretKey, string>> = Object.fromEntries(keys.map((key, i) => [key, values[i]]));
  const errors: DeploysSnapshot["errors"] = [];
  const ready = DEPLOY_PROVIDERS.filter((p) => p.fields.every((f) => secrets[f.key]));
  const configured = ready.map((p) => p.id);
  const results = await Promise.all(
    ready.map(async (provider) => {
      try {
        return await provider.latest(svc.io.fetch, secrets);
      } catch (error) {
        errors.push({ provider: provider.label, message: error instanceof Error ? error.message : String(error) });
        return [];
      }
    }),
  );
  const snapshot = {
    deployments: results.flat().toSorted((a, b) => b.createdAt.localeCompare(a.createdAt)),
    errors,
    configured,
    updatedAt: new Date().toISOString(),
  };
  await writeSnapshot(svc, "deploys", snapshot);
  await svc.queryClient.invalidateQueries({ queryKey: ["deploys"] });
  return snapshot;
}

export const readDeploys = async (svc: Services) => (await readSnapshot<DeploysSnapshot>(svc, "deploys"))?.data;
