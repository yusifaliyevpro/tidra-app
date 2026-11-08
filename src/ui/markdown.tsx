import { Suspense, use, type ReactNode } from "react";
import { openExternal } from "./external";
import type * as RenderMarkdown from "./render-markdown";

// marked and DOMPurify load with the first note shown, not at launch.
let renderer: Promise<typeof RenderMarkdown> | undefined;
const loadRenderer = () => (renderer ??= import("./render-markdown"));

function Rendered({ source, className }: { source: string; className?: string }) {
  const { renderMarkdown } = use(loadRenderer());
  return (
    <div
      className={`markdown ${className ?? ""}`}
      data-selectable
      dangerouslySetInnerHTML={{ __html: renderMarkdown(source) }}
    />
  );
}

export function Markdown({ source, className }: { source: string; className?: string }) {
  return (
    <Suspense fallback={null}>
      <Rendered source={source} className={className} />
    </Suspense>
  );
}

export function ExternalLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a
      href={href}
      className={className ?? "text-accent-text hover:underline"}
      onClick={(e) => {
        e.preventDefault();
        openExternal(href);
      }}
    >
      {children}
    </a>
  );
}
