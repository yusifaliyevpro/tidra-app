import { describe, expect, it } from "vitest";
import { applyActionUpdates, currentVersion, nextRef, parseWorkflowUses, refStyle } from "@/engine/actions";

const WORKFLOW = `name: CI
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Setup pnpm
        uses: pnpm/action-setup@v6.0.1
      - uses: "actions/setup-node@v4.1"
      - uses: github/codeql-action/init@a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3 # v3.25.0
      - uses: ./local-action
      - uses: docker://alpine:3
      - uses: some/action@main
`;

describe("parseWorkflowUses", () => {
  const uses = parseWorkflowUses(WORKFLOW);

  it("finds remote actions with their ref style and skips local and docker ones", () => {
    expect(uses.map((u) => [u.action, u.ref, u.style])).toEqual([
      ["actions/checkout", "v4", "major"],
      ["pnpm/action-setup", "v6.0.1", "full"],
      ["actions/setup-node", "v4.1", "minor"],
      ["github/codeql-action/init", "a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3", "sha"],
      ["some/action", "main", "branch"],
    ]);
  });

  it("splits sub-path actions to their repo and reads SHA comments", () => {
    const codeql = uses[3]!;
    expect(codeql.repo).toBe("github/codeql-action");
    expect(currentVersion(codeql)).toBe("3.25.0");
    expect(refStyle("1.2.3")).toBe("full");
  });
});

describe("nextRef", () => {
  const [checkout, setup, node, codeql, branch] = parseWorkflowUses(WORKFLOW);

  it("keeps each ref style", () => {
    expect(nextRef(checkout!, "v5.0.0")).toEqual({ ref: "v5" });
    expect(nextRef(setup!, "v6.1.0")).toEqual({ ref: "v6.1.0" });
    expect(nextRef(node!, "v4.4.0")).toEqual({ ref: "v4.4" });
    expect(nextRef(codeql!, "v3.29.1", "f".repeat(40))).toEqual({ ref: "f".repeat(40), comment: "v3.29.1" });
  });

  it("returns nothing when already current or not comparable", () => {
    expect(nextRef(checkout!, "v4.2.2")).toBeUndefined();
    expect(nextRef(codeql!, "v3.29.1")).toBeUndefined();
    expect(nextRef(branch!, "v9.0.0")).toBeUndefined();
  });
});

describe("applyActionUpdates", () => {
  it("rewrites only the targeted refs and keeps quotes and comments", () => {
    const uses = parseWorkflowUses(WORKFLOW);
    const next = applyActionUpdates(WORKFLOW, [
      { line: uses[0]!.line, ref: "v5" },
      { line: uses[2]!.line, ref: "v4.4" },
      { line: uses[3]!.line, ref: "f".repeat(40), comment: "v3.29.1" },
    ]);
    expect(next).toContain("      - uses: actions/checkout@v5\n");
    expect(next).toContain('      - uses: "actions/setup-node@v4.4"\n');
    expect(next).toContain(`uses: github/codeql-action/init@${"f".repeat(40)} # v3.29.1\n`);
    expect(next.split("\n").length).toBe(WORKFLOW.split("\n").length);
    expect(next).toContain("uses: pnpm/action-setup@v6.0.1");
  });

  it("keeps CRLF line endings", () => {
    const crlf = WORKFLOW.replaceAll("\n", "\r\n");
    expect(applyActionUpdates(crlf, [{ line: 6, ref: "v5" }])).toContain("actions/checkout@v5\r\n");
  });
});

describe("actions edge cases", () => {
  it.for([
    ["v4", "major"],
    ["4", "major"],
    ["v4.1", "minor"],
    ["v4.1.2", "full"],
    ["4.1.2-beta.1", "full"],
    ["main", "branch"],
    ["release/v1", "branch"],
    ["a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3", "sha"],
    ["a4b5c6d", "branch"],
  ])("%s is a %s ref", ([ref, style]) => {
    expect(refStyle(ref ?? "")).toBe(style);
  });

  it("reads reusable workflows and single-quoted uses", () => {
    const uses = parseWorkflowUses("    uses: 'org/shared/.github/workflows/ci.yml@v2'\n");
    expect(uses).toMatchObject([
      { line: 0, action: "org/shared/.github/workflows/ci.yml", repo: "org/shared", ref: "v2" },
    ]);
  });

  it("ignores lines that only mention uses in a comment or a run script", () => {
    expect(parseWorkflowUses("# uses: actions/checkout@v4\n  run: echo uses: a/b@v1\n")).toEqual([]);
  });

  it("has no current version for branch refs or SHA pins without a comment", () => {
    expect(currentVersion({ line: 0, action: "a/b", repo: "a/b", ref: "main", style: "branch" })).toBeUndefined();
    expect(currentVersion({ line: 0, action: "a/b", repo: "a/b", ref: "a".repeat(40), style: "sha" })).toBeUndefined();
  });

  it("writes a new major without the v when the old ref had none", () => {
    const [use] = parseWorkflowUses("- uses: a/b@4\n");
    expect(use && nextRef(use, "v5.2.0")).toEqual({ ref: "5" });
  });

  it("moves a SHA pin only when it knows the new SHA", () => {
    const [use] = parseWorkflowUses(`- uses: a/b@${"a".repeat(40)} # v1.0.0\n`);
    expect(use && nextRef(use, "v1.1.0")).toBeUndefined();
    expect(use && nextRef(use, "v1.1.0", "b".repeat(40))).toEqual({ ref: "b".repeat(40), comment: "v1.1.0" });
  });

  it("skips update lines that no longer hold a uses", () => {
    const text = "steps:\n  - run: echo\n";
    expect(
      applyActionUpdates(text, [
        { line: 1, ref: "v5" },
        { line: 9, ref: "v5" },
      ]),
    ).toBe(text);
  });
});
