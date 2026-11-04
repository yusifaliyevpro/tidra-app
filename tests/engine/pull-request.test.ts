import { describe, expect, it } from "vitest";
import { nextPullTitle, pullBody, pullTitle } from "@/engine/pull-request";

const backend = "chore(deps): bump hono 4.9.0 → 4.10.1";
const frontend = "chore(deps): bump 2 dependencies\n\n- oxfmt 0.75.0 → 0.76.0\n- vite 8.3.4 → 8.3.5";

describe("pullTitle", () => {
  it("uses the only commit's subject, else a summary", () => {
    expect(pullTitle([backend])).toBe(backend);
    expect(pullTitle([frontend])).toBe("chore(deps): bump 2 dependencies");
    expect(pullTitle([backend, frontend])).toBe("chore(deps): update dependencies");
  });
});

describe("nextPullTitle", () => {
  it("moves a generated title to the summary once more commits arrive", () => {
    expect(nextPullTitle(backend, [backend, frontend])).toBe("chore(deps): update dependencies");
    expect(nextPullTitle("chore(deps): update dependencies", [backend, frontend])).toBeUndefined();
  });

  it("keeps a title someone wrote", () => {
    expect(nextPullTitle("Bump backend and frontend", [backend, frontend])).toBeUndefined();
  });
});

const list = (...lines: string[]) => ["<!-- tidra:commits -->", ...lines, "<!-- /tidra:commits -->"].join("\n");

describe("pullBody", () => {
  it("lists every package with its versions, not just commit subjects", () => {
    expect(pullBody([backend, frontend])).toBe(
      list("- hono 4.9.0 → 4.10.1", "- oxfmt 0.75.0 → 0.76.0", "- vite 8.3.4 → 8.3.5"),
    );
  });

  it("lists other commits by their subject", () => {
    expect(pullBody(["fix: adapt to the new hono types\n\nLonger story."])).toBe(
      list("- fix: adapt to the new hono types"),
    );
  });

  it("rewrites only the marked list and keeps text around it", () => {
    const current = `Tested locally.\n\n${pullBody([backend])}\n\nThanks`;
    expect(pullBody([backend, frontend], current)).toBe(
      `Tested locally.\n\n${pullBody([backend, frontend])}\n\nThanks`,
    );
  });

  it("replaces a plain list from before the markers, and appends to anything else", () => {
    expect(pullBody([backend, frontend], `- ${backend}`)).toBe(pullBody([backend, frontend]));
    expect(pullBody([backend], "Why: security fix")).toBe(`Why: security fix\n\n${pullBody([backend])}`);
  });
});
