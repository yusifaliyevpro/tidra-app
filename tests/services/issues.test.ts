import { describe, expect, it } from "vitest";
import type { RunResult } from "@/engine/io";
import { createIssue, ghState, issueBody, TIDRA_REPO, type IssueDraft } from "@/services/issues";
import { memoryIo, ok } from "../support/memory-io";

const ENV = { version: "1.0.1", platform: "windows" };
const SHOT = { name: "screenshot-1.png", dataUrl: "data:image/png;base64,iVBORw0KGgo=" };
const draft = (over: Partial<IssueDraft> = {}): IssueDraft => ({
  title: "Revert keeps pnpm-workspace.yaml",
  body: "Steps\n\n![screenshot-1](screenshot-1.png)\n",
  kind: "bug",
  screenshots: [SHOT],
  ...over,
});
const fail: RunResult = { code: 1, stdout: "", stderr: "nope" };

function ghFake(options: { push: boolean; labelFails?: boolean }) {
  return (_program: string, args: string[]): RunResult => {
    const line = args.join(" ");
    if (line.endsWith("--jq .permissions.push")) return ok(`${options.push}\n`);
    if (line.includes("/branches/issue-assets")) return ok("issue-assets\n");
    if (line.startsWith("issue create")) {
      if (options.labelFails && args.includes("--label")) return fail;
      return ok(`https://github.com/${TIDRA_REPO}/issues/7\n`);
    }
    return ok();
  };
}

describe("ghState", () => {
  it("tells a missing CLI from a signed-out one", async () => {
    expect(await ghState(memoryIo({}, { run: () => fail }))).toEqual({ state: "missing" });
    expect(
      await ghState(memoryIo({}, { run: (_p, args) => (args[0] === "--version" ? ok("gh version 2.80.0") : fail) })),
    ).toEqual({ state: "signed-out" });
    expect(await ghState(memoryIo({}, { run: (_p, args) => ok(args[0] === "api" ? "yusif\n" : "gh") }))).toEqual({
      state: "ready",
      user: "yusif",
    });
  });
});

describe("issueBody", () => {
  it("points screenshots at their uploads and ends with the type and environment", () => {
    const body = issueBody(draft(), ENV, new Map([["screenshot-1.png", "https://x/1.png"]]));
    expect(body).toBe("Steps\n\n![screenshot-1](https://x/1.png)\n\n---\n**Type:** Bug · **Tidra** 1.0.1 · windows\n");
  });

  it("drops references to screenshots that weren't uploaded", () => {
    expect(issueBody(draft(), ENV, new Map())).not.toContain("screenshot-1.png");
  });
});

describe("createIssue", () => {
  it("uploads screenshots to the asset branch and files a labeled issue", async () => {
    const io = memoryIo({}, { run: ghFake({ push: true }) });
    const result = await createIssue(io, draft(), ENV);
    expect(result).toEqual({ url: `https://github.com/${TIDRA_REPO}/issues/7`, screenshotsLeft: false });
    const lines = io.runs.map((r) => r.args.join(" "));
    expect(lines.some((l) => l.startsWith(`api -X PUT repos/${TIDRA_REPO}/contents/issues/`))).toBe(true);
    expect(lines.find((l) => l.startsWith("issue create"))).toContain("--label bug");
    expect([...io.files.values()].some((text) => text.includes("blob/issue-assets/issues/"))).toBe(true);
  });

  it("files the issue without screenshots when the user can't push, and says they're left", async () => {
    const io = memoryIo({}, { run: ghFake({ push: false }) });
    expect((await createIssue(io, draft(), ENV)).screenshotsLeft).toBe(true);
    expect(io.runs.some((r) => r.args.includes("PUT"))).toBe(false);
  });

  it("retries without the label when the repo doesn't have it", async () => {
    const io = memoryIo({}, { run: ghFake({ push: true, labelFails: true }) });
    const { url } = await createIssue(io, draft({ kind: "regression", screenshots: [] }), ENV);
    expect(url).toContain("/issues/7");
    expect(io.runs.filter((r) => r.args[0] === "issue")).toHaveLength(2);
  });

  it("needs a title", async () => {
    await expect(createIssue(memoryIo(), draft({ title: " " }), ENV)).rejects.toThrow("title");
  });
});
