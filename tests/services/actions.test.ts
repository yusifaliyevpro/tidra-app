import { describe, expect, it, vi } from "vitest";
import {
  actionsUpdatePrompt,
  applyActionUpdatesToRepo,
  readActions,
  scanActions,
  setToolVersion,
  type ActionItem,
} from "@/services/actions";
import { switchBranch } from "@/services/repos";
import { jsonResponse, memoryIo, ok } from "../support/memory-io";
import { testServices } from "../support/services";

const item = (patch: Partial<ActionItem>): ActionItem => ({
  line: 9,
  action: "actions/checkout",
  repo: "actions/checkout",
  ref: "v4",
  style: "major",
  file: ".github/workflows/ci.yml",
  current: "v4",
  latestTag: "v5.0.0",
  next: { ref: "v5" },
  ...patch,
});

describe("actionsUpdatePrompt", () => {
  it("lists each outdated action once with every place it is used and its release notes", () => {
    const prompt = actionsUpdatePrompt({ label: "web", github: "me/web", root: "C:/code/web" }, [
      item({}),
      item({ file: ".github/workflows/release.yml", line: 3 }),
      item({ action: "pnpm/action-setup", repo: "pnpm/action-setup", next: undefined }),
    ]);
    expect(prompt).toContain("Update the outdated GitHub Actions in me/web (C:/code/web):");
    expect(prompt).toContain(
      "- actions/checkout: v4 → v5.0.0 (.github/workflows/ci.yml:10, .github/workflows/release.yml:4). Release notes: https://github.com/actions/checkout/releases",
    );
    expect(prompt).not.toContain("pnpm/action-setup");
  });
});

async function withRepo(branch: string) {
  const io = memoryIo(
    {
      "/code/web/package.json": JSON.stringify({ name: "web" }),
      "/code/web/.github/workflows/ci.yml": "jobs:\n  ci:\n    steps:\n      - uses: actions/checkout@v4\n",
    },
    {
      run: (program, args) => {
        if (program !== "git") return ok();
        if (args[0] === "status") return ok(`# branch.head ${branch}\n`);
        if (args.join(" ") === "symbolic-ref --short refs/remotes/origin/HEAD") return ok("origin/main\n");
        return ok();
      },
    },
  );
  const { svc, close } = await testServices(io);
  await svc.store.addProject({ id: "p1", name: "web", remote: "github.com/me/web", path: "/code/web" });
  return { io, svc, close };
}

describe("applyActionUpdatesToRepo", () => {
  it("commits on a new Actions branch cut from the default branch, never on the current one", async () => {
    const { io, svc, close } = await withRepo("feature/login");
    const { branch, message } = await applyActionUpdatesToRepo(svc, "github.com/me/web", [item({ line: 3 })]);
    close();
    expect(branch).toMatch(/^tidra\/actions-\d{8}-\d{4}$/);
    expect(message).toBe("ci: bump actions/checkout to v5.0.0");
    const lines = io.runs.map((r) => r.args.join(" "));
    expect(lines).toContain(`switch --no-track -c ${branch} origin/main`);
    expect(lines.some((l) => l.startsWith("commit -m ci: bump actions/checkout"))).toBe(true);
    expect(io.files.get("/code/web/.github/workflows/ci.yml")).toContain("actions/checkout@v5");
  });

  it("keeps adding to the Actions branch that is already checked out", async () => {
    const { io, svc, close } = await withRepo("tidra/actions-20261101-1200");
    const { branch } = await applyActionUpdatesToRepo(svc, "github.com/me/web", [item({ line: 3 })]);
    close();
    expect(branch).toBe("tidra/actions-20261101-1200");
    expect(io.runs.some((r) => r.args[0] === "switch")).toBe(false);
  });
});

async function withWorkflow(text: string) {
  const setup = await withRepo("feature/login");
  setup.io.files.set("/code/web/.github/workflows/ci.yml", text);
  return setup;
}

describe("setToolVersion", () => {
  const CI =
    "jobs:\n  ci:\n    steps:\n      - uses: actions/setup-node@v7\n        with:\n          node-version: 24\n";
  const node = { line: 5, name: "node-version", tool: "Node.js", value: "24" };
  const step = { file: ".github/workflows/ci.yml", action: "actions/setup-node" };

  it("writes the new version and commits it on the current branch", async () => {
    const { io, svc, close } = await withWorkflow(CI);
    const { branch, message } = await setToolVersion(svc, "github.com/me/web", step, node, " 22 ");
    close();
    expect(message).toBe("ci: use Node.js 22");
    expect(branch).toBe("feature/login");
    expect(io.files.get("/code/web/.github/workflows/ci.yml")).toContain("          node-version: 22\n");
    const lines = io.runs.map((r) => r.args.join(" "));
    expect(lines.some((l) => l.startsWith("switch"))).toBe(false);
    expect(lines).toContain("commit -m ci: use Node.js 22 -- .github/workflows/ci.yml");
  });

  it("refuses an empty or unchanged version before touching git", async () => {
    const { io, svc, close } = await withWorkflow(CI);
    await expect(setToolVersion(svc, "github.com/me/web", step, node, "  ")).rejects.toThrow(
      "Enter a Node.js version.",
    );
    await expect(setToolVersion(svc, "github.com/me/web", step, node, "24")).rejects.toThrow("already 24");
    close();
    expect(io.runs).toEqual([]);
  });

  it("changes nothing when the workflow no longer sets that version", async () => {
    const { io, svc, close } = await withWorkflow(CI.replace("24", "20"));
    await expect(setToolVersion(svc, "github.com/me/web", step, node, "22")).rejects.toThrow(
      "no longer sets Node.js 24",
    );
    close();
    const lines = io.runs.map((r) => r.args.join(" "));
    expect(lines.some((l) => l.startsWith("commit") || l.startsWith("switch"))).toBe(false);
  });
});

async function scanSetup(files: Record<string, string>, latest: (repo: string) => Response) {
  let releaseCalls = 0;
  const io = memoryIo(files, {
    fetch: async (input) => {
      const url = new Request(input).url;
      if (url.endsWith("/releases/latest")) {
        releaseCalls++;
        return latest(url);
      }
      return jsonResponse({ sha: "abc" });
    },
  });
  const { svc, close } = await testServices(io);
  return { svc, close, releaseCalls: () => releaseCalls };
}

describe("scanActions", () => {
  const WORKFLOW =
    "jobs:\n  t:\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4.1.0\n";

  it("reports nothing, and no error, for a repo without workflows", async () => {
    const { svc, close } = await scanSetup({}, () => jsonResponse({}));
    const report = await scanActions(svc, { key: "k", root: "/repo" });
    close();
    expect(report).toMatchObject({ repoKey: "k", items: [], error: undefined });
  });

  it("finds outdated actions in every workflow file with their next ref", async () => {
    const { svc, close } = await scanSetup(
      { "/repo/.github/workflows/ci.yml": WORKFLOW, "/repo/.github/workflows/notes.md": "uses: a/b@v1" },
      (url) => jsonResponse({ tag_name: url.includes("setup-node") ? "v4.1.0" : "v5.0.0" }),
    );
    const report = await scanActions(svc, { key: "k", root: "/repo" });
    close();
    expect(report.items.map((i) => [i.file, i.action, i.current, i.latestTag, i.next])).toEqual([
      [".github/workflows/ci.yml", "actions/checkout", "4.0.0", "v5.0.0", { ref: "v5" }],
      [".github/workflows/ci.yml", "actions/setup-node", "4.1.0", "v4.1.0", undefined],
    ]);
  });

  it("reuses the last scan while the workflow files are unchanged, unless forced", async () => {
    const { svc, close, releaseCalls } = await scanSetup({ "/repo/.github/workflows/ci.yml": WORKFLOW }, () =>
      jsonResponse({ tag_name: "v5.0.0" }),
    );
    await scanActions(svc, { key: "k", root: "/repo" });
    const afterFirst = releaseCalls();
    await scanActions(svc, { key: "k", root: "/repo" });
    expect(releaseCalls()).toBe(afterFirst);
    close();
  });

  it("returns an empty report for a repo without a folder on this device", async () => {
    const { svc, close } = await scanSetup({}, () => jsonResponse({}));
    expect((await scanActions(svc, { key: "k", root: undefined })).items).toEqual([]);
    close();
  });

  it("keeps the other actions when one release lookup fails", async () => {
    const { svc, close } = await scanSetup({ "/repo/.github/workflows/ci.yml": WORKFLOW }, (url) =>
      url.includes("setup-node")
        ? new Response("{}", { status: 403, headers: { "x-ratelimit-remaining": "0" } })
        : jsonResponse({ tag_name: "v5.0.0" }),
    );
    const report = await scanActions(svc, { key: "k", root: "/repo" });
    close();
    expect(report.error).toBeUndefined();
    expect(report.items.find((i) => i.action === "actions/checkout")?.next).toEqual({ ref: "v5" });
  });
});

describe("scanActions after a failed lookup", () => {
  it("scans again next time instead of reusing the incomplete answer", async () => {
    let calls = 0;
    const io = memoryIo(
      { "/repo/.github/workflows/ci.yml": "steps:\n  - uses: a/b@v1\n" },
      {
        fetch: async () => {
          calls++;
          return calls === 1
            ? new Response("{}", { status: 404, statusText: "x" })
            : jsonResponse({ message: "boom" }, { status: 500 });
        },
      },
    );
    const { svc, close } = await testServices(io);
    const first = await scanActions(svc, { key: "k", root: "/repo" });
    expect(first.items.map((i) => i.action)).toEqual(["a/b"]);
    const second = await scanActions(svc, { key: "k", root: "/repo" });
    close();
    expect(second.error).toBeUndefined();
    expect(second.items).toHaveLength(1);
  });
});

describe("Actions after a branch switch", () => {
  it("rereads the workflows the other branch has", async () => {
    const setup = (version: string) =>
      `jobs:\n  ci:\n    steps:\n      - uses: actions/setup-node@v7\n        with:\n          node-version: ${version}\n`;
    const { io, svc, close } = await withWorkflow(setup("26"));
    await scanActions(svc, { key: "github.com/me/web", root: "/code/web" });
    io.files.set("/code/web/.github/workflows/ci.yml", setup("24"));
    await switchBranch(svc, "p1", "main");
    await vi.waitFor(async () => {
      const report = await readActions(svc, "github.com/me/web");
      expect(report?.items[0]?.inputs?.[0]?.value).toBe("24");
    }, 10_000);
    close();
  });
});
