import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { ServicesProvider } from "@/app/services";
import { ActionsList } from "@/modules/repos/actions-list";
import type { ActionsReport } from "@/services/actions";
import type { Services } from "@/services/context";
import { createProcessManager } from "@/services/processes";
import type { RepoGroup } from "@/services/repos";
import { memoryIo, ok } from "../../support/memory-io";
import { testServices } from "../../support/services";

let closeServices: (() => void) | undefined;
afterEach(() => closeServices?.());

const repo: RepoGroup = { key: "github.com/me/app", label: "app", root: "/app", projects: [] };

const report: ActionsReport = {
  repoKey: repo.key,
  updatedAt: new Date().toISOString(),
  incomplete: false,
  items: [
    {
      line: 18,
      file: ".github/workflows/ci.yml",
      action: "pnpm/action-setup",
      repo: "pnpm/action-setup",
      ref: "v6",
      style: "major",
      current: "v6",
      inputs: [{ line: 20, name: "version", tool: "pnpm", value: "11.x" }],
    },
  ],
};

const wrap = (svc: Services, ui: React.ReactNode) => (
  <QueryClientProvider client={svc.queryClient}>
    <ServicesProvider value={{ svc, processes: createProcessManager(svc) }}>{ui}</ServicesProvider>
  </QueryClientProvider>
);

describe("ActionsList tool versions", () => {
  it("closes the field without running git when Enter keeps the same version", async () => {
    const io = memoryIo({}, { run: () => ok() });
    const { svc, close } = await testServices(io);
    closeServices = close;
    render(wrap(svc, <ActionsList repo={repo} report={report} />));

    await userEvent.click(screen.getByRole("button", { name: /pnpm version 11\.x/ }));
    await userEvent.keyboard("{Enter}");

    expect(screen.queryByRole("textbox", { name: "pnpm version" })).toBeNull();
    expect(io.runs.filter((r) => r.program === "git")).toEqual([]);
  });
});
