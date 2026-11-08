import { describe, expect, it } from "vitest";
import { tableColumns } from "@/ui/table-columns";

describe("tableColumns", () => {
  it("keeps the flexible name column from collapsing to nothing on a narrow window", () => {
    const style = tableColumns(["16px", "1fr", "200px"], 160);
    expect(style.gridTemplateColumns).toBe("16px minmax(160px, 1fr) 200px");
  });

  it("sets a row min width so a narrow window scrolls instead of overlapping columns", () => {
    // 16 + 160 + 200, two 12px gaps, 20px padding on each side
    expect(tableColumns(["16px", "1fr", "200px"], 160).minWidth).toBe(16 + 160 + 200 + 2 * 12 + 2 * 20);
  });
});
