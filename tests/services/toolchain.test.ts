import { describe, expect, it } from "vitest";
import { writeSnapshot } from "@/services/snapshot";
import { readToolchain, refreshGlobals, type ToolchainSnapshot } from "@/services/toolchain";
import { memoryIo, ok } from "../support/memory-io";
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
