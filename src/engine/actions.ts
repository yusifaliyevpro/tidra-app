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
  /** Tool versions the step sets in its `with:` block, such as setup-node's `node-version`. */
  inputs?: ToolInput[];
}

export interface ToolInput {
  /** Zero-based line of the input in the workflow file. */
  line: number;
  name: string;
  tool: string;
  value: string;
}

/** Inputs that pick a tool's version, by action. */
const TOOL_INPUTS: Record<string, { name: string; tool: string }> = {
  "pnpm/action-setup": { name: "version", tool: "pnpm" },
  "actions/setup-node": { name: "node-version", tool: "Node.js" },
};

const INPUT = /^(\s*)([\w-]+):(\s+)(["']?)([^"'#\s](?:[^"'#]*[^"'#\s])?)\4(\s+#.*)?\s*$/;
const DASH = /^\s*-\s+/;

const USES = /^(\s*-?\s*uses:\s*)(["']?)([\w.-]+\/[\w./-]+)@([\w./-]+)\2(\s*#\s*(.*))?\s*$/;

export function refStyle(ref: string): RefStyle {
  if (/^[0-9a-f]{40}$/.test(ref)) return "sha";
  if (/^v?\d+$/.test(ref)) return "major";
  if (/^v?\d+\.\d+$/.test(ref)) return "minor";
  if (semver.valid(semver.coerce(ref)) && /^v?\d+\.\d+\.\d+/.test(ref)) return "full";
  return "branch";
}

export function parseWorkflowUses(text: string): ActionUse[] {
  const lines = text.split(/\r?\n/);
  return lines.flatMap((line, index) => {
    const match = USES.exec(line);
    if (!match?.[3] || !match[4] || match[3].startsWith("./") || match[3].startsWith("docker:")) return [];
    const action = match[3];
    const ref = match[4];
    const inputs = toolInputs(lines, index, action);
    return [
      {
        line: index,
        action,
        repo: action.split("/").slice(0, 2).join("/"),
        ref,
        style: refStyle(ref),
        comment: match[6]?.trim() || undefined,
        ...(inputs.length > 0 ? { inputs } : {}),
      },
    ];
  });
}

const indentOf = (line: string) => /^\s*/.exec(line)?.[0].length ?? 0;
const isBlank = (line: string) => /^\s*(#.*)?$/.test(line);
/** Column of a line's key: after the `- ` when it starts a list item. */
const keyColumn = (line: string) => DASH.exec(line)?.[0].length ?? indentOf(line);

/** Reads the `with:` block of the step around `usesLine` (its keys share the `uses:` column) for `TOOL_INPUTS`. */
function toolInputs(lines: string[], usesLine: number, action: string): ToolInput[] {
  const known = TOOL_INPUTS[action];
  if (!known) return [];
  const column = (lines[usesLine] ?? "").indexOf("uses:");
  let start = usesLine;
  while (start > 0 && !DASH.test(lines[start] ?? "")) {
    const above = lines[start - 1] ?? "";
    // Stop above the step: a dash that isn't this step's, or a key left of its column.
    if (!isBlank(above) && indentOf(above) < column && (!DASH.test(above) || keyColumn(above) !== column)) break;
    start--;
  }
  const found: ToolInput[] = [];
  let inWith = false;
  for (let i = start; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (isBlank(line)) continue;
    if (i > start && indentOf(line) < column) break;
    if (keyColumn(line) === column) {
      inWith = /^\s*(-\s+)?with:\s*(#.*)?$/.test(line);
      continue;
    }
    const match = inWith ? INPUT.exec(line) : null;
    if (match?.[2] === known.name && match[5]) {
      found.push({ line: i, name: known.name, tool: known.tool, value: match[5] });
    }
  }
  return found;
}

/** Whether a tool input is a plain value Tidra can rewrite, not a `${{ }}` expression. */
export const isEditableInput = (input: ToolInput) => !input.value.includes("${{");

/** Rewrites one input's value and keeps its quotes and comment; quotes values YAML would read as something else. */
export function setInputValue(text: string, line: number, value: string): string {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const match = INPUT.exec(lines[line] ?? "");
  if (!match) return text;
  // `20.10` unquoted is the number 20.1.
  const needsQuotes = !match[4] && /^\d+\.\d*0$|^[-?:,[\]{}#&*!|>'"%@`]|: | #|:$|["']/.test(value);
  const written = needsQuotes ? JSON.stringify(value) : `${match[4]}${value}${match[4]}`;
  lines[line] = `${match[1]}${match[2]}:${match[3]}${written}${match[6] ?? ""}`;
  return lines.join(eol);
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
