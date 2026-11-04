const START = "<!-- tidra:commits -->";
const END = "<!-- /tidra:commits -->";
const GENERATED_TITLE = "chore(deps): update dependencies";
const BUMP = "chore(deps): bump ";

const subject = (message: string) => message.split(/\r?\n/, 1)[0]?.trim() ?? "";

/** One commit names the PR after itself; several get a summary title. Takes full commit messages. */
export function pullTitle(messages: string[]): string {
  const [first] = messages;
  return messages.length === 1 && first ? subject(first) : GENERATED_TITLE;
}

/** The new title for an existing PR, or undefined to leave it: titles someone wrote by hand are kept. */
export function nextPullTitle(current: string, messages: string[]): string | undefined {
  const next = pullTitle(messages);
  return current !== next && current.startsWith("chore(deps):") ? next : undefined;
}

/** A bump commit's packages (`react 19.2.0 → 19.3.1`), from its body list or its one-package subject. */
function listLines(message: string): string[] {
  const body = message
    .split(/\r?\n/)
    .slice(1)
    .filter((line) => line.startsWith("- "));
  const first = subject(message);
  if (first.startsWith(BUMP) && body.length > 0) return body;
  return [`- ${first.startsWith(BUMP) ? first.slice(BUMP.length) : first}`];
}

/**
 * The list Tidra owns sits between markers, so pushing more commits rewrites only that part and anything
 * written around it stays. A body without markers that is only a list came from an older Tidra and is replaced.
 */
export function pullBody(messages: string[], current?: string | null): string {
  const block = [START, ...messages.flatMap(listLines), END].join("\n");
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
