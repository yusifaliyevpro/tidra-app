import { describe, expect, it } from "vitest";
import { collapseCarriageReturns, parseAnsi } from "@/ui/ansi";

const ESC = "\u001b";

describe("parseAnsi", () => {
  it("maps colors and resets", () => {
    expect(parseAnsi(`${ESC}[32m✓${ESC}[0m passed ${ESC}[1;31mfail${ESC}[22;39m`)).toEqual([
      { text: "✓", className: "text-ok" },
      { text: " passed " },
      { text: "fail", className: "text-bad font-semibold" },
    ]);
  });

  it("drops cursor codes and merges runs with the same style", () => {
    expect(parseAnsi(`a${ESC}[2Kb${ESC}[1Gc`)).toEqual([{ text: "abc" }]);
  });
});

describe("collapseCarriageReturns", () => {
  it("keeps the last frame of a progress line", () => {
    expect(collapseCarriageReturns("Progress 1/3\rProgress 3/3\r\ndone")).toBe("Progress 3/3\ndone");
  });
});
