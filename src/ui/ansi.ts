export interface AnsiSpan {
  text: string;
  className?: string;
}

const FG: Record<number, string> = {
  30: "text-faint",
  31: "text-bad",
  32: "text-ok",
  33: "text-warn",
  34: "text-info",
  35: "text-[#c084fc]",
  36: "text-accent",
  37: "text-fg",
  90: "text-faint",
  91: "text-bad",
  92: "text-ok",
  93: "text-warn",
  94: "text-info",
  95: "text-[#c084fc]",
  96: "text-accent",
  97: "text-fg",
};

/** Splits terminal output into styled spans; only SGR color, bold and dim codes are kept, the rest is dropped. */
export function parseAnsi(input: string): AnsiSpan[] {
  const spans: AnsiSpan[] = [];
  let fg: string | undefined;
  let bold = false;
  let dim = false;
  // ESC [ params letter: the escape character is exactly what this parser looks for.
  // oxlint-disable-next-line eslint/no-control-regex
  const pattern = /\u001b\[([\d;]*)([A-Za-z])/g;
  let last = 0;
  const push = (text: string) => {
    if (!text) return;
    const className = [fg, bold ? "font-semibold" : "", dim ? "opacity-60" : ""].filter(Boolean).join(" ") || undefined;
    const previous = spans.at(-1);
    if (previous && previous.className === className) previous.text += text;
    else spans.push({ text, className });
  };
  for (const match of input.matchAll(pattern)) {
    push(input.slice(last, match.index));
    last = match.index + match[0].length;
    if (match[2] !== "m") continue;
    for (const code of (match[1] || "0").split(";").map(Number)) {
      if (code === 0) {
        fg = undefined;
        bold = false;
        dim = false;
      } else if (code === 1) bold = true;
      else if (code === 2) dim = true;
      else if (code === 22) {
        bold = false;
        dim = false;
      } else if (code === 39) fg = undefined;
      else if (FG[code]) fg = FG[code];
    }
  }
  push(input.slice(last));
  return spans;
}

/** Applies carriage returns the way a terminal would, so progress bars don't pile up. */
export function collapseCarriageReturns(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      const parts = line.split("\r");
      return parts.findLast((part) => part.length > 0) ?? "";
    })
    .join("\n");
}
