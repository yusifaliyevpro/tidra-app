import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { DismissedWorkChips } from "@/app/dismissed-work";
import { ServicesProvider } from "@/app/services";
import { dismissedWork } from "@/services/dismissed";
import { createProcessManager } from "@/services/processes";
import { memoryIo } from "../support/memory-io";
import { testServices } from "../support/services";

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
  closeServices?.();
  dismissedWork.remove("run-1");
});

describe("DismissedWorkChips", () => {
  it("brings back a dialog that takes clicks, though the header it sits in lets them through", async () => {
    const { svc, close } = await testServices(memoryIo({ "/app/package.json": "{}" }));
    closeServices = close;
    dismissedWork.add({ kind: "run", id: "run-1", label: "Updating app", projectId: "p1", path: "/app" });
    render(
      <QueryClientProvider client={svc.queryClient}>
        <ServicesProvider value={{ svc, processes: createProcessManager(svc) }}>
          {/* Like the header's activity area: only the chips themselves take the pointer. */}
          <div style={{ pointerEvents: "none" }}>
            <DismissedWorkChips />
          </div>
        </ServicesProvider>
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByTitle("Show output"));
    expect(screen.getByRole("dialog", { name: "Update" })).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "Update" })).toBeNull();
  });
});
