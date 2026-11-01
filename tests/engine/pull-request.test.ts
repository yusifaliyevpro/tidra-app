import { describe, expect, it } from "vitest";
import { nextPullTitle, pullBody, pullTitle } from "@/engine/pull-request";

const backend = "chore(deps): bump hono 4.9.0 → 4.10.1";
const frontend = "chore(deps): bump 3 dependencies";

describe("pullTitle", () => {
  it("uses the only commit's subject, else a summary", () => {
    expect(pullTitle([backend])).toBe(backend);
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

describe("pullBody", () => {
  it("lists every commit between markers", () => {
    expect(pullBody([backend])).toBe(`<!-- tidra:commits -->\n- ${backend}\n<!-- /tidra:commits -->`);
  });

  it("rewrites only the marked list and keeps text around it", () => {
    const current = `Tested locally.\n\n${pullBody([backend])}\n\nThanks`;
    expect(pullBody([backend, frontend], current)).toBe(
      `Tested locally.\n\n<!-- tidra:commits -->\n- ${backend}\n- ${frontend}\n<!-- /tidra:commits -->\n\nThanks`,
    );
  });

  it("replaces a plain list from before the markers, and appends to anything else", () => {
    expect(pullBody([backend, frontend], `- ${backend}`)).toBe(pullBody([backend, frontend]));
    expect(pullBody([backend], "Why: security fix")).toBe(`Why: security fix\n\n${pullBody([backend])}`);
  });
});
