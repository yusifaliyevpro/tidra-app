import { describe, expect, it } from "vitest";
import { writeSnapshot } from "@/services/snapshot";
import { readToolchain, refreshGlobals, refreshToolchain, type ToolchainSnapshot } from "@/services/toolchain";
import { jsonResponse, memoryIo, ok, packument } from "../support/memory-io";
import { testServices } from "../support/services";

const before: ToolchainSnapshot = {
  tools: [{ id: "node", label: "Node.js", installed: "24.1.0", outdated: false }],
  globals: [{ name: "vercel", version: "65.8.0", latest: "65.9.0" }],
  winget: [],
  wingetAvailable: true,
  updatedAt: "2026-11-01T00:00:00.000Z",
};

describe("refreshGlobals", () => {
  it("rereads only the global packages, so an updated row drops its update", async () => {
    const io = memoryIo(
      {},
      {
        run: async (_program, args) =>
          args[0] === "ls"
            ? ok('[{"dependencies":{"vercel":{"version":"65.9.0"},"depcheck":{"version":"1.4.7"}}}]')
            : ok("{}"),
      },
    );
    const { svc, close } = await testServices(io);
    await writeSnapshot(svc, "toolchain", before);
    await refreshGlobals(svc);
    const after = await readToolchain(svc);
    close();

    expect(after?.globals).toEqual([
      { name: "depcheck", version: "1.4.7" },
      { name: "vercel", version: "65.9.0" },
    ]);
    expect(after?.tools).toEqual(before.tools);
    expect(io.runs.map((r) => [r.program, ...r.args].join(" "))).toEqual([
      "pnpm ls -g --json",
      "pnpm outdated -g --format json",
    ]);
  });
});

describe("refreshToolchain", () => {
  const versions: Record<string, string> = {
    node: "v24.1.0",
    pnpm: "12.0.0",
    npm: "11.0.0",
    git: "git version 2.47.1.windows.2",
    rustc: "rustc 1.90.0 (abc 2026-09-01)",
  };

  async function refresh(installed = versions) {
    const io = memoryIo(
      {},
      {
        run: (program) => {
          const out = installed[program];
          if (program === "winget") return { code: null, stdout: "", stderr: "not found" };
          return out === undefined ? { code: null, stdout: "", stderr: "" } : ok(out);
        },
        fetch: async (input) => {
          const url = new Request(input).url;
          if (url === "https://nodejs.org/dist/index.json")
            return jsonResponse([
              { version: "v25.0.0", lts: false },
              { version: "v24.5.0", lts: "Krypton" },
            ]);
          if (url.includes("registry.npmjs.org/pnpm"))
            return jsonResponse(packument("pnpm", { "12.1.0": {} }, { latest: "12.1.0" }));
          if (url.includes("registry.npmjs.org/npm"))
            return jsonResponse(packument("npm", { "11.0.0": {} }, { latest: "11.0.0" }));
          if (url.endsWith("/releases/latest"))
            return jsonResponse({ tag_name: url.includes("rust-lang") ? "1.91.0" : "v2.47.1.windows.2" });
          return jsonResponse({ sha: "x" });
        },
      },
    );
    const { svc, close } = await testServices(io);
    const snapshot = await refreshToolchain(svc);
    close();
    return Object.fromEntries(snapshot.tools.map((t) => [t.id, t]));
  }

  it("compares each tool with its latest release and an LTS Node with the newest LTS", async () => {
    const tools = await refresh();
    expect(tools.node).toMatchObject({ installed: "24.1.0", latest: "24.5.0", outdated: true, note: "LTS 24.5.0" });
    expect(tools.pnpm).toMatchObject({
      installed: "12.0.0",
      latest: "12.1.0",
      outdated: true,
      updateHint: "pnpm self-update",
    });
    expect(tools.npm).toMatchObject({ outdated: false });
    expect(tools.git).toMatchObject({ installed: "2.47.1", latest: "2.47.1", outdated: false });
    expect(tools.rustc).toMatchObject({ installed: "1.90.0", latest: "1.91.0", outdated: true });
  });

  it("compares a current-line Node with the current release", async () => {
    const tools = await refresh({ ...versions, node: "v25.0.0" });
    expect(tools.node).toMatchObject({ latest: "25.0.0", outdated: false });
  });

  it("shows missing tools as not installed rather than outdated", async () => {
    const tools = await refresh({});
    expect(tools.cargo).toMatchObject({ installed: undefined, outdated: false });
    expect(tools.node).toMatchObject({ installed: undefined, outdated: false });
  });
});

describe("refreshToolchain off Windows", () => {
  it("doesn't run winget or compare git with git-for-windows", async () => {
    const urls: string[] = [];
    const io = memoryIo(
      {},
      {
        platform: "linux",
        run: (program) => (program === "git" ? ok("git version 2.40.0") : { code: null, stdout: "", stderr: "" }),
        fetch: async (input) => {
          urls.push(new Request(input).url);
          return jsonResponse([]);
        },
      },
    );
    const { svc, close } = await testServices(io);
    const snapshot = await refreshToolchain(svc);
    close();
    expect(snapshot.wingetAvailable).toBe(false);
    expect(io.runs.some((r) => r.program === "winget")).toBe(false);
    expect(urls.some((url) => url.includes("git-for-windows"))).toBe(false);
    expect(snapshot.tools.find((t) => t.id === "git")).toMatchObject({
      installed: "2.40.0",
      latest: undefined,
      outdated: false,
    });
  });
});
