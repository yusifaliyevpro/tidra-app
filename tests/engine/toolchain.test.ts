import { describe, expect, it } from "vitest";
import {
  chocolateyNodeUpdate,
  encodePowerShell,
  nodeUpdateTarget,
  parseNodeIndex,
  parsePnpmGlobals,
  parseVersionOutput,
  parseWingetUpgrades,
} from "@/engine/toolchain";

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

describe("parsePnpmGlobals", () => {
  const list = `WARN something
[{"path":"C:\\\\pnpm\\\\global\\\\v11","private":true,"dependencies":{
  "vercel":{"from":"vercel","version":"65.8.0"},
  "depcheck":{"from":"depcheck","version":"1.4.7"}}}]`;

  it("lists every global package and adds latest only where it is newer", () => {
    const outdated = 'WARN x\n{"vercel":{"current":"65.8.0","latest":"65.9.0","wanted":"65.8.0"}}';
    expect(parsePnpmGlobals(list, outdated)).toEqual([
      { name: "depcheck", version: "1.4.7" },
      { name: "vercel", version: "65.8.0", latest: "65.9.0" },
    ]);
  });

  it("still lists packages when pnpm outdated prints nothing or garbage", () => {
    expect(parsePnpmGlobals(list, "").map((p) => p.name)).toEqual(["depcheck", "vercel"]);
    expect(parsePnpmGlobals(list, "{broken")).toHaveLength(2);
    expect(parsePnpmGlobals("", "")).toEqual([]);
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

const decode = (base64: string) => Buffer.from(base64, "base64").toString("utf16le");

describe("chocolateyNodeUpdate", () => {
  it("elevates and installs the exact version, bootstrapping Chocolatey if needed", () => {
    const command = chocolateyNodeUpdate("26.13.0");
    expect(command.program).toBe("powershell");
    expect(command.args.slice(0, 2)).toEqual(["-NoProfile", "-EncodedCommand"]);
    const launcher = decode(command.args[2] ?? "");
    expect(launcher).toMatch(/-Verb RunAs .*-ArgumentList '-NoProfile'/);
    const inner = decode(/'-EncodedCommand','([^']+)'/.exec(launcher)?.[1] ?? "");
    expect(inner).toContain('choco upgrade nodejs --version="26.13.0" -y');
    expect(inner).toContain("community.chocolatey.org/install.ps1");
    expect(inner).toContain(String.raw`$env:ALLUSERSPROFILE\chocolatey\bin`);
  });

  it("refuses anything that is not a plain version", () => {
    expect(() => chocolateyNodeUpdate('26"; Remove-Item C:/ -Recurse; "')).toThrow("Not a Node.js version");
  });

  it("encodes UTF-16LE like PowerShell expects", () => {
    expect(encodePowerShell("ab")).toBe(Buffer.from("ab", "utf16le").toString("base64"));
  });
});

describe("toolchain edge cases", () => {
  it("returns nothing for output without a version", () => {
    expect(parseVersionOutput("command not found")).toBeUndefined();
    expect(parseVersionOutput("")).toBeUndefined();
  });

  it("completes two-part versions", () => {
    expect(parseVersionOutput("rustup 1.28")).toBe("1.28.0");
  });

  it("skips pnpm's warnings before the JSON and ignores outdated entries that aren't newer", () => {
    const list = 'WARN something\n[{"dependencies":{"b":{"version":"2.0.0"},"a":{"version":"1.0.0"}}}]';
    const outdated = 'WARN x\n{"a":{"latest":"1.0.0"},"b":{"latest":"2.1.0"}}';
    expect(parsePnpmGlobals(list, outdated)).toEqual([
      { name: "a", version: "1.0.0" },
      { name: "b", version: "2.0.0", latest: "2.1.0" },
    ]);
  });

  it("returns no globals when pnpm prints no JSON list", () => {
    expect(parsePnpmGlobals("", "")).toEqual([]);
    expect(parsePnpmGlobals("[]", "")).toEqual([]);
  });

  it("finds nothing in a Node index that isn't a release list", () => {
    expect(parseNodeIndex({ not: "a list" })).toEqual({});
    expect(parseNodeIndex([])).toEqual({ current: undefined, lts: undefined });
  });

  it("refuses versions that could inject into the PowerShell script", () => {
    expect(() => chocolateyNodeUpdate('24.0.0" ; Remove-Item C:\\ -Recurse ; "')).toThrow("Not a Node.js version");
  });
});

describe("nodeUpdateTarget", () => {
  const index = [
    { version: "v25.1.0", lts: false },
    { version: "v24.5.0", lts: "Krypton" },
    { version: "v23.11.0", lts: false },
    { version: "v22.20.0", lts: "Jod" },
    { version: "v22.19.0", lts: "Jod" },
  ];

  it.for([
    ["22.1.0", "22.20.0"],
    ["24.1.0", "24.5.0"],
    ["25.0.0", "25.1.0"],
    ["23.1.0", "25.1.0"],
    ["18.0.0", "25.1.0"],
  ])("compares %s with %s", ([installed, target]) => {
    expect(nodeUpdateTarget(index, installed)).toBe(target);
  });

  it("uses the current release without an installed Node, and nothing for a bad index", () => {
    expect(nodeUpdateTarget(index, undefined)).toBe("25.1.0");
    expect(nodeUpdateTarget({ nope: true }, "24.0.0")).toBeUndefined();
  });
});
