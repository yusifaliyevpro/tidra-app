import DOMPurify from "dompurify";
import { marked } from "marked";
import type { ReactNode } from "react";
import { openExternal } from "./external";

marked.use({ gfm: true, breaks: false });

/** Changelog bodies come from third-party repos, so the HTML is sanitized before rendering. */
function renderMarkdown(source: string): string {
  return DOMPurify.sanitize(marked.parse(source, { async: false }), {
    FORBID_TAGS: ["style", "form", "input"],
    FORBID_ATTR: ["style"],
  });
}

export function Markdown({ source, className }: { source: string; className?: string }) {
  return (
    <div
      className={`markdown ${className ?? ""}`}
      data-selectable
      dangerouslySetInnerHTML={{ __html: renderMarkdown(source) }}
    />
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
