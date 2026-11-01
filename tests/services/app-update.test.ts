import { describe, expect, it, vi } from "vitest";

const check = vi.fn<() => Promise<unknown>>();
vi.mock("@tauri-apps/plugin-updater", () => ({ check: () => check() }));

const { checkSilently, progressTracker } = await import("@/services/app-update");

describe("checkSilently", () => {
  it("treats a failed background check as no update instead of an error", async () => {
    check.mockRejectedValueOnce(new Error("Could not fetch a valid release JSON from the remote"));
    await expect(checkSilently()).resolves.toBeNull();
  });

  it("returns the update when one is found", async () => {
    const update = { version: "0.1.1" };
    check.mockResolvedValueOnce(update);
    await expect(checkSilently()).resolves.toBe(update);
  });
});

describe("progressTracker", () => {
  it("turns download events into whole percentages and 100 when finished", () => {
    const track = progressTracker();
    expect(track({ event: "Started", data: { contentLength: 200 } })).toBe(0);
    expect(track({ event: "Progress", data: { chunkLength: 50 } })).toBe(25);
    expect(track({ event: "Progress", data: { chunkLength: 150 } })).toBe(99);
    expect(track({ event: "Finished" })).toBe(100);
  });

  it("reports no percentage when the size is unknown", () => {
    const track = progressTracker();
    track({ event: "Started", data: {} });
    expect(track({ event: "Progress", data: { chunkLength: 10 } })).toBeUndefined();
  });
});
