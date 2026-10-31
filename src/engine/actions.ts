import semver from "semver";

export type RefStyle = "sha" | "major" | "minor" | "full" | "branch";

export interface ActionUse {
  /** Zero-based line in the workflow file. */
  line: number;
  /** `owner/repo` or `owner/repo/path` as written. */
  action: string;
  /** `owner/repo`, where releases live. */
  repo: string;
  ref: string;
  style: RefStyle;
  /** Trailing comment, usually the version a SHA pin stands for. */
  comment?: string;
}

const USES = /^(\s*-?\s*uses:\s*)(["']?)([\w.-]+\/[\w./-]+)@([\w./-]+)\2(\s*#\s*(.*))?\s*$/;

export function refStyle(ref: string): RefStyle {
  if (/^[0-9a-f]{40}$/.test(ref)) return "sha";
  if (/^v?\d+$/.test(ref)) return "major";
  if (/^v?\d+\.\d+$/.test(ref)) return "minor";
  if (semver.valid(semver.coerce(ref)) && /^v?\d+\.\d+\.\d+/.test(ref)) return "full";
  return "branch";
}

export function parseWorkflowUses(text: string): ActionUse[] {
  return text.split(/\r?\n/).flatMap((line, index) => {
    const match = USES.exec(line);
    if (!match?.[3] || !match[4] || match[3].startsWith("./") || match[3].startsWith("docker:")) return [];
    const action = match[3];
    const ref = match[4];
    return [
      {
        line: index,
        action,
        repo: action.split("/").slice(0, 2).join("/"),
        ref,
        style: refStyle(ref),
        comment: match[6]?.trim() || undefined,
      },
    ];
  });
}

/** The version a ref currently stands for: the tag itself, or the `# v4.1.2` comment next to a SHA pin. */
export function currentVersion(use: ActionUse): string | undefined {
  const source = use.style === "sha" ? use.comment : use.ref;
  return semver.coerce(source ?? "", { includePrerelease: false })?.version;
}

/** The ref to write for `latestTag`, kept in the same style as the existing one. */
export function nextRef(
  use: ActionUse,
  latestTag: string,
  latestSha?: string,
): { ref: string; comment?: string } | undefined {
  const latest = semver.coerce(latestTag)?.version;
  const current = currentVersion(use);
  if (!latest || !current || use.style === "branch") return undefined;
  const v = use.ref.startsWith("v") || (use.style === "sha" && latestTag.startsWith("v")) ? "v" : "";
  switch (use.style) {
    case "major":
      return semver.major(latest) > semver.major(current) ? { ref: `${v}${semver.major(latest)}` } : undefined;
    case "minor": {
      const next = `${semver.major(latest)}.${semver.minor(latest)}`;
      return semver.gt(`${next}.0`, `${semver.major(current)}.${semver.minor(current)}.0`)
        ? { ref: `${v}${next}` }
        : undefined;
    }
    case "full":
      return semver.gt(latest, current) ? { ref: latestTag } : undefined;
    case "sha":
      return latestSha && semver.gt(latest, current) ? { ref: latestSha, comment: latestTag } : undefined;
    default:
      return undefined;
  }
}

export interface ActionUpdate {
  line: number;
  ref: string;
  comment?: string;
}

/** Rewrites only the `@ref` (and SHA comment) on the given lines, leaving everything else byte-for-byte. */
export function applyActionUpdates(text: string, updates: ActionUpdate[]): string {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  for (const update of updates) {
    const line = lines[update.line];
    const match = line === undefined ? null : USES.exec(line);
    if (!match) continue;
    const comment = update.comment ? ` # ${update.comment}` : (match[5] ?? "");
    lines[update.line] = `${match[1]}${match[2]}${match[3]}@${update.ref}${match[2]}${comment}`;
  }
  return lines.join(eol);
}
