import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "@/app/services";
import type { GitStatus } from "@/engine/git";
import { BranchActions } from "@/modules/projects/branch-actions";
import { SyncButton } from "@/modules/projects/sync-button";
import type { Services } from "@/services/context";
import { createProcessManager } from "@/services/processes";
import { memoryIo, ok, type MemoryIo } from "../../support/memory-io";
import { testServices } from "../../support/services";

const git = (patch: Partial<GitStatus>): GitStatus => ({
  branch: "main",
  upstream: "origin/main",
  ahead: 0,
  behind: 0,
  changed: 0,
  untracked: 0,
  conflicted: 0,
  ...patch,
});

let closeServices: (() => void) | undefined;
afterEach(() => closeServices?.());

async function setup(statusOutput: string) {
  const io = memoryIo(
    { "/app/package.json": "{}" },
    { run: (program, args) => (program === "git" && args[0] === "status" ? ok(statusOutput) : ok()) },
  );
  const { svc, close } = await testServices(io);
  closeServices = close;
  await svc.store.addProject({ id: "p1", name: "app", remote: "github.com/me/app", path: "/app" });
  return { io, svc };
}

const wrap = (svc: Services, ui: React.ReactNode) => (
  <QueryClientProvider client={svc.queryClient}>
    <ServicesProvider value={{ svc, processes: createProcessManager(svc) }}>{ui}</ServicesProvider>
  </QueryClientProvider>
);

const gitLines = (io: MemoryIo) => io.runs.filter((r) => r.program === "git").map((r) => r.args.join(" "));

describe("BranchActions", () => {
  it("shows nothing on a clean, pushed branch", async () => {
    const { svc } = await setup("# branch.head main\n");
    const { container } = render(wrap(svc, <BranchActions projectId="p1" git={git({})} />));
    expect(container.innerHTML).toBe("");
  });

  it("only offers Commit on other branches when an update left the changes", async () => {
    const { svc } = await setup("# branch.head main\n");
    const { rerender } = render(wrap(svc, <BranchActions projectId="p1" git={git({ changed: 2 })} />));
    expect(screen.queryByRole("button", { name: /Commit/ })).toBeNull();
    rerender(wrap(svc, <BranchActions projectId="p1" git={git({ changed: 2 })} allowCommit />));
    expect(screen.getByRole("button", { name: "Commit & Push" })).toBeTruthy();
  });

  it("commits and pushes in one click", async () => {
    const { io, svc } = await setup(
      "# branch.head main\n# branch.upstream origin/main\n1 .M N... 100644 100644 100644 a b package.json\n",
    );
    render(wrap(svc, <BranchActions projectId="p1" git={git({ changed: 1 })} allowCommit />));
    await userEvent.click(screen.getByRole("button", { name: "Commit & Push" }));
    await vi.waitFor(() => expect(gitLines(io)).toContain("push --set-upstream origin main"));
    expect(gitLines(io)).toEqual(expect.arrayContaining(["add --all", "commit -m chore(deps): update dependencies"]));
  });

  it("commits without pushing from the menu", async () => {
    const { io, svc } = await setup("# branch.head main\n1 .M N... 100644 100644 100644 a b package.json\n");
    render(wrap(svc, <BranchActions projectId="p1" git={git({ changed: 1 })} allowCommit />));
    await userEvent.click(screen.getByRole("button", { name: "More commit options" }));
    await userEvent.click(screen.getByRole("button", { name: "Commit" }));
    await vi.waitFor(() => expect(gitLines(io)).toContain("commit -m chore(deps): update dependencies"));
    expect(gitLines(io).some((l) => l.startsWith("push"))).toBe(false);
  });

  it("offers Push for an update branch that was never published", async () => {
    const { io, svc } = await setup("# branch.head tidra/deps-1\n");
    render(
      wrap(svc, <BranchActions projectId="p1" git={git({ branch: "tidra/deps-1", upstream: undefined, ahead: 1 })} />),
    );
    await userEvent.click(screen.getByRole("button", { name: "Push" }));
    await vi.waitFor(() => expect(gitLines(io)).toContain("push --set-upstream origin tidra/deps-1"));
  });
});

describe("SyncButton", () => {
  it("hides when nothing waits either way, or there is nowhere to sync with", async () => {
    const { svc } = await setup("# branch.head main\n");
    const { container, rerender } = render(wrap(svc, <SyncButton projectId="p1" git={git({})} fork={undefined} />));
    expect(container.innerHTML).toBe("");
    rerender(wrap(svc, <SyncButton projectId="p1" git={git({ upstream: undefined, ahead: 2 })} fork={undefined} />));
    expect(container.innerHTML).toBe("");
  });

  it("counts commits to pull, to push and new on upstream", async () => {
    const { svc } = await setup("# branch.head main\n");
    render(
      wrap(
        svc,
        <SyncButton
          projectId="p1"
          git={git({ ahead: 1, behind: 2 })}
          fork={{ remote: "github.com/them/app", behind: 3, ref: "upstream/main" }}
        />,
      ),
    );
    const button = screen.getByRole("button", { name: "Sync, 5 to pull, 1 to push, 3 new on them/app" });
    expect(button.textContent).toBe("6");
  });

  it("doesn't count upstream's commits on a branch sync won't move", async () => {
    const { svc } = await setup("# branch.head feature\n");
    const { container } = render(
      wrap(
        svc,
        <SyncButton
          projectId="p1"
          git={git({ branch: "feature", upstream: "origin/feature" })}
          fork={{ remote: "github.com/them/app", behind: 3, ref: "upstream/main" }}
        />,
      ),
    );
    expect(container.innerHTML).toBe("");
  });

  it("syncs the checkout when clicked", async () => {
    const { io, svc } = await setup("# branch.head main\n# branch.upstream origin/main\n# branch.ab +0 -2\n");
    render(wrap(svc, <SyncButton projectId="p1" git={git({ behind: 2 })} fork={undefined} />));
    await userEvent.click(screen.getByRole("button", { name: /^Sync/ }));
    await vi.waitFor(() => expect(gitLines(io)).toContain("merge --ff-only @{u}"));
  });
});
