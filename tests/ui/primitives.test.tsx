import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "@/ui/error-boundary";
import { MenuItem, Popover } from "@/ui/popover";
import { TimeAgo } from "@/ui/time";
import { currentToasts, dismiss, toast, toastError } from "@/ui/toast";

afterEach(() => vi.useRealTimers());

describe("TimeAgo", () => {
  it.for([
    [30, "just now"],
    [90, "1 min. ago"],
    [3 * 3600, "3 hr. ago"],
    [86_400, "yesterday"],
    [9 * 86_400, "last wk."],
  ] as const)("shows %i seconds ago as %s", ([seconds, text]) => {
    vi.useFakeTimers({ now: new Date("2026-11-05T12:00:00Z") });
    render(<TimeAgo value={Date.now() - seconds * 1000} />);
    expect(screen.getByText(text).tagName).toBe("TIME");
  });

  it("renders nothing without a value", () => {
    const { container } = render(<TimeAgo value={undefined} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("ErrorBoundary", () => {
  const state = { explode: true };
  function Bomb({ explode }: { explode?: boolean }) {
    if (explode ?? state.explode) throw new Error("bad snapshot");
    return <p>fine</p>;
  }

  it("shows the error in place and retries by remounting", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    state.explode = true;
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );
    expect(screen.getByText("bad snapshot")).toBeTruthy();
    state.explode = false;
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(screen.getByText("fine")).toBeTruthy();
  });

  it("uses a custom fallback", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary fallback={(error) => <p>custom: {String(error)}</p>}>
        <Bomb explode />
      </ErrorBoundary>,
    );
    expect(screen.getByText("custom: Error: bad snapshot")).toBeTruthy();
  });
});

function Menu({ onPick }: { onPick: () => void }) {
  return (
    <Popover
      renderTrigger={({ open, toggle }) => (
        <button type="button" aria-expanded={open} onClick={toggle}>
          More
        </button>
      )}
    >
      {(close) => (
        <MenuItem
          onSelect={() => {
            close();
            onPick();
          }}
        >
          Push
        </MenuItem>
      )}
    </Popover>
  );
}

describe("Popover", () => {
  it("opens from its trigger and closes after picking an item", async () => {
    const onPick = vi.fn<() => void>();
    render(<Menu onPick={onPick} />);
    await userEvent.click(screen.getByRole("button", { name: "More" }));
    await userEvent.click(screen.getByRole("button", { name: "Push" }));
    expect(onPick).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Push" })).toBeNull();
  });

  it("closes on Escape and on a click outside", async () => {
    render(
      <>
        <Menu onPick={() => {}} />
        <p>outside</p>
      </>,
    );
    await userEvent.click(screen.getByRole("button", { name: "More" }));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("button", { name: "Push" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "More" }));
    await userEvent.click(screen.getByText("outside"));
    expect(screen.queryByRole("button", { name: "Push" })).toBeNull();
  });
});

describe("toasts", () => {
  it("keeps the four newest and dismisses them on a timer, errors later than info", () => {
    vi.useFakeTimers();
    for (const id of currentToasts().map((t) => t.id)) dismiss(id);
    for (const n of [1, 2, 3, 4, 5]) toast(`message ${n}`);
    expect(currentToasts().map((t) => t.message)).toEqual(["message 2", "message 3", "message 4", "message 5"]);
    toastError(new Error("failed"));
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(currentToasts().map((t) => [t.message, t.tone])).toEqual([["failed", "error"]]);
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(currentToasts()).toEqual([]);
  });

  it("shows non-Error rejections as text", () => {
    for (const id of currentToasts().map((t) => t.id)) dismiss(id);
    toastError("plain");
    expect(currentToasts().at(-1)?.message).toBe("plain");
  });
});
