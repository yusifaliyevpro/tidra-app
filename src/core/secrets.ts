import { invoke } from "@tauri-apps/api/core";

/** Every secret Tidra knows about. Values live only in the OS keychain (and, encrypted, in the sync vault). */
export const SECRET_KEYS = {
  github: "github.token",
  vercel: "deploy.vercel.token",
  netlify: "deploy.netlify.token",
  cloudflare: "deploy.cloudflare.token",
  cloudflareAccount: "deploy.cloudflare.account",
  anthropic: "ai.anthropic.key",
  openai: "ai.openai.key",
  syncConnection: "sync.connection",
  syncDataKey: "sync.dek",
} as const;

export type SecretKey = (typeof SECRET_KEYS)[keyof typeof SECRET_KEYS];

/** Secrets that travel inside the encrypted vault; the sync connection itself never does. */
export const SYNCED_SECRET_KEYS: SecretKey[] = [
  SECRET_KEYS.github,
  SECRET_KEYS.vercel,
  SECRET_KEYS.netlify,
  SECRET_KEYS.cloudflare,
  SECRET_KEYS.cloudflareAccount,
  SECRET_KEYS.anthropic,
  SECRET_KEYS.openai,
];

export interface SecretStore {
  get(key: SecretKey): Promise<string | undefined>;
  set(key: SecretKey, value: string): Promise<void>;
  delete(key: SecretKey): Promise<void>;
}

export const keychain: SecretStore = {
  get: async (key) => (await invoke<string | null>("secret_get", { key })) ?? undefined,
  set: (key, value) => invoke("secret_set", { key, value }),
  delete: (key) => invoke("secret_delete", { key }),
};

/** In-memory secrets for the browser preview and tests. */
export function memorySecrets(initial: Partial<Record<SecretKey, string>> = {}): SecretStore {
  const map = new Map<SecretKey, string>();
  for (const key of Object.values(SECRET_KEYS)) {
    const value = initial[key];
    if (value !== undefined) map.set(key, value);
  }
  return {
    get: async (key) => map.get(key),
    set: async (key, value) => void map.set(key, value),
    delete: async (key) => void map.delete(key),
  };
}
