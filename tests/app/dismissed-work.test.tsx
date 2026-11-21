import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DONE_CHIP_MS, ActivityStack } from "@/app/dismissed-work";
import { ServicesProvider } from "@/app/services";
import { dismissedWork } from "@/services/dismissed";
import { createProcessManager } from "@/services/processes";
import type { RunProgress } from "@/services/updates";
import { memoryIo } from "../support/memory-io";
import { testServices } from "../support/services";

const runListeners = vi.hoisted(() => new Map<string, (p: RunProgress) => void>());
vi.mock("@/services/updates", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  subscribeRun: (id: string, listener: (p: RunProgress) => void) => {
    runListeners.set(id, listener);
    return () => runListeners.delete(id);
  },
}));
const finishRun = (id: string, ok: boolean) =>
  act(async () => {
    runListeners.get(id)?.({ runId: id, steps: {}, log: "", result: { ok, changes: [], touched: [] } });
  });
const advance = (ms: number) =>
  act(async () => {
    vi.advanceTimersByTime(ms);
  });

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

let closeServices: (() => void) | undefined;
afterEach(() => {
  vi.useRealTimers();
  closeServices?.();
  dismissedWork.remove("run-1");
  dismissedWork.remove("run-2");
});

async function renderChips() {
  const { svc, close } = await testServices(memoryIo({ "/app/package.json": "{}" }));
  closeServices = close;
  render(
    <QueryClientProvider client={svc.queryClient}>
      <ServicesProvider value={{ svc, processes: createProcessManager(svc) }}>
        {/* Like the header's activity area: only the chips themselves take the pointer. */}
        <div style={{ pointerEvents: "none" }}>
          <ActivityStack />
        </div>
      </ServicesProvider>
    </QueryClientProvider>,
  );
}

describe("ActivityStack", () => {
  it("brings back a dialog that takes clicks, though the header it sits in lets them through", async () => {
    dismissedWork.add({ kind: "run", id: "run-1", name: "app", projectId: "p1", path: "/app" });
    await renderChips();

    // The dialog loads on first use, so it shows once that import settles.
    await act(async () => {
      fireEvent.click(screen.getByTitle("Show output"));
      await import("@/modules/projects/update-run");
    });
    expect(screen.getByRole("dialog", { name: "Update" })).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "Update" })).toBeNull();
  });
  it("says the update is done and leaves on its own a few seconds after it succeeds", async () => {
    dismissedWork.add({ kind: "run", id: "run-1", name: "app", projectId: "p1", path: "/app" });
    await renderChips();
    expect(screen.getByText("Updating app")).toBeTruthy();

    vi.useFakeTimers();
    await finishRun("run-1", true);
    expect(screen.getByText("Updated app")).toBeTruthy();
    await advance(DONE_CHIP_MS);
    expect(screen.queryByText("Updated app")).toBeNull();
  });

  it("keeps a failed update until it is closed", async () => {
    dismissedWork.add({ kind: "run", id: "run-1", name: "app", projectId: "p1", path: "/app" });
    await renderChips();
    vi.useFakeTimers();
    await finishRun("run-1", false);
    await advance(DONE_CHIP_MS * 2);
    expect(screen.getByText("Update failed: app")).toBeTruthy();
  });

  it("shows the newest as the one pill, with a count of the rest that unfold below it", async () => {
    dismissedWork.add({ kind: "run", id: "run-1", name: "app", projectId: "p1", path: "/app" });
    dismissedWork.add({ kind: "run", id: "run-2", name: "web", projectId: "p2", path: "/web" });
    await renderChips();
    const pill = screen.getByText("Updating web");
    const more = screen.getByLabelText("1 more");
    expect(more.textContent).toBe("1");
    // The older one sits in the folded panel, not beside the pill, so the pill stays centered.
    expect(pill.closest(".group > div")?.contains(screen.getByText("Updating app"))).toBe(false);
  });
});
