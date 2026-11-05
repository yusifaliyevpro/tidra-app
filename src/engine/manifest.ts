import { applyEdits, modify, type FormattingOptions } from "jsonc-parser";
import { parseDocument } from "yaml";
import type { DepField } from "./workspace";

export interface ManifestEdit {
  field: DepField;
  name: string;
  value: string;
}

export function detectFormatting(text: string): FormattingOptions & { eol: string } {
  const indent = /^([ \t]+)"/m.exec(text)?.[1] ?? "  ";
  return {
    insertSpaces: !indent.includes("\t"),
    tabSize: indent.includes("\t") ? 1 : indent.length,
    eol: text.includes("\r\n") ? "\r\n" : "\n",
  };
}

/**
 * Rewrites dependency values in place. Only the value tokens change, so key order, indentation,
 * line endings and the trailing newline stay exactly as they were.
 */
export function editManifest(text: string, edits: ManifestEdit[]): string {
  const formattingOptions = detectFormatting(text);
  let next = text;
  for (const edit of edits) {
    next = applyEdits(next, modify(next, [edit.field, edit.name], edit.value, { formattingOptions }));
  }
  return next;
}

export interface CatalogEdit {
  catalog: string;
  name: string;
  value: string;
}

/** The YAML writer always emits LF; a CRLF file must stay CRLF or every line shows up in the diff. */
const withLineEndingsOf = (original: string, text: string) =>
  original.includes("\r\n") ? text.replaceAll(/\r?\n/g, "\r\n") : text;

/** Edits `catalog:`/`catalogs:` entries through the YAML document model so comments and quoting survive. */
export function editCatalogs(yamlText: string, edits: CatalogEdit[]): string {
  const doc = parseDocument(yamlText);
  for (const edit of edits) {
    // The default catalog may live under `catalog:` or `catalogs.default:`; edit wherever it is declared.
    const named = ["catalogs", edit.catalog];
    const path = edit.catalog === "default" && !doc.hasIn([...named, edit.name]) ? ["catalog"] : named;
    doc.setIn([...path, edit.name], edit.value);
  }
  return withLineEndingsOf(yamlText, doc.toString({ lineWidth: 0 }));
}

export type OverrideEdit = { name: string; value: string };

/** pnpm reads `overrides` from pnpm-workspace.yaml; npm and bun from package.json; yarn uses `resolutions`. */
export function editYamlOverrides(yamlText: string, edits: OverrideEdit[]): string {
  const doc = parseDocument(yamlText);
  for (const edit of edits) doc.setIn(["overrides", edit.name], edit.value);
  return withLineEndingsOf(yamlText, doc.toString({ lineWidth: 0 }));
}

export function editJsonOverrides(
  text: string,
  field: "overrides" | "resolutions" | "pnpm.overrides",
  edits: OverrideEdit[],
): string {
  const formattingOptions = detectFormatting(text);
  let next = text;
  for (const edit of edits) {
    next = applyEdits(next, modify(next, [...field.split("."), edit.name], edit.value, { formattingOptions }));
  }
  return next;
}
