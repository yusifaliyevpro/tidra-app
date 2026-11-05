import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Log } from "@/ui/log";

describe("Log", () => {
  it("shows colored output and a placeholder when empty", () => {
    const { container, rerender } = render(<Log text="" empty="Nothing yet" />);
    expect(container.textContent).toBe("Nothing yet");
    rerender(<Log text={"\u001B[32mok\u001B[39m done"} />);
    expect(container.textContent).toBe("ok done");
    expect(container.querySelectorAll("span")).toHaveLength(1);
  });

  it("keeps the page small for a long colored log", () => {
    const line = "\u001B[32m✓\u001B[39m tests/engine/spec.test.ts (12 tests) 4ms\n";
    const { container } = render(<Log text={line.repeat(10_000).slice(-400_000)} />);
    expect(container.querySelectorAll("span").length).toBeLessThan(2000);
  });
});
