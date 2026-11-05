import { classifyBump, type Bump } from "./versions";

export interface PackageBump {
  name: string;
  from: string;
  to: string;
}

const PREFIX = "chore(deps): bump ";
const SUBJECT_LIMIT = 72;
const RISK_ORDER: Bump[] = ["major", "minor", "patch", "prerelease", "none"];

const risk = ({ from, to }: PackageBump) => RISK_ORDER.indexOf(classifyBump(from, to));
const scoped = ({ name }: PackageBump) => (name.startsWith("@") ? 1 : 0);

/** `chore(deps): bump next, oxfmt, vitest and 9 more`: riskiest bumps first, unscoped first within a risk to fit more. */
export function bumpSubject(bumps: PackageBump[]): string {
  const sorted = bumps.toSorted((a, b) => risk(a) - risk(b) || scoped(a) - scoped(b));
  const names = [...new Set(sorted.map((bump) => bump.name))];
  for (let shown = names.length; shown > 0; shown--) {
    const hidden = names.length - shown;
    const head = names.slice(0, hidden > 0 ? shown : shown - 1);
    const tail = hidden > 0 ? `${hidden} more` : names[shown - 1];
    const subject = PREFIX + (head.length > 0 ? `${head.join(", ")} and ${tail}` : tail);
    if (subject.length <= SUBJECT_LIMIT) return subject;
  }
  return `${PREFIX}${names.length} dependencies`;
}
