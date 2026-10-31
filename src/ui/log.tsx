import { cn } from "cn";
import { useEffect, useRef } from "react";
import { collapseCarriageReturns, parseAnsi } from "./ansi";

/** Terminal output with ANSI colors; sticks to the bottom while new output arrives unless the user scrolled up. */
export function Log({
  text,
  className,
  empty = "No output yet.",
}: {
  text: string;
  className?: string;
  empty?: string;
}) {
  const ref = useRef<HTMLPreElement>(null);
  const pinned = useRef(true);

  useEffect(() => {
    const el = ref.current;
    if (el && pinned.current && text.length > 0) el.scrollTop = el.scrollHeight;
  }, [text]);

  const spans = parseAnsi(collapseCarriageReturns(text));
  return (
    <pre
      ref={ref}
      onScroll={(e) => {
        const el = e.currentTarget;
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
      }}
      className={cn(
        "overflow-auto rounded-md border border-line bg-[#09090a] p-3 font-mono text-sm leading-[18px] whitespace-pre-wrap text-fg",
        className,
      )}
      data-selectable
    >
      {text ? (
        spans.map((span, i) =>
          span.className ? (
            <span key={i} className={span.className}>
              {span.text}
            </span>
          ) : (
            span.text
          ),
        )
      ) : (
        <span className="text-faint">{empty}</span>
      )}
    </pre>
  );
}
