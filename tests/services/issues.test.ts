import { describe, expect, it } from "vitest";
import type { RunResult } from "@/engine/io";
import { createIssue, ghState, issueBody, TIDRA_REPO, type IssueDraft } from "@/services/issues";
import { memoryIo, ok } from "../support/memory-io";

const ENV = { version: "1.0.2", platform: "windows" };
const SHOT = { name: "screenshot-1.png", dataUrl: "data:image/png;base64,iVBORw0KGgo=" };
const URL = `https://github.com/${TIDRA_REPO}/issues/7`;
const draft = (over: Partial<IssueDraft> = {}): IssueDraft => ({
  title: "Revert keeps pnpm-workspace.yaml",
  body: "Steps\n\n![screenshot-1](screenshot-1.png)\n",
  kind: "bug",
  screenshots: [SHOT],
  ...over,
});
const fail: RunResult = { code: 1, stdout: "", stderr: "nope" };

function ghFake(options: { labelFails?: boolean; uploadFails?: boolean } = {}) {
  return (_program: string, args: string[]): RunResult => {
    if (args[0] !== "issue") return ok();
    if (options.labelFails && args.includes("--label")) return fail;
    if (options.uploadFails) return { code: 1, stdout: `${URL}\n`, stderr: "upload failed" };
    return ok(`${URL}\n`);
  };
}

const signedIn = (help: string) => (_p: string, args: string[]) =>
  args[0] === "--version" ? ok("gh version 2.103.3 (2026-10-26)\n") : ok(args[0] === "api" ? "yusif\n" : help);

describe("ghState", () => {
  it("tells a missing CLI from a signed-out one", async () => {
    expect(await ghState(memoryIo({}, { run: () => fail }))).toEqual({ state: "missing" });
    expect(
      await ghState(memoryIo({}, { run: (_p, args) => (args[0] === "--version" ? ok("gh version 2.80.0") : fail) })),
    ).toEqual({ state: "signed-out" });
  });

  it("knows whether this gh can attach screenshots", async () => {
    expect(await ghState(memoryIo({}, { run: signedIn("--attach file  Attach an image") }))).toEqual({
      state: "ready",
      user: "yusif",
      version: "2.103.3",
      attach: true,
    });
    expect(await ghState(memoryIo({}, { run: signedIn("--body string") }))).toMatchObject({ attach: false });
  });
});

describe("issueBody", () => {
  it("points screenshots at the attached files and ends with the type and environment", () => {
    expect(issueBody(draft(), ENV, true)).toBe(
      "Steps\n\n![screenshot-1](./screenshot-1.png)\n\n---\n**Type:** Bug · **Tidra** 1.0.2 · windows\n",
    );
  });

  it("drops screenshot references when they can't be attached", () => {
    expect(issueBody(draft(), ENV, false)).not.toContain("screenshot-1.png");
  });
});

describe("createIssue", () => {
  it("attaches screenshots with gh and files a labeled issue", async () => {
    const io = memoryIo({}, { run: ghFake(), env: { TEMP: "C:\\Temp" } });
    const result = await createIssue(io, draft(), ENV, { attach: true });
    expect(result).toEqual({ url: URL, screenshotsLeft: false });
    const create = io.runs.find((r) => r.args[0] === "issue")?.args ?? [];
    expect(create).toEqual(expect.arrayContaining(["--attach", "C:/Temp/tidra-issue/screenshot-1.png#screenshot-1"]));
    expect(create).toEqual(expect.arrayContaining(["--label", "bug", "-R", TIDRA_REPO]));
    expect(io.files.get("C:/Temp/tidra-issue/screenshot-1.png")).toBe("[8 bytes]");
  });

  it("files without screenshots on an older gh, and says they're left", async () => {
    const io = memoryIo({}, { run: ghFake() });
    expect((await createIssue(io, draft(), ENV, { attach: false })).screenshotsLeft).toBe(true);
    expect(io.runs.some((r) => r.args.includes("--attach"))).toBe(false);
  });

  it("keeps the issue when an upload fails, and says screenshots are left", async () => {
    const io = memoryIo({}, { run: ghFake({ uploadFails: true }) });
    expect(await createIssue(io, draft(), ENV, { attach: true })).toEqual({ url: URL, screenshotsLeft: true });
    expect(io.runs.filter((r) => r.args[0] === "issue")).toHaveLength(1);
  });

  it("retries without the label when the repo doesn't have it", async () => {
    const io = memoryIo({}, { run: ghFake({ labelFails: true }) });
    const { url } = await createIssue(io, draft({ kind: "regression", screenshots: [] }), ENV, { attach: true });
    expect(url).toBe(URL);
    expect(io.runs.filter((r) => r.args[0] === "issue")).toHaveLength(2);
  });

  it("needs a title", async () => {
    await expect(createIssue(memoryIo(), draft({ title: " " }), ENV, { attach: true })).rejects.toThrow("title");
  });
});
