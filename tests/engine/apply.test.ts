import { describe, expect, it } from "vitest";
import {
  commitMessage,
  planAddCommands,
  planFileChanges,
  revertUpdate,
  runUpdate,
  type Selection,
} from "@/engine/apply";
import type { OutdatedEntry } from "@/engine/outdated";
import { scriptCommand } from "@/engine/pm";
import { loadWorkspace } from "@/engine/workspace";
import { memoryIo, ok } from "../support/memory-io";

const ROOT_PKG =
  '{\n  "name": "app",\n  "dependencies": {\n    "react": "^18.3.1"\n  },\n  "devDependencies": {\n    "vite": "8.3.4"\n  }\n}\n';

function entry(partial: Partial<OutdatedEntry> & Pick<OutdatedEntry, "name" | "usages" | "range">): OutdatedEntry {
  return { latest: "0.0.0", bump: "major", heldBackByAge: false, currentFromLockfile: true, ...partial };
}

const react: Selection = {
  entry: entry({
    name: "react",
    range: "^18.3.1",
    current: "18.3.1",
    usages: [{ importer: ".", field: "dependencies", spec: "^18.3.1" }],
  }),
  version: "19.3.1",
};
const vite: Selection = {
  entry: entry({
    name: "vite",
    range: "8.3.4",
    current: "8.3.4",
    usages: [{ importer: ".", field: "devDependencies", spec: "8.3.4" }],
  }),
  version: "8.3.5",
};

const CLEAN = "# branch.oid a\n# branch.head main\n";

function gitRunner(statusOutput = CLEAN, failOn?: string) {
  return (program: string, args: string[]) => {
    if (failOn && [program, ...args].join(" ").includes(failOn)) return { code: 1, stdout: "", stderr: "boom" };
    if (program === "git" && args[0] === "status") return ok(statusOutput);
    if (program === "git" && args[0] === "rev-parse") return ok("abc123\n");
    return ok();
  };
}

describe("planFileChanges", () => {
  it("rewrites manifests in place with each dependency's own style", async () => {
    const ws = await loadWorkspace(memoryIo({ "/r/package.json": ROOT_PKG }), "/r");
    const [change] = planFileChanges(ws, [react, vite]);
    expect(change?.after).toBe(ROOT_PKG.replace("^18.3.1", "^19.3.1").replace("8.3.4", "8.3.5"));
  });

  it("edits the catalog instead of manifests for catalog dependencies", async () => {
    const ws = await loadWorkspace(
      memoryIo({
        "/r/package.json": '{"dependencies":{"zod":"catalog:"}}',
        "/r/pnpm-workspace.yaml": "catalog:\n  zod: ^4.6.0\n",
      }),
      "/r",
    );
    const zod: Selection = {
      entry: entry({
        name: "zod",
        range: "^4.6.0",
        catalog: "default",
        usages: [{ importer: ".", field: "dependencies", spec: "catalog:" }],
      }),
      version: "4.6.7",
    };
    expect(planFileChanges(ws, [zod])).toEqual([
      { path: "/r/pnpm-workspace.yaml", before: "catalog:\n  zod: ^4.6.0\n", after: "catalog:\n  zod: ^4.6.7\n" },
    ]);
  });

  it("never rewrites peer ranges", async () => {
    const ws = await loadWorkspace(memoryIo({ "/r/package.json": '{"peerDependencies":{"react":"^18.0.0"}}' }), "/r");
    const peer: Selection = {
      entry: entry({
        name: "react",
        range: "^18.0.0",
        usages: [{ importer: ".", field: "peerDependencies", spec: "^18.0.0" }],
      }),
      version: "19.0.0",
    };
    expect(planFileChanges(ws, [peer])).toEqual([]);
  });
});

const tiptap = (name: string): Selection => ({
  entry: entry({ name, range: "3.32.0", usages: [{ importer: ".", field: "dependencies", spec: "3.32.0" }] }),
  version: "3.32.2",
});

describe("planAddCommands", () => {
  it("lets the package manager write each field, keeping range style and exact pins", async () => {
    const ws = await loadWorkspace(memoryIo({ "/r/package.json": ROOT_PKG, "/r/pnpm-lock.yaml": "" }), "/r");
    expect(planAddCommands(ws, [react, vite])).toEqual([
      { importer: ".", command: { program: "pnpm", args: ["add", "react@^19.3.1"] } },
      { importer: ".", command: { program: "pnpm", args: ["add", "vite@8.3.5", "--save-dev", "--save-exact"] } },
    ]);
  });

  it("adds every package of a family that shares one version, not the first one each time", async () => {
    const pkg =
      '{"dependencies":{"@tiptap/core":"3.32.0","@tiptap/extension-image":"3.32.0","@tiptap/extension-link":"3.32.0"}}';
    const ws = await loadWorkspace(memoryIo({ "/r/package.json": pkg, "/r/pnpm-lock.yaml": "" }), "/r");
    const [add] = planAddCommands(
      ws,
      ["@tiptap/core", "@tiptap/extension-image", "@tiptap/extension-link"].map(tiptap),
    );
    expect(add?.command.args).toEqual([
      "add",
      "@tiptap/core@3.32.2",
      "@tiptap/extension-image@3.32.2",
      "@tiptap/extension-link@3.32.2",
      "--save-exact",
    ]);
  });

  it("adds to the workspace root with -w and to packages in their own folder", async () => {
    const ws = await loadWorkspace(
      memoryIo({
        "/r/package.json": '{"devDependencies":{"vite":"8.3.4"}}',
        "/r/pnpm-workspace.yaml": "packages:\n  - apps/*\n",
        "/r/apps/web/package.json": '{"name":"web","dependencies":{"react":"^18.3.1"}}',
      }),
      "/r",
    );
    const webReact: Selection = {
      ...react,
      entry: { ...react.entry, usages: [{ importer: "apps/web", field: "dependencies", spec: "^18.3.1" }] },
    };
    expect(planAddCommands(ws, [vite, webReact])).toEqual([
      {
        importer: ".",
        command: { program: "pnpm", args: ["add", "vite@8.3.5", "--save-dev", "--save-exact", "--workspace-root"] },
      },
      { importer: "apps/web", command: { program: "pnpm", args: ["add", "react@^19.3.1"] } },
    ]);
  });

  it("uses each manager's own flags", async () => {
    const ws = await loadWorkspace(memoryIo({ "/r/package.json": ROOT_PKG, "/r/package-lock.json": "{}" }), "/r");
    expect(planAddCommands(ws, [vite]).map((a) => a.command.args)).toEqual([
      ["install", "vite@8.3.5", "--save-dev", "--save-exact"],
    ]);
  });
});

describe("commitMessage", () => {
  it("uses one line for one package and a list for several", () => {
    expect(commitMessage([react])).toBe("chore(deps): bump react 18.3.1 → 19.3.1");
    expect(commitMessage([react, vite])).toBe(
      "chore(deps): bump 2 dependencies\n\n- react 18.3.1 → 19.3.1\n- vite 8.3.4 → 8.3.5",
    );
  });
});

describe("runUpdate", () => {
  it("branches, adds through the package manager, checks and commits in order, never pushing", async () => {
    const io = memoryIo(
      { "/r/package.json": ROOT_PKG, "/r/pnpm-lock.yaml": "lockfileVersion: '9.0'\n" },
      { run: gitRunner() },
    );
    const ws = await loadWorkspace(io, "/r");
    const steps: string[] = [];
    const result = await runUpdate(io, ws, [react], {
      branch: "tidra/deps-2026-10-31",
      checks: [{ label: "check", command: scriptCommand(ws.pm, "check") }],
      commit: true,
      onStep: (step, state) => steps.push(`${step}:${state}`),
    });

    expect(result).toMatchObject({
      ok: true,
      createdBranch: "tidra/deps-2026-10-31",
      previousBranch: "main",
      commitSha: "abc123",
    });
    expect(result.touched).toEqual(["package.json", "pnpm-lock.yaml"]);
    expect(io.runs.map((r) => [r.program, ...r.args].join(" "))).toEqual([
      "git status --porcelain=v2 --branch",
      "git switch -c tidra/deps-2026-10-31",
      "pnpm add react@^19.3.1",
      "pnpm run check",
      "git add -- package.json pnpm-lock.yaml",
      "git commit -m chore(deps): bump react 18.3.1 → 19.3.1",
      "git rev-parse HEAD",
    ]);
    expect(steps.filter((s) => s.endsWith(":done"))).toHaveLength(5);
    expect(steps).toContain("write:skipped");
  });

  it("refuses a dirty tree unless stashing is allowed", async () => {
    const dirty = `${CLEAN}1 .M N... 100644 100644 100644 a b src/a.ts\n`;
    const io = memoryIo({ "/r/package.json": ROOT_PKG }, { run: gitRunner(dirty) });
    const ws = await loadWorkspace(io, "/r");
    const refused = await runUpdate(io, ws, [react], { checks: [], commit: false });
    expect(refused).toMatchObject({ ok: false, failedStep: "preflight" });
    expect(io.files.get("/r/package.json")).toBe(ROOT_PKG);

    const stashed = await runUpdate(io, ws, [react], { checks: [], commit: false, stash: true });
    expect(stashed.ok).toBe(true);
    expect(io.runs.some((r) => r.args[0] === "stash")).toBe(true);
  });

  it("stops at a failing check and keeps what was written for review", async () => {
    const io = memoryIo({ "/r/package.json": ROOT_PKG }, { run: gitRunner(CLEAN, "run check") });
    const ws = await loadWorkspace(io, "/r");
    const result = await runUpdate(io, ws, [react], {
      checks: [{ label: "check", command: scriptCommand(ws.pm, "check") }],
      commit: true,
    });
    expect(result).toMatchObject({ ok: false, failedStep: "checks" });
    expect(result.error).toContain("npm run check exited with 1");
    expect(io.runs.some((r) => r.args[0] === "commit")).toBe(false);
  });

  it("reverts files and the created branch, then reinstalls", async () => {
    const io = memoryIo({ "/r/package.json": ROOT_PKG }, { run: gitRunner() });
    const ws = await loadWorkspace(io, "/r");
    io.runs.length = 0;
    await revertUpdate(io, ws, {
      ok: false,
      changes: [],
      touched: ["package.json"],
      createdBranch: "tidra/x",
      previousBranch: "main",
    });
    expect(io.runs.map((r) => [r.program, ...r.args].join(" "))).toEqual([
      "git checkout -- package.json",
      "git switch main",
      "git branch -D tidra/x",
      "npm install",
    ]);
  });
});
