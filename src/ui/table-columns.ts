import type { CSSProperties } from "react";

const GAP = 12;
const PADDING_X = 20;

/** Grid columns for a list table: the `1fr` column never shrinks below `minName`, and rows scroll sideways instead of overlapping. */
export function tableColumns(tracks: readonly string[], minName: number): CSSProperties & { minWidth: number } {
  const fixed = tracks.reduce((sum, t) => sum + (t === "1fr" ? minName : Number.parseFloat(t)), 0);
  return {
    gridTemplateColumns: tracks.map((t) => (t === "1fr" ? `minmax(${minName}px, 1fr)` : t)).join(" "),
    minWidth: fixed + GAP * (tracks.length - 1) + PADDING_X * 2,
  };
}
