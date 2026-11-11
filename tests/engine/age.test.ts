import { describe, expect, it } from "vitest";
import { shortAge } from "@/engine/age";

const NOW = Date.parse("2026-10-31T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe("shortAge", () => {
  it.each([
    [10_000, "1m"],
    [5 * 60_000, "5m"],
    [21 * 3_600_000, "21h"],
    [86_400_000, "1d"],
    [95 * 86_400_000, "3mo"],
    [400 * 86_400_000, "1y"],
  ])("formats %d ms as %s", (ms, text) => {
    expect(shortAge(ago(ms), NOW)).toBe(text);
  });
});
