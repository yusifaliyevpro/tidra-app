import { describe, expect, it } from "vitest";
import {
  addCommand,
  auditCommand,
  checksFromLines,
  detectChecks,
  display,
  installCommand,
  parseCommandLine,
  scriptCommand,
} from "@/engine/pm";
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

const PMS = {
  npm: { name: "npm", yarnBerry: false },
  pnpm: { name: "pnpm", yarnBerry: false },
  yarn: { name: "yarn", yarnBerry: false },
  berry: { name: "yarn", yarnBerry: true },
  bun: { name: "bun", yarnBerry: false },
} as const;

describe("addCommand", () => {
  it.for([
    ["npm", "dependencies", false, "npm install a@^1.0.0 --save"],
    ["npm", "devDependencies", true, "npm install a@^1.0.0 --save-dev --save-exact"],
    ["npm", "optionalDependencies", false, "npm install a@^1.0.0 --save-optional"],
    ["pnpm", "dependencies", false, "pnpm add a@^1.0.0"],
    ["pnpm", "devDependencies", true, "pnpm add a@^1.0.0 --save-dev --save-exact"],
    ["pnpm", "optionalDependencies", false, "pnpm add a@^1.0.0 --save-optional"],
    ["yarn", "devDependencies", true, "yarn add a@^1.0.0 --dev --exact"],
    ["berry", "optionalDependencies", false, "yarn add a@^1.0.0 --optional"],
    ["bun", "devDependencies", false, "bun add a@^1.0.0 --dev"],
  ] as const)("%s %s exact=%s → %s", ([pm, field, exact, expected]) => {
    expect(display(addCommand(PMS[pm], ["a@^1.0.0"], field, { exact, inWorkspaceRoot: false }))).toBe(expected);
  });

  it("passes every spec in one command", () => {
    expect(addCommand(PMS.pnpm, ["a@1", "b@2"], "dependencies", { exact: false, inWorkspaceRoot: false }).args).toEqual(
      ["add", "a@1", "b@2"],
    );
  });

  it("lets pnpm add to the workspace root", () => {
    expect(display(addCommand(PMS.pnpm, ["a@1"], "dependencies", { exact: false, inWorkspaceRoot: true }))).toBe(
      "pnpm add a@1 --workspace-root",
    );
  });

  it("lets yarn classic add to the workspace root", () => {
    expect(addCommand(PMS.yarn, ["a@1"], "dependencies", { exact: false, inWorkspaceRoot: true }).args).toContain("-W");
  });
});

describe("installCommand and scriptCommand", () => {
  it("runs the manager's own install and run", () => {
    expect(display(installCommand(PMS.bun))).toBe("bun install");
    expect(display(scriptCommand(PMS.yarn, "check"))).toBe("yarn run check");
  });
});

describe("auditCommand", () => {
  it.for([
    ["pnpm", true, "pnpm audit --json --prod"],
    ["pnpm", false, "pnpm audit --json"],
    ["npm", true, "npm audit --json --omit=dev"],
    ["bun", true, "bun audit --json"],
    ["yarn", true, "yarn audit --json --groups dependencies"],
    ["berry", true, "yarn npm audit --json --environment production"],
    ["berry", false, "yarn npm audit --json"],
  ] as const)("%s prod=%s → %s", ([pm, prod, expected]) => {
    expect(display(auditCommand(PMS[pm], prod))).toBe(expected);
  });
});

describe("parseCommandLine edge cases", () => {
  it("returns nothing for blank lines", () => {
    expect(parseCommandLine("   ")).toBeUndefined();
    expect(parseCommandLine("")).toBeUndefined();
  });

  it("keeps empty quoted arguments and quotes inside the other kind", () => {
    expect(parseCommandLine(`node -e "" 'say "hi"'`)).toEqual({ program: "node", args: ["-e", "", 'say "hi"'] });
  });

  it("joins quoted parts that touch unquoted text", () => {
    expect(parseCommandLine('pnpm --filter="@acme/*" test')).toEqual({
      program: "pnpm",
      args: ["--filter=@acme/*", "test"],
    });
  });

  it("keeps Windows paths with backslashes", () => {
    expect(parseCommandLine("node C:\\tools\\run.js")?.args).toEqual(["C:\\tools\\run.js"]);
  });
});

describe("detectChecks and checksFromLines", () => {
  it("finds no checks without scripts", () => {
    expect(detectChecks(PMS.npm, {})).toEqual([]);
  });

  it("uses type-check spelled with a dash", () => {
    expect(detectChecks(PMS.pnpm, { scripts: { "type-check": "tsc" } }).map((c) => c.label)).toEqual(["type-check"]);
  });

  it("turns each non-blank line into a check labelled by the line", () => {
    expect(checksFromLines(["  pnpm tsc  ", "", "pnpm test"])).toEqual([
      { label: "pnpm tsc", command: { program: "pnpm", args: ["tsc"] } },
      { label: "pnpm test", command: { program: "pnpm", args: ["test"] } },
    ]);
  });
});
