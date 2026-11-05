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
  it("branches, adds through the package manager and checks, leaving the commit to the user", async () => {
    const io = memoryIo(
      { "/r/package.json": ROOT_PKG, "/r/pnpm-lock.yaml": "lockfileVersion: '9.0'\n" },
      { run: gitRunner() },
    );
    const ws = await loadWorkspace(io, "/r");
    const steps: string[] = [];
    const result = await runUpdate(io, ws, [react], {
      branch: "tidra/deps-2026-10-31",
      checks: [{ label: "check", command: scriptCommand(ws.pm, "check") }],
      onStep: (step, state) => steps.push(`${step}:${state}`),
    });

    expect(result).toMatchObject({
      ok: true,
      createdBranch: "tidra/deps-2026-10-31",
      previousBranch: "main",
    });
    expect(result.touched).toEqual(["package.json", "pnpm-lock.yaml"]);
    expect(io.runs.map((r) => [r.program, ...r.args].join(" "))).toEqual([
      "git status --porcelain=v2 --branch",
      "git switch -c tidra/deps-2026-10-31",
      "pnpm add react@^19.3.1",
      "pnpm run check",
    ]);
    expect(steps.filter((s) => s.endsWith(":done"))).toHaveLength(4);
    expect(steps).toContain("write:skipped");
  });

  it("refuses a dirty tree", async () => {
    const dirty = `${CLEAN}1 .M N... 100644 100644 100644 a b src/a.ts\n`;
    const io = memoryIo({ "/r/package.json": ROOT_PKG }, { run: gitRunner(dirty) });
    const ws = await loadWorkspace(io, "/r");
    const refused = await runUpdate(io, ws, [react], { checks: [] });
    expect(refused).toMatchObject({ ok: false, failedStep: "preflight" });
    expect(io.files.get("/r/package.json")).toBe(ROOT_PKG);
  });

  it("stops at a failing check and keeps what was written for review", async () => {
    const io = memoryIo({ "/r/package.json": ROOT_PKG }, { run: gitRunner(CLEAN, "run check") });
    const ws = await loadWorkspace(io, "/r");
    const result = await runUpdate(io, ws, [react], {
      checks: [{ label: "check", command: scriptCommand(ws.pm, "check") }],
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

describe("runUpdate edge cases", () => {
  it("refuses when the selection is already written", async () => {
    const io = memoryIo({ "/r/package.json": ROOT_PKG }, { run: gitRunner() });
    const ws = await loadWorkspace(io, "/r");
    const result = await runUpdate(io, ws, [{ ...react, version: "18.3.1" }], { checks: [] });
    expect(result).toMatchObject({ ok: false, failedStep: "preflight" });
    expect(result.error).toContain("Nothing to update");
    expect(io.runs.some((r) => r.program === "pnpm" || r.program === "npm")).toBe(false);
  });

  it("stops at a failing install, never runs the checks, and reports the command", async () => {
    const io = memoryIo({ "/r/package.json": ROOT_PKG }, { run: gitRunner(CLEAN, "npm install react") });
    const ws = await loadWorkspace(io, "/r");
    const result = await runUpdate(io, ws, [react], {
      checks: [{ label: "check", command: scriptCommand(ws.pm, "check") }],
    });
    expect(result).toMatchObject({ ok: false, failedStep: "install" });
    expect(result.error).toBe("npm install react@^19.3.1 --save exited with 1");
    expect(io.runs.some((r) => r.args.includes("check"))).toBe(false);
  });

  it("stays on the current branch when no branch is asked for", async () => {
    const io = memoryIo({ "/r/package.json": ROOT_PKG }, { run: gitRunner() });
    const ws = await loadWorkspace(io, "/r");
    const steps: string[] = [];
    const result = await runUpdate(io, ws, [react], { checks: [], onStep: (s, state) => steps.push(`${s}:${state}`) });
    expect(result).toMatchObject({ ok: true, previousBranch: "main" });
    expect(result.createdBranch).toBeUndefined();
    expect(steps).toEqual(expect.arrayContaining(["branch:skipped", "checks:skipped"]));
    expect(io.runs.some((r) => r.args[0] === "switch")).toBe(false);
  });

  it("writes catalog changes itself, then installs once", async () => {
    const io = memoryIo(
      {
        "/r/package.json": '{ "name": "r", "dependencies": { "zod": "catalog:" } }',
        "/r/pnpm-workspace.yaml": "catalog:\n  zod: ^4.0.0\n",
        "/r/pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
      },
      { run: gitRunner() },
    );
    const ws = await loadWorkspace(io, "/r");
    const zod: Selection = {
      entry: entry({
        name: "zod",
        range: "^4.0.0",
        catalog: "default",
        usages: [{ importer: ".", field: "dependencies", spec: "catalog:" }],
      }),
      version: "4.6.7",
    };
    const result = await runUpdate(io, ws, [zod], { checks: [] });
    expect(result.ok).toBe(true);
    expect(io.files.get("/r/pnpm-workspace.yaml")).toBe("catalog:\n  zod: ^4.6.7\n");
    expect(io.runs.filter((r) => r.program === "pnpm").map((r) => r.args.join(" "))).toEqual(["install"]);
    expect(result.touched).toEqual(["pnpm-workspace.yaml", "pnpm-lock.yaml"]);
  });

  it("streams a `$ command` line before each command's output", async () => {
    const io = memoryIo({ "/r/package.json": ROOT_PKG }, { run: gitRunner() });
    const ws = await loadWorkspace(io, "/r");
    const output: string[] = [];
    await runUpdate(io, ws, [react], { checks: [], onOutput: (chunk) => output.push(chunk) });
    expect(output).toEqual(["$ npm install react@^19.3.1 --save\n"]);
  });

  it("lists the lockfile as touched even when a later install fails", async () => {
    const io = memoryIo(
      {
        "/r/package.json": '{ "name": "r", "workspaces": ["a"], "dependencies": { "react": "^18.3.1" } }',
        "/r/a/package.json": '{ "name": "a", "dependencies": { "vite": "8.3.4" } }',
        "/r/pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
        "/r/pnpm-workspace.yaml": "packages:\n  - a\n",
      },
      { run: gitRunner(CLEAN, "add vite") },
    );
    const ws = await loadWorkspace(io, "/r");
    const viteInA: Selection = {
      entry: entry({ name: "vite", range: "8.3.4", usages: [{ importer: "a", field: "dependencies", spec: "8.3.4" }] }),
      version: "8.3.5",
    };
    const result = await runUpdate(io, ws, [react, viteInA], { checks: [] });
    expect(result.failedStep).toBe("install");
    expect(result.touched).toContain("pnpm-lock.yaml");
  });
});

describe("revertUpdate edge cases", () => {
  it("only reinstalls when nothing was touched and no branch was created", async () => {
    const io = memoryIo({ "/r/package.json": ROOT_PKG }, { run: gitRunner() });
    const ws = await loadWorkspace(io, "/r");
    io.runs.length = 0;
    await revertUpdate(io, ws, { ok: false, changes: [], touched: [] });
    expect(io.runs.map((r) => [r.program, ...r.args].join(" "))).toEqual(["npm install"]);
  });

  it("still restores tracked files and switches back when a touched file is untracked", async () => {
    const io = memoryIo(
      { "/r/package.json": ROOT_PKG },
      {
        run: (program, args) =>
          program === "git" && args[0] === "checkout" && args.includes("package-lock.json")
            ? {
                code: 1,
                stdout: "",
                stderr: "error: pathspec 'package-lock.json' did not match any file(s) known to git",
              }
            : ok(),
      },
    );
    const ws = await loadWorkspace(io, "/r");
    io.runs.length = 0;
    await revertUpdate(io, ws, {
      ok: false,
      changes: [],
      touched: ["package.json", "package-lock.json"],
      createdBranch: "tidra/x",
      previousBranch: "main",
    });
    const lines = io.runs.map((r) => [r.program, ...r.args].join(" "));
    expect(lines).toContain("git checkout -- package.json");
    expect(lines).toContain("git switch main");
  });
});

describe("planAddCommands in a workspace root", () => {
  it("tells yarn classic it may add to the root of a workspace", async () => {
    const io = memoryIo({
      "/r/package.json": '{ "name": "r", "workspaces": ["a"], "dependencies": { "react": "^18.3.1" } }',
      "/r/a/package.json": '{ "name": "a" }',
      "/r/yarn.lock": "",
    });
    const ws = await loadWorkspace(io, "/r");
    expect(planAddCommands(ws, [react])[0]?.command.args).toContain("-W");
  });

  it("doesn't for a single-package repo", async () => {
    const io = memoryIo({
      "/r/package.json": '{ "name": "r", "dependencies": { "react": "^18.3.1" } }',
      "/r/yarn.lock": "",
    });
    const ws = await loadWorkspace(io, "/r");
    expect(planAddCommands(ws, [react])[0]?.command.args).not.toContain("-W");
  });
});
