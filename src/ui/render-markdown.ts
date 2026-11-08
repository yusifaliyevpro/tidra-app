import DOMPurify from "dompurify";
import { marked } from "marked";

marked.use({ gfm: true, breaks: false });

/** Changelog bodies come from third-party repos, so the HTML is sanitized before rendering. */
export function renderMarkdown(source: string): string {
  return DOMPurify.sanitize(marked.parse(source, { async: false }), {
    FORBID_TAGS: ["style", "form", "input"],
    FORBID_ATTR: ["style"],
  });
}
