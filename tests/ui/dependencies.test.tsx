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

function tree(outdated: OutdatedEntry[], updatedAt?: string) {
  const report = { ...projectReport(outdated), ...(updatedAt ? { updatedAt } : {}) };
  return (
    <QueryClientProvider client={svc.queryClient}>
      <ServicesProvider value={{ svc, processes: createProcessManager(svc) }}>
        <Dependencies projectId="p1" report={report} onStarted={() => undefined} />
      </ServicesProvider>
    </QueryClientProvider>
  );
}

const renderDeps = (outdated: OutdatedEntry[]) => render(tree(outdated));

const button = (name: string | RegExp) => screen.getByRole("button", { name });

describe("Dependencies", () => {
  it("says so when nothing is outdated", () => {
    renderDeps([]);
    expect(screen.getByText("Up to date")).toBeTruthy();
  });

  it("groups by bump with majors first", () => {
    renderDeps([entry("lodash", "4.17.20", "4.17.21", "patch"), entry("vite", "7.0.0", "8.0.0", "major")]);
    const names = screen.getAllByRole("checkbox").map((box) => box.getAttribute("aria-label"));
    expect(names).toEqual([
      "Select all major updates",
      "Select vite",
      "Select all patch updates",
      "Select lodash",
      "Select all updates",
    ]);
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

  it("keeps picks when a background refresh brings a new report, dropping packages that are gone", async () => {
    const user = userEvent.setup();
    const a = entry("a", "1.0.0", "1.0.1", "patch");
    const b = entry("b", "2.0.0", "2.0.5", "patch");
    const { rerender } = render(tree([a, b]));
    await user.click(screen.getByRole("checkbox", { name: "Select all patch updates" }));

    rerender(tree([a, b], "2026-10-31T00:05:00.000Z"));
    expect(screen.getByText(/2 selected/)).toBeTruthy();

    rerender(tree([b], "2026-10-31T00:10:00.000Z"));
    expect(screen.getByText(/1 selected/)).toBeTruthy();
    expect(button("Update")).toBeTruthy();
  });

  it("picks every package from the footer", async () => {
    const user = userEvent.setup();
    renderDeps([entry("a", "1.0.0", "2.0.0", "major"), entry("b", "1.0.0", "1.1.0", "minor")]);
    await user.click(screen.getByRole("checkbox", { name: "Select all updates" }));
    expect(screen.getByText(/2 selected/)).toBeTruthy();
    await user.click(screen.getByRole("checkbox", { name: "Select all updates" }));
    expect(screen.queryByText(/selected/)).toBeNull();
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

const waitingTree = (outdated: OutdatedEntry[], waiting: OutdatedEntry[]) => (
  <QueryClientProvider client={svc.queryClient}>
    <ServicesProvider value={{ svc, processes: createProcessManager(svc) }}>
      <Dependencies projectId="p1" report={{ ...projectReport(outdated), waiting }} onStarted={() => undefined} />
    </ServicesProvider>
  </QueryClientProvider>
);

describe("Dependencies waiting for minimumReleaseAge", () => {
  it("shows waiting updates but never picks them, even with select all", async () => {
    const user = userEvent.setup();
    const young = { ...entry("next-intl", "4.14.10", "4.14.11", "patch"), readyAt: "2999-01-01T00:00:00.000Z" };
    render(waitingTree([entry("a", "1.0.0", "1.0.1", "patch")], [young]));
    expect(screen.getByText("Waiting for minimumReleaseAge")).toBeTruthy();
    const box = screen.getByRole("checkbox", { name: "Select next-intl" });
    expect(box.hasAttribute("disabled")).toBe(true);

    await user.click(screen.getByRole("checkbox", { name: "Select all updates" }));
    await user.click(button("Update"));
    expect(startUpdate).toHaveBeenCalledWith(svc, "p1", [
      { entry: expect.objectContaining({ name: "a" }), version: "1.0.1" },
    ]);
  });

  it("lists a project whose only updates are waiting instead of calling it up to date", () => {
    render(waitingTree([], [entry("next-intl", "4.14.10", "4.14.11", "patch")]));
    expect(screen.queryByText("Up to date")).toBeNull();
    expect(screen.getByRole("button", { name: /next-intl/ })).toBeTruthy();
  });

  it("shows how long ago the target was published", () => {
    const published = new Date(Date.now() - 3 * 86_400_000).toISOString();
    render(waitingTree([{ ...entry("a", "1.0.0", "1.0.1", "patch"), publishedAt: published }], []));
    expect(screen.getByText("3d")).toBeTruthy();
  });
});
