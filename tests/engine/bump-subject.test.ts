import { describe, expect, it } from "vitest";
import { bumpSubject } from "@/engine/bump-subject";

const patch = (name: string) => ({ name, from: "1.0.0", to: "1.0.1" });

describe("bumpSubject", () => {
  it("joins the names like a sentence", () => {
    expect(bumpSubject([patch("next")])).toBe("chore(deps): bump next");
    expect(bumpSubject([patch("next"), patch("oxfmt")])).toBe("chore(deps): bump next and oxfmt");
    expect(bumpSubject([patch("next"), patch("oxfmt"), patch("vite")])).toBe("chore(deps): bump next, oxfmt and vite");
  });

  it("puts the riskiest bumps first, counting a 0.x minor as breaking", () => {
    const bumps = [
      patch("vite"),
      { name: "hono", from: "4.9.0", to: "4.10.1" },
      { name: "oxfmt", from: "0.75.0", to: "0.76.0" },
      { name: "react", from: "18.3.1", to: "19.0.0" },
    ];
    expect(bumpSubject(bumps)).toBe("chore(deps): bump oxfmt, react, hono and vite");
  });

  it("puts unscoped names first within the same risk", () => {
    expect(bumpSubject([patch("@tiptap/core"), patch("next")])).toBe("chore(deps): bump next and @tiptap/core");
  });

  it("counts the rest once the names pass 72 characters", () => {
    const names = ["package-name-1", "package-name-2", "package-name-3", "package-name-4"];
    const subject = bumpSubject(names.map(patch));
    expect(subject).toBe("chore(deps): bump package-name-1, package-name-2 and 2 more");
    expect(subject.length).toBeLessThanOrEqual(72);
  });

  it("names a package once when several commits bump it", () => {
    expect(bumpSubject([patch("next"), { name: "next", from: "1.0.1", to: "2.0.0" }, patch("vite")])).toBe(
      "chore(deps): bump next and vite",
    );
  });

  it("falls back to a count when not even one name fits", () => {
    expect(bumpSubject([patch("x".repeat(70)), patch("y".repeat(70))])).toBe("chore(deps): bump 2 dependencies");
  });

  it("sorts versions it can't read last", () => {
    expect(bumpSubject([{ name: "alpha", from: "^1.0.0", to: "2.0.0" }, patch("vite")])).toBe(
      "chore(deps): bump vite and alpha",
    );
  });
});
