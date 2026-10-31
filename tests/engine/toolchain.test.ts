import { describe, expect, it } from "vitest";
import { parseNodeIndex, parsePnpmGlobalOutdated, parseVersionOutput, parseWingetUpgrades } from "@/engine/toolchain";

describe("parseVersionOutput", () => {
  it("reads versions from common --version outputs", () => {
    expect(parseVersionOutput("v26.12.1\n")).toBe("26.12.1");
    expect(parseVersionOutput("git version 2.47.1.windows.2")).toBe("2.47.1");
    expect(parseVersionOutput("rustc 1.98.1 (48a229cea 2026-09-01)")).toBe("1.98.1");
    expect(parseVersionOutput("12.17.0")).toBe("12.17.0");
    expect(parseVersionOutput("not installed")).toBeUndefined();
  });
});

describe("parseWingetUpgrades", () => {
  it("parses the fixed-width table, skipping progress spinners and the summary line", () => {
    const output = [
      "   - \r   \\ \r",
      "Name                        Id                          Version      Available    Source",
      "------------------------------------------------------------------------------------------",
      "Git                         Git.Git                     2.47.0       2.47.1       winget",
      "Microsoft Visual Studio Code Microsoft.VisualStudioCode 1.105.0      1.106.1      winget",
      "2 upgrades available.",
    ].join("\r\n");
    expect(parseWingetUpgrades(output)).toEqual([
      { name: "Git", id: "Git.Git", version: "2.47.0", available: "2.47.1" },
      {
        name: "Microsoft Visual Studio Code",
        id: "Microsoft.VisualStudioCode",
        version: "1.105.0",
        available: "1.106.1",
      },
    ]);
  });

  it("returns nothing when there is no table", () => {
    expect(parseWingetUpgrades("No installed package found matching input criteria.")).toEqual([]);
  });
});

describe("parsePnpmGlobalOutdated", () => {
  it("reads the JSON object after any warnings", () => {
    const stdout = 'WARN something\n{"typescript":{"current":"7.0.1","latest":"7.0.2","wanted":"7.0.1"}}';
    expect(parsePnpmGlobalOutdated(stdout)).toEqual([{ name: "typescript", current: "7.0.1", latest: "7.0.2" }]);
    expect(parsePnpmGlobalOutdated("")).toEqual([]);
    expect(parsePnpmGlobalOutdated("{broken")).toEqual([]);
  });
});

describe("parseNodeIndex", () => {
  it("finds the latest current and LTS releases", () => {
    const index = [
      { version: "v27.1.0", lts: false },
      { version: "v26.12.1", lts: "Mermaid" },
      { version: "v26.12.0", lts: "Mermaid" },
    ];
    expect(parseNodeIndex(index)).toEqual({ current: "27.1.0", lts: "26.12.1" });
    expect(parseNodeIndex("nope")).toEqual({});
  });
});
