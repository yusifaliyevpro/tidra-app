import { describe, expect, it } from "vitest";
import type { Finding } from "@/engine/advisories";
import type { RunResult } from "@/engine/io";
import { fixDirect, fixWithOverride } from "@/modules/security/fix";
import { commitProject, hasUncommittedUpdate } from "@/services/pull-requests";
import { memoryIo, ok } from "../../support/memory-io";
import { testServices } from "../../support/services";

const finding: Finding = {
  id: "GHSA-x",
  aliases: [],
  summary: "s",
  severity: "high",
  name: "undici",
  version: "6.0.0",
  dev: false,
  direct: false,
  fixedIn: "6.21.2",
  url: "u",
};

const CLEAN = ok("# branch.oid a\n# branch.head main\n");

async function project(
  files: Record<string, string>,
  run: (program: string, args: string[]) => RunResult = (p, a) => (p === "git" && a[0] === "status" ? CLEAN : ok()),
) {
  const io = memoryIo(files, { run });
  const { svc, close } = await testServices(io);
  await svc.store.addProject({ id: "p1", name: "app", remote: null, path: "/app" });
  return { io, svc, close };
}

describe("fixWithOverride", () => {
  it("adds a pnpm override to pnpm-workspace.yaml and reinstalls", async () => {
    const { io, svc, close } = await project({
      "/app/package.json": '{ "name": "app" }',
      "/app/pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
      "/app/pnpm-workspace.yaml": "packages:\n  - apps/*\n",
    });
    await fixWithOverride(svc, "p1", finding);
    close();
    expect(io.files.get("/app/pnpm-workspace.yaml")).toBe("packages:\n  - apps/*\noverrides:\n  undici: ^6.21.2\n");
    expect(io.runs.some((r) => r.program === "pnpm" && r.args[0] === "install")).toBe(true);
  });

  it("uses overrides for npm and resolutions for yarn", async () => {
    const npm = await project({ "/app/package.json": '{\n  "name": "app"\n}\n', "/app/package-lock.json": "{}" });
    await fixWithOverride(npm.svc, "p1", finding);
    npm.close();
    expect(JSON.parse(npm.io.files.get("/app/package.json") ?? "{}")).toEqual({
      name: "app",
      overrides: { undici: "^6.21.2" },
    });

    const yarn = await project({ "/app/package.json": '{\n  "name": "app"\n}\n', "/app/yarn.lock": "" });
    await fixWithOverride(yarn.svc, "p1", finding);
    yarn.close();
    expect(JSON.parse(yarn.io.files.get("/app/package.json") ?? "{}")).toEqual({
      name: "app",
      resolutions: { undici: "^6.21.2" },
    });
  });

  it("stops with the installer's error output", async () => {
    const { svc, close } = await project({ "/app/package.json": "{}", "/app/package-lock.json": "{}" }, (program) =>
      program === "npm" ? { code: 1, stdout: "", stderr: "ERESOLVE could not resolve" } : CLEAN,
    );
    await expect(fixWithOverride(svc, "p1", finding)).rejects.toThrow(
      "npm install failed:\nERESOLVE could not resolve",
    );
    close();
  });

  it("needs a known fixed version", async () => {
    const { svc, close } = await project({ "/app/package.json": "{}" });
    await expect(fixWithOverride(svc, "p1", { ...finding, fixedIn: undefined })).rejects.toThrow(
      "No fixed version is known",
    );
    close();
  });

  it("leaves the commit to the user", async () => {
    const { io, svc, close } = await project({ "/app/package.json": "{}", "/app/package-lock.json": "{}" });
    await fixWithOverride(svc, "p1", finding);
    close();
    expect(io.runs.some((r) => r.program === "git" && r.args[0] === "commit")).toBe(false);
  });
});

describe("fixDirect", () => {
  it("explains when no update to the fixed version exists yet", async () => {
    const { svc, close } = await project({ "/app/package.json": '{ "dependencies": { "undici": "^6.0.0" } }' });
    await expect(fixDirect(svc, "p1", { ...finding, direct: true })).rejects.toThrow(
      "No update for undici is available yet.",
    );
    close();
  });
});

describe("fixWithOverride outcomes", () => {
  it("writes pnpm.overrides for pnpm below 10", async () => {
    const { io, svc, close } = await project({
      "/app/package.json": '{ "name": "app", "packageManager": "pnpm@9.15.0" }',
      "/app/pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
    });
    await fixWithOverride(svc, "p1", finding);
    close();
    expect(JSON.parse(io.files.get("/app/package.json") ?? "{}").pnpm).toEqual({ overrides: { undici: "^6.21.2" } });
    expect(io.files.has("/app/pnpm-workspace.yaml")).toBe(false);
  });

  it("asks pnpm for its version when the project doesn't declare one", async () => {
    const { io, svc, close } = await project(
      { "/app/package.json": '{ "name": "app" }', "/app/pnpm-lock.yaml": "lockfileVersion: '9.0'\n" },
      (program, args) => (program === "pnpm" && args[0] === "--version" ? ok("9.1.0\n") : CLEAN),
    );
    await fixWithOverride(svc, "p1", finding);
    close();
    expect(JSON.parse(io.files.get("/app/package.json") ?? "{}").pnpm.overrides).toBeTruthy();
  });

  it("puts the file back when the install fails", async () => {
    const manifest = '{ "name": "app" }';
    const { io, svc, close } = await project(
      { "/app/package.json": manifest, "/app/package-lock.json": "{}" },
      (program) => (program === "npm" ? { code: 1, stdout: "", stderr: "no" } : CLEAN),
    );
    await expect(fixWithOverride(svc, "p1", finding)).rejects.toThrow("npm install failed");
    close();
    expect(io.files.get("/app/package.json")).toBe(manifest);
  });

  it("removes a workspace file it created when the install fails", async () => {
    const { io, svc, close } = await project(
      { "/app/package.json": '{ "packageManager": "pnpm@12.0.0" }', "/app/pnpm-lock.yaml": "lockfileVersion: '9.0'\n" },
      (program) => (program === "pnpm" ? { code: 1, stdout: "", stderr: "no" } : CLEAN),
    );
    await expect(fixWithOverride(svc, "p1", finding)).rejects.toThrow("pnpm install failed");
    close();
    expect(io.runs.map((r) => r.args.join(" "))).toContain("clean -f -- pnpm-workspace.yaml");
  });

  it("gives Commit the fix's message through a recorded run", async () => {
    const { io, svc, close } = await project(
      { "/app/package.json": "{}", "/app/package-lock.json": "{}" },
      (program, args) =>
        program === "git" && args[0] === "status"
          ? ok("# branch.oid a\n# branch.head main\n1 .M N... 100644 100644 100644 a b package.json\n")
          : ok(),
    );
    await fixWithOverride(svc, "p1", finding);
    expect(await hasUncommittedUpdate(svc, "p1")).toBe(true);
    await commitProject(svc, "p1");
    close();
    expect(io.runs.map((r) => r.args.join(" "))).toContain("commit -m fix(deps): override undici to ^6.21.2 (GHSA-x)");
  });
});
