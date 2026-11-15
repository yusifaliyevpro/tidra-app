import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "@/app/services";
import { BranchesDialog } from "@/modules/projects/branches-dialog";
import { createProcessManager } from "@/services/processes";
import { memoryIo, ok, type MemoryIo } from "../../support/memory-io";
import { testServices } from "../../support/services";

// jsdom has no modal dialogs of its own.
function showModal(this: HTMLDialogElement) {
  this.open = true;
}
function closeDialog(this: HTMLDialogElement) {
  this.open = false;
}
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = showModal;
  HTMLDialogElement.prototype.close = closeDialog;
});

const dialogOf = (title: string) => {
  const dialog = screen.getByText(title).closest("dialog");
  if (!dialog) throw new Error(`${title} isn't in a dialog`);
  return within(dialog);
};

let closeServices: (() => void) | undefined;
afterEach(() => closeServices?.());

const lines = (names: Set<string>) => ok([...names].map((n) => `${n}|1700000000|`).join("\n"));

async function setup() {
  const present = new Set(["main", "done", "experiment"]);
  const origin = new Set(["main", "done", "cloud-only"]);
  const io = memoryIo(
    { "/app/package.json": "{}" },
    {
      run: (program, args) => {
        if (program !== "git") return ok();
        const line = args.join(" ");
        if (args[0] === "status") return ok("# branch.head main\n# branch.upstream origin/main\n");
        if (args[0] === "symbolic-ref") return ok("origin/main\n");
        if (args.includes("--merged")) return ok("refs/heads/main\nrefs/heads/done\nrefs/remotes/origin/done");
        if (line.includes("committerdate")) return lines(args.at(-1) === "refs/remotes/origin" ? origin : present);
        if (args[0] === "branch" && args[1] === "-D") present.delete(args[2] ?? "");
        if (args[0] === "push") for (const name of args.slice(3)) origin.delete(name);
        return ok();
      },
    },
  );
  const { svc, close } = await testServices(io);
  closeServices = close;
  await svc.store.addProject({ id: "p1", name: "app", remote: "github.com/me/app", path: "/app" });
  render(
    <QueryClientProvider client={svc.queryClient}>
      <ServicesProvider value={{ svc, processes: createProcessManager(svc) }}>
        <BranchesDialog projectId="p1" label="app" onClose={() => undefined} />
      </ServicesProvider>
    </QueryClientProvider>,
  );
  await screen.findByRole("button", { name: "Delete done" });
  return { io };
}

const deletes = (io: MemoryIo) => io.runs.filter((run) => run.args[1] === "-D").map((run) => run.args[2]);
const pushes = (io: MemoryIo) => io.runs.filter((run) => run.args[0] === "push").map((run) => run.args.join(" "));

describe("BranchesDialog", () => {
  it("marks merged branches and offers no delete for the current or default branch", async () => {
    await setup();
    expect(screen.getByLabelText("Merged")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Delete main" })).toBeNull();
    expect(screen.getByText("current")).toBeTruthy();
  });

  it("deletes a merged branch without asking", async () => {
    const { io } = await setup();
    await userEvent.click(screen.getByRole("button", { name: "Delete done" }));
    await vi.waitFor(() => expect(deletes(io)).toEqual(["done"]));
    expect(pushes(io)).toEqual(["push origin --delete done"]);
    expect(screen.queryByText("Delete this branch?")).toBeNull();
  });

  it("lists a branch that only exists on origin and deletes it there", async () => {
    const { io } = await setup();
    expect(screen.getByLabelText("Only on origin")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Delete cloud-only" }));
    expect(await screen.findByText(/Copies on origin are deleted too/)).toBeTruthy();
    await userEvent.click(dialogOf("Delete this branch?").getByRole("button", { name: "Delete" }));
    await vi.waitFor(() => expect(pushes(io)).toEqual(["push origin --delete cloud-only"]));
    expect(deletes(io)).toEqual([]);
    await vi.waitFor(() => expect(screen.queryByText("cloud-only")).toBeNull());
  });

  it("asks before deleting an unmerged branch, and cancel keeps it", async () => {
    const { io } = await setup();
    await userEvent.click(screen.getByRole("button", { name: "Delete experiment" }));
    expect(await screen.findByText(/experiment isn't merged into origin\/main/)).toBeTruthy();
    expect(screen.getByText(/Unmerged commits are lost/)).toBeTruthy();
    expect(screen.queryByText(/Copies on origin/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(deletes(io)).toEqual([]);
  });

  it("deletes an unmerged branch once confirmed", async () => {
    const { io } = await setup();
    await userEvent.click(screen.getByRole("button", { name: "Delete experiment" }));
    await screen.findByText("Delete this branch?");
    await userEvent.click(dialogOf("Delete this branch?").getByRole("button", { name: "Delete" }));
    await vi.waitFor(() => expect(deletes(io)).toEqual(["experiment"]));
  });

  it("confirms Delete all, saying how many aren't merged", async () => {
    const { io } = await setup();
    await userEvent.click(screen.getByRole("button", { name: "Delete all" }));
    expect(await screen.findByText("Delete 3 branches?")).toBeTruthy();
    expect(screen.getByText(/2 of them aren't merged/)).toBeTruthy();
    expect(deletes(io)).toEqual([]);
    await userEvent.click(dialogOf("Delete 3 branches?").getByRole("button", { name: "Delete" }));
    await vi.waitFor(() => expect(new Set(deletes(io))).toEqual(new Set(["done", "experiment"])));
    expect(pushes(io)).toEqual(["push origin --delete done cloud-only"]);
  });
});
