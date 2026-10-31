export const DEFAULT_REGISTRY = "https://registry.npmjs.org/";

export interface NpmConfig {
  registry: string;
  scopes: Record<string, string>;
  /** Keyed by `//host/path/` exactly as written in .npmrc. */
  auth: Record<string, { token?: string; basic?: string }>;
  values: Record<string, string>;
}

export function emptyConfig(): NpmConfig {
  return { registry: DEFAULT_REGISTRY, scopes: {}, auth: {}, values: {} };
}

const withSlash = (url: string) => (url.endsWith("/") ? url : `${url}/`);

function expand(value: string, env: Readonly<Record<string, string | undefined>>): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, key: string) => env[key] ?? "");
}

/** Applies one .npmrc file on top of `base`; later files win, like npm's own layering. */
export function parseNpmrc(
  text: string,
  env: Readonly<Record<string, string | undefined>>,
  base: NpmConfig = emptyConfig(),
): NpmConfig {
  const config: NpmConfig = {
    registry: base.registry,
    scopes: { ...base.scopes },
    auth: structuredClone(base.auth),
    values: { ...base.values },
  };
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const value = expand(
      line
        .slice(eq + 1)
        .trim()
        .replace(/^"(.*)"$/, "$1"),
      env,
    );
    if (key === "registry") config.registry = withSlash(value);
    else if (/^@[^:]+:registry$/.test(key)) config.scopes[key.slice(0, key.indexOf(":"))] = withSlash(value);
    else if (key.startsWith("//")) {
      const sep = key.lastIndexOf(":");
      const prefix = key.slice(0, sep);
      const field = key.slice(sep + 1);
      const entry = (config.auth[prefix] ??= {});
      if (field === "_authToken") entry.token = value;
      else if (field === "_auth") entry.basic = value;
    } else config.values[key] = value;
  }
  return config;
}

export function registryFor(config: NpmConfig, name: string): string {
  if (name.startsWith("@")) {
    const scope = name.slice(0, name.indexOf("/"));
    return config.scopes[scope] ?? config.registry;
  }
  return config.registry;
}

/** Finds the most specific `//host/path/` credential that covers `url`. */
export function authHeaderFor(config: NpmConfig, url: string): string | undefined {
  const target = url.replace(/^https?:/, "");
  let best: { length: number; header: string } | undefined;
  for (const [prefix, entry] of Object.entries(config.auth)) {
    if (!target.startsWith(withSlash(prefix))) continue;
    const header = entry.token ? `Bearer ${entry.token}` : entry.basic ? `Basic ${entry.basic}` : undefined;
    if (header && (!best || prefix.length > best.length)) best = { length: prefix.length, header };
  }
  return best?.header;
}

export function packumentUrl(config: NpmConfig, name: string): string {
  return registryFor(config, name) + name.replace("/", "%2f");
}
