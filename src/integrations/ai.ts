import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, type LanguageModel } from "ai";
import { SECRET_KEYS, type SecretKey } from "@/core/secrets";
import type { ChangelogEntry } from "@/engine/changelog";

export interface AiConfig {
  provider: string;
  model: string;
  /** Only for the OpenAI-compatible provider (OpenAI, OpenRouter, Ollama, LM Studio...). */
  baseUrl?: string;
}

export interface AiProvider {
  id: string;
  label: string;
  secretKey: SecretKey;
  defaultModel: string;
  needsBaseUrl: boolean;
  model(input: { apiKey: string; config: AiConfig; fetch: typeof globalThis.fetch }): LanguageModel;
}

export class AiRefusalError extends Error {
  constructor() {
    super("The model declined to summarize these release notes.");
    this.name = "AiRefusalError";
  }
}

/** Registered providers; the Vercel AI SDK keeps the call site identical for each one. */
export const AI_PROVIDERS: AiProvider[] = [
  {
    id: "anthropic",
    label: "Anthropic",
    secretKey: SECRET_KEYS.anthropic,
    defaultModel: "claude-opus-5-5",
    needsBaseUrl: false,
    model: ({ apiKey, config, fetch }) => createAnthropic({ apiKey, fetch })(config.model),
  },
  {
    id: "openai-compatible",
    label: "OpenAI-compatible",
    secretKey: SECRET_KEYS.openai,
    defaultModel: "gpt-5",
    needsBaseUrl: true,
    model: ({ apiKey, config, fetch }) =>
      createOpenAICompatible({ name: "custom", baseURL: config.baseUrl ?? "https://api.openai.com/v1", apiKey, fetch })(
        config.model,
      ),
  },
];

export const DEFAULT_AI_CONFIG: AiConfig = { provider: "anthropic", model: "claude-opus-5-5" };

const SYSTEM = `You review dependency upgrades for a developer.
From the release notes provided, report only what matters for upgrading:
1. Breaking changes, each with the concrete code or config change needed.
2. Deprecations worth acting on now.
3. Anything else that changes behaviour silently.
Be brief. Use short Markdown bullet lists under those three headings and omit empty headings.
If the notes show nothing breaking, say so in one sentence.
Base everything on the notes; if they are vague, say what is unclear instead of guessing.`;

/** Release notes oldest first, trimmed per release so one huge changelog cannot crowd out the rest. */
export function buildUpgradePrompt(
  name: string,
  from: string | undefined,
  to: string,
  entries: ChangelogEntry[],
): string {
  const perRelease = Math.floor(60_000 / Math.max(entries.length, 1));
  const notes = entries
    .map((e) => {
      const body = e.body.length > perRelease ? `${e.body.slice(0, perRelease)}\n[truncated]` : e.body;
      return `<release version="${e.version}">\n${body || "(no notes)"}\n</release>`;
    })
    .join("\n\n");
  return `Upgrade ${name} from ${from ?? "an unknown version"} to ${to}.\n\n<release_notes>\n${notes}\n</release_notes>`;
}

export async function summarizeUpgrade(input: {
  config: AiConfig;
  apiKey: string;
  fetch: typeof globalThis.fetch;
  prompt: string;
  signal?: AbortSignal;
}): Promise<string> {
  const provider = AI_PROVIDERS.find((p) => p.id === input.config.provider);
  if (!provider) throw new Error(`Unknown AI provider "${input.config.provider}".`);
  const result = await generateText({
    model: provider.model({ apiKey: input.apiKey, config: input.config, fetch: input.fetch }),
    system: SYSTEM,
    prompt: input.prompt,
    maxOutputTokens: 16_000,
    abortSignal: input.signal,
  });
  if (result.finishReason === "content-filter") throw new AiRefusalError();
  return result.text.trim();
}
