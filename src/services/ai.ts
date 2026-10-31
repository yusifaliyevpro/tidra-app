import * as z from "@zod/mini";
import type { ChangelogEntry } from "@/engine/changelog";
import {
  AI_PROVIDERS,
  buildUpgradePrompt,
  DEFAULT_AI_CONFIG,
  summarizeUpgrade,
  type AiConfig,
} from "@/integrations/ai";
import type { Services } from "./context";
import { readSnapshot, writeSnapshot } from "./snapshot";

export const AI_CONFIG_SETTING = "ai";

const AiConfigSchema = z.object({ provider: z.string(), model: z.string(), baseUrl: z.optional(z.string()) });

export const readAiConfig = (svc: Services): Promise<AiConfig> =>
  svc.store.getSetting(AI_CONFIG_SETTING, AiConfigSchema, DEFAULT_AI_CONFIG);

export async function aiReady(svc: Services): Promise<boolean> {
  const config = await readAiConfig(svc);
  const provider = AI_PROVIDERS.find((p) => p.id === config.provider);
  return Boolean(provider && (await svc.secrets.get(provider.secretKey)));
}

const summaryKey = (name: string, from: string | undefined, to: string) => `ai:${name}@${from ?? "?"}..${to}`;

export async function readUpgradeSummary(svc: Services, name: string, from: string | undefined, to: string) {
  return (await readSnapshot<{ text: string; model: string }>(svc, summaryKey(name, from, to)))?.data;
}

/** Summarizes breaking changes once per (package, from, to) and caches the answer. */
export async function summarize(
  svc: Services,
  input: { name: string; from: string | undefined; to: string; entries: ChangelogEntry[] },
): Promise<{ text: string; model: string }> {
  const config = await readAiConfig(svc);
  const provider = AI_PROVIDERS.find((p) => p.id === config.provider);
  const apiKey = provider ? await svc.secrets.get(provider.secretKey) : undefined;
  if (!apiKey) throw new Error("Add an AI API key in Settings to use summaries.");
  const text = await summarizeUpgrade({
    config,
    apiKey,
    fetch: svc.io.fetch,
    prompt: buildUpgradePrompt(input.name, input.from, input.to, input.entries),
  });
  const result = { text, model: config.model };
  await writeSnapshot(svc, summaryKey(input.name, input.from, input.to), result);
  return result;
}
