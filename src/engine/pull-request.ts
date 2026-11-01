const START = "<!-- tidra:commits -->";
const END = "<!-- /tidra:commits -->";
const GENERATED_TITLE = "chore(deps): update dependencies";

/** One commit names the PR after itself; several get a summary title. */
export function pullTitle(subjects: string[]): string {
  const [first] = subjects;
  return subjects.length === 1 && first ? first : GENERATED_TITLE;
}

/** The new title for an existing PR, or undefined to leave it: titles someone wrote by hand are kept. */
export function nextPullTitle(current: string, subjects: string[]): string | undefined {
  const next = pullTitle(subjects);
  return current !== next && current.startsWith("chore(deps):") ? next : undefined;
}

/**
 * The commit list Tidra owns sits between markers, so pushing more commits rewrites only that part and anything
 * written around it stays. A body without markers that is only a list came from an older Tidra and is replaced.
 */
export function pullBody(subjects: string[], current?: string | null): string {
  const block = [START, ...subjects.map((s) => `- ${s}`), END].join("\n");
  if (!current?.trim()) return block;
  const start = current.indexOf(START);
  const end = current.indexOf(END);
  if (start >= 0 && end > start) return current.slice(0, start) + block + current.slice(end + END.length);
  if (
    current
      .trim()
      .split(/\r?\n/)
      .every((line) => line.startsWith("- "))
  )
    return block;
  return `${current.trimEnd()}\n\n${block}`;
}
