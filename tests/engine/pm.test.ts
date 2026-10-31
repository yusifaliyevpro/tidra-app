import { describe, expect, it } from "vitest";
import { auditCommand, checksFromLines, detectChecks, display, parseCommandLine } from "@/engine/pm";
import type { PackageManager } from "@/engine/workspace";

const pnpm: PackageManager = { name: "pnpm", yarnBerry: false };

describe("detectChecks", () => {
  it("uses the check script when there is one", () => {
    expect(detectChecks(pnpm, { scripts: { check: "greenly", lint: "oxlint" } })).toEqual([
      { label: "check", command: { program: "pnpm", args: ["run", "check"] } },
    ]);
  });

  it("falls back to typecheck, lint and test in order, skipping npm's placeholder test", () => {
    expect(
      detectChecks(pnpm, { scripts: { test: "vitest run", lint: "oxlint", typecheck: "tsc" } }).map((c) => c.label),
    ).toEqual(["typecheck", "lint", "test"]);
    expect(detectChecks(pnpm, { scripts: { test: 'echo "Error: no test specified" && exit 1' } })).toEqual([]);
  });
});

describe("parseCommandLine", () => {
  it("splits on whitespace and honours quotes", () => {
    expect(parseCommandLine(`pnpm vitest run -t "keeps dev deps"`)).toEqual({
      program: "pnpm",
      args: ["vitest", "run", "-t", "keeps dev deps"],
    });
    expect(parseCommandLine("cargo test --  ''")).toEqual({ program: "cargo", args: ["test", "--", ""] });
    expect(parseCommandLine("   ")).toBeUndefined();
  });

  it("round-trips through display", () => {
    expect(display({ program: "pnpm", args: ["run", "a b"] })).toBe('pnpm run "a b"');
    expect(checksFromLines(["pnpm check", ""])).toHaveLength(1);
  });
});

describe("auditCommand", () => {
  it("matches each package manager's production-only flag", () => {
    expect(auditCommand(pnpm, true)).toEqual({ program: "pnpm", args: ["audit", "--json", "--prod"] });
    expect(auditCommand({ name: "npm", yarnBerry: false }, true).args).toContain("--omit=dev");
    expect(auditCommand({ name: "yarn", yarnBerry: true }, false).args).toEqual(["npm", "audit", "--json"]);
  });
});
