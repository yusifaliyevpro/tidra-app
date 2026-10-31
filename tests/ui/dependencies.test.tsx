import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "@/app/services";
import type { OutdatedEntry } from "@/engine/outdated";
import { Dependencies } from "@/modules/projects/dependencies";
import type { Services } from "@/services/context";
import { createProcessManager } from "@/services/processes";
import { startUpdate } from "@/services/updates";
import { outdatedEntry as entry, projectReport, testServices } from "../support/services";

vi.mock("@/modules/changelog-panel", () => ({ ChangelogPanel: () => null }));
vi.mock("@/modules/projects/update-run", () => ({ UpdateRunDialog: () => null }));
vi.mock("@/services/updates", () => ({ startUpdate: vi.fn<typeof startUpdate>() }));

let svc: Services;
let close: () => void;

beforeEach(async () => {
  ({ svc, close } = await testServices());
  vi.mocked(startUpdate).mockResolvedValue("run-1");
});

afterEach(() => close());

function renderDeps(outdated: OutdatedEntry[]) {
  return render(
    <QueryClientProvider client={svc.queryClient}>
      <ServicesProvider value={{ svc, processes: createProcessManager(svc) }}>
        <Dependencies projectId="p1" path="/repo" report={projectReport(outdated)} />
      </ServicesProvider>
    </QueryClientProvider>,
  );
}

const button = (name: string | RegExp) => screen.getByRole("button", { name });

describe("Dependencies", () => {
  it("says so when nothing is outdated", () => {
    renderDeps([]);
    expect(screen.getByText("Up to date")).toBeTruthy();
  });

  it("groups by bump with majors first", () => {
    renderDeps([entry("lodash", "4.17.20", "4.17.21", "patch"), entry("vite", "7.0.0", "8.0.0", "major")]);
    const names = screen.getAllByRole("checkbox").map((box) => box.getAttribute("aria-label"));
    expect(names).toEqual(["Select all major updates", "Select vite", "Select all patch updates", "Select lodash"]);
  });

  it("selects a group and updates it with the latest versions", async () => {
    const user = userEvent.setup();
    renderDeps([
      entry("a", "1.0.0", "1.0.1", "patch"),
      entry("b", "2.0.0", "2.0.5", "patch"),
      entry("c", "1.0.0", "1.1.0", "minor"),
    ]);
    expect(button("Update").hasAttribute("disabled")).toBe(true);

    await user.click(screen.getByRole("checkbox", { name: "Select all patch updates" }));
    expect(screen.getByText(/2 selected/)).toBeTruthy();

    await user.click(button("Update 2 packages"));
    expect(startUpdate).toHaveBeenCalledWith(svc, "p1", [
      { entry: expect.objectContaining({ name: "a" }), version: "1.0.1" },
      { entry: expect.objectContaining({ name: "b" }), version: "2.0.5" },
    ]);
  });

  it("moves with j and selects with Space", async () => {
    const user = userEvent.setup();
    renderDeps([entry("a", "1.0.0", "2.0.0", "major"), entry("b", "1.0.0", "1.1.0", "minor")]);
    expect(button(/^a/).getAttribute("aria-current")).toBe("true");

    await user.keyboard("j");
    expect(button(/^b/).getAttribute("aria-current")).toBe("true");

    await user.keyboard(" ");
    expect(screen.getByRole<HTMLInputElement>("checkbox", { name: "Select b" }).checked).toBe(true);
  });
});
