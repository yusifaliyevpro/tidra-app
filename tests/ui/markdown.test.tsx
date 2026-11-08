import { act, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Markdown } from "@/ui/markdown";

describe("Markdown", () => {
  it("renders release notes and strips anything executable", async () => {
    const source = [
      "## Breaking",
      "- Dropped Node 18 ([#12](https://github.com/o/r/pull/12))",
      '<img src="x" onerror="alert(1)">',
      "<script>alert(2)</script>",
      '<a href="javascript:alert(3)">bad</a>',
      '<p style="position:fixed">styled</p>',
    ].join("\n");
    // The renderer loads on first use, so the render waits for it inside act.
    const { container } = await act(async () => {
      const result = render(<Markdown source={source} />);
      await import("@/ui/render-markdown");
      return result;
    });

    expect(container.querySelector("h2")?.textContent).toBe("Breaking");
    expect(container.querySelector('a[href="https://github.com/o/r/pull/12"]')).not.toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("[onerror]")).toBeNull();
    expect(container.querySelector("[style]")).toBeNull();
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
  });
});
