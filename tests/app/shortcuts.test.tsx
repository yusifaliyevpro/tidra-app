import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PALETTE_SHORTCUT } from "@/app/accelerator";
import { MODULES } from "@/app/modules";
import { useGlobalShortcuts } from "@/app/shortcuts";

const navigate = vi.hoisted(() => vi.fn<(options: { to: string }) => Promise<void>>());
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));

function Shell({ onPalette }: { onPalette: () => void }) {
  useGlobalShortcuts(onPalette, DEFAULT_PALETTE_SHORTCUT);
  return <input aria-label="Search" />;
}

beforeEach(() => navigate.mockReset());

describe("useGlobalShortcuts", () => {
  const target = MODULES[1];

  it("opens the palette with its accelerator, even while typing", async () => {
    const onPalette = vi.fn<() => void>();
    render(<Shell onPalette={onPalette} />);
    await userEvent.click(screen.getByRole("textbox", { name: "Search" }));
    await userEvent.keyboard("{Control>}p{/Control}");
    expect(onPalette).toHaveBeenCalledOnce();
  });

  it("goes to a screen with g and its key", async () => {
    render(<Shell onPalette={() => {}} />);
    await userEvent.keyboard(`g${target?.key ?? ""}`);
    expect(navigate).toHaveBeenCalledWith({ to: target?.path });
  });

  it("ignores g sequences typed into a field, and keys that aren't screens", async () => {
    render(<Shell onPalette={() => {}} />);
    await userEvent.click(screen.getByRole("textbox", { name: "Search" }));
    await userEvent.keyboard(`g${target?.key ?? ""}`);
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    await userEvent.keyboard("g7");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("forgets a g pressed long ago", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<Shell onPalette={() => {}} />);
    await userEvent.keyboard("g");
    vi.advanceTimersByTime(2000);
    await userEvent.keyboard(target?.key ?? "");
    vi.useRealTimers();
    expect(navigate).not.toHaveBeenCalled();
  });
});
