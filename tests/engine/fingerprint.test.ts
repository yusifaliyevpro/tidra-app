import { describe, expect, it } from "vitest";
import { createHashCache, fingerprint, sha256 } from "@/engine/fingerprint";

describe("sha256", () => {
  it("matches the standard digest", async () => {
    expect(await sha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("fingerprint", () => {
  it("tells a missing file from an empty one and parts that only concatenate the same", async () => {
    expect(await fingerprint([null])).not.toBe(await fingerprint([""]));
    expect(await fingerprint(["ab", "c"])).not.toBe(await fingerprint(["a", "bc"]));
    expect(await fingerprint(["a", "b"])).toBe(await fingerprint(["a", "b"]));
  });
});

describe("createHashCache", () => {
  it("evicts the least recently used entry", () => {
    const cache = createHashCache<number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.get("a");
    cache.set("c", 3);
    expect([cache.get("a"), cache.get("b"), cache.get("c")]).toEqual([1, undefined, 3]);
  });
});
