import { describe, expect, it } from "vitest";
import { actionsUpdatePrompt, applyActionUpdatesToRepo, type ActionItem } from "@/services/actions";
import { memoryIo, ok } from "../support/memory-io";
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
    expect(lines).toContain(`switch -c ${branch} main`);
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
