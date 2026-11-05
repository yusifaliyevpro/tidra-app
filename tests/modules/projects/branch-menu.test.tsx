import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "@/app/services";
import type { GitStatus } from "@/engine/git";
import { BranchMenu } from "@/modules/projects/branch-menu";
import type { Services } from "@/services/context";
import { createProcessManager } from "@/services/processes";
import { memoryIo, ok, type MemoryIo } from "../../support/memory-io";
import { testServices } from "../../support/services";

const onDev: GitStatus = {
  branch: "dev",
  upstream: "origin/dev",
  ahead: 0,
  behind: 0,
  changed: 0,
  untracked: 0,
  conflicted: 0,
};

let closeServices: (() => void) | undefined;
afterEach(() => closeServices?.());

async function setup(branches: () => string) {
  const io = memoryIo(
    { "/app/package.json": "{}" },
    {
      run: (program, args) => {
        if (program !== "git") return ok();
        const line = args.join(" ");
        if (line.endsWith("refs/heads")) return ok(branches());
        if (line === "remote") return ok("origin\n");
        return ok();
      },
    },
  );
  const { svc, close } = await testServices(io);
  closeServices = close;
  await svc.store.addProject({ id: "p1", name: "app", remote: "github.com/me/app", path: "/app" });
  return { io, svc };
}

const wrap = (svc: Services) => (
  <QueryClientProvider client={svc.queryClient}>
    <ServicesProvider value={{ svc, processes: createProcessManager(svc) }}>
      <BranchMenu projectId="p1" git={onDev} />
    </ServicesProvider>
  </QueryClientProvider>
);

const switches = (io: MemoryIo) => io.runs.filter((run) => run.args[0] === "switch").map((run) => run.args.join(" "));

describe("BranchMenu", () => {
  it("switches to the branch that is clicked", async () => {
    const { io, svc } = await setup(() => "dev\nfeature/a\n");
    render(wrap(svc));
    await userEvent.click(screen.getByRole("button", { name: /dev/ }));
    await userEvent.click(await screen.findByRole("button", { name: "feature/a" }));
    await vi.waitFor(() => expect(switches(io)).toEqual(["switch feature/a"]));
  });

  it("creates a branch from a name nothing matches", async () => {
    const { io, svc } = await setup(() => "dev\n");
    render(wrap(svc));
    await userEvent.click(screen.getByRole("button", { name: /dev/ }));
    await userEvent.type(await screen.findByRole("textbox"), "fix/new{Enter}");
    await vi.waitFor(() => expect(switches(io)).toEqual(["switch -c fix/new"]));
  });

  it("prefers the branch with exactly the typed name on Enter", async () => {
    const { io, svc } = await setup(() => "main-old\nmain\ndev\n");
    render(wrap(svc));
    await userEvent.click(screen.getByRole("button", { name: /dev/ }));
    await screen.findByRole("button", { name: "main" });
    await userEvent.type(screen.getByRole("textbox"), "main{Enter}");
    await vi.waitFor(() => expect(switches(io)).toEqual(["switch main"]));
  });

  it("lists a branch created since the menu was last opened", async () => {
    let branches = "dev\n";
    const { svc } = await setup(() => branches);
    render(wrap(svc));
    const trigger = screen.getByRole("button", { name: /dev/ });
    await userEvent.click(trigger);
    await screen.findByRole("textbox");
    await userEvent.click(trigger);
    branches = "dev\nmade-in-terminal\n";
    await userEvent.click(trigger);
    expect(await screen.findByRole("button", { name: "made-in-terminal" })).toBeTruthy();
  });
});
