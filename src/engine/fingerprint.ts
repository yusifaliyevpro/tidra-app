const encoder = new TextEncoder();

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** One hash over several inputs; a missing file hashes differently from an empty one. */
export const fingerprint = (parts: (string | null | undefined)[]) =>
  sha256(
    parts
      .map((part) => (part === null || part === undefined ? "\u0000missing" : `${part.length}:${part}`))
      .join("\u0001"),
  );

/** Keeps the last few results of an expensive pure computation, keyed by the hash of its input. */
export function createHashCache<T>(size: number) {
  const entries = new Map<string, T>();
  return {
    get(hash: string): T | undefined {
      const value = entries.get(hash);
      if (value !== undefined) {
        entries.delete(hash);
        entries.set(hash, value);
      }
      return value;
    },
    set(hash: string, value: T) {
      entries.set(hash, value);
      if (entries.size > size) entries.delete(entries.keys().next().value ?? "");
    },
  };
}
