import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "@/app/services";
import { UpdateRunDialog } from "@/modules/projects/update-run";
import { createProcessManager } from "@/services/processes";
import type * as Updates from "@/services/updates";
import type { RunProgress } from "@/services/updates";
import { memoryIo } from "../../support/memory-io";
import { testServices } from "../../support/services";

let emit: (progress: RunProgress) => void = () => {};
vi.mock("@/services/updates", async (original) => ({
  ...(await original<typeof Updates>()),
  subscribeRun: (_id: string, listener: (progress: RunProgress) => void) => {
    emit = listener;
    return () => {};
  },
}));

// jsdom has no modal dialogs of its own.
function showModal(this: HTMLDialogElement) {
  this.open = true;
}
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = showModal;
});

let closeServices: (() => void) | undefined;
afterEach(() => closeServices?.());

describe("UpdateRunDialog", () => {
  it("keeps the output open when the checks pass", async () => {
    const { svc, close } = await testServices(memoryIo({ "/app/package.json": "{}" }));
    closeServices = close;
    await svc.store.addProject({ id: "p1", name: "app", remote: "github.com/me/app", path: "/app" });
    render(
      <QueryClientProvider client={svc.queryClient}>
        <ServicesProvider value={{ svc, processes: createProcessManager(svc) }}>
          <UpdateRunDialog runId="r1" projectId="p1" onClose={() => undefined} />
        </ServicesProvider>
      </QueryClientProvider>,
    );
    const running: RunProgress = { runId: "r1", steps: { checks: { state: "running" } }, log: "$ pnpm check\n" };
    act(() => emit(running));
    const output = screen.getByRole("button", { name: "Output" });
    expect(output.getAttribute("aria-expanded")).toBe("true");
    act(() =>
      emit({
        ...running,
        steps: { checks: { state: "done" } },
        result: { ok: true, previousBranch: "main", changes: [], touched: [] },
      }),
    );
    expect(screen.getByText("Updated")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Output" }).getAttribute("aria-expanded")).toBe("true");
  });
});
