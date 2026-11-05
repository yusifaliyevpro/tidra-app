/** Forward-slash paths everywhere; Windows APIs accept them and comparisons stay simple. */
export function normalize(path: string): string {
  const slashed = path.replaceAll("\\", "/");
  // `//` keeps Windows network paths (WSL, shares) from turning into a rooted local path.
  const drive =
    /^[a-zA-Z]:\//.exec(slashed)?.[0] ?? (slashed.startsWith("//") ? "//" : slashed.startsWith("/") ? "/" : "");
  const parts: string[] = [];
  for (const part of slashed.slice(drive.length).split("/")) {
    if (part === "" || part === ".") continue;
    if (part !== "..") parts.push(part);
    else if (parts.length > 0 && parts.at(-1) !== "..") parts.pop();
    else if (!drive) parts.push(part);
  }
  return drive + parts.join("/") || ".";
}

export function join(...segments: string[]): string {
  return normalize(segments.filter(Boolean).join("/"));
}

export function dirname(path: string): string {
  const normalized = normalize(path);
  // A network path's root is its share, so walking up stops there.
  if (/^\/\/[^/]+(\/[^/]+)?$/.test(normalized)) return normalized;
  const index = normalized.lastIndexOf("/");
  if (index < 0) return ".";
  if (index === 0) return "/";
  const parent = normalized.slice(0, index);
  return /^[a-zA-Z]:$/.test(parent) ? `${parent}/` : parent;
}

export function basename(path: string): string {
  const normalized = normalize(path);
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}

export function relative(from: string, to: string): string {
  const a = normalize(from).split("/");
  const b = normalize(to).split("/");
  let i = 0;
  while (i < a.length && i < b.length && a[i]?.toLowerCase() === b[i]?.toLowerCase()) i++;
  return [...Array.from({ length: a.length - i }, () => ".."), ...b.slice(i)].join("/") || ".";
}
