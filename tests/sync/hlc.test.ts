import { describe, expect, it } from "vitest";
import { createClock, formatHlc, parseHlc } from "@/sync/hlc";

describe("hybrid logical clock", () => {
  it("formats sortable timestamps and parses them back", () => {
    const value = formatHlc(1_761_916_800_000, 3, "dev-a");
    expect(value).toBe("000001761916800000:0003:dev-a");
    expect(parseHlc(value)).toEqual({ ms: 1_761_916_800_000, counter: 3, deviceId: "dev-a" });
    expect(parseHlc("garbage")).toBeUndefined();
  });

  it("stays monotonic when the wall clock stalls or goes backwards", () => {
    let wall = 1000;
    const clock = createClock("a", () => wall);
    const first = clock.tick();
    const second = clock.tick();
    wall = 500;
    const third = clock.tick();
    expect([first, second, third]).toEqual([first, second, third].toSorted());
    expect(new Set([first, second, third]).size).toBe(3);
  });

  it("orders local writes after any timestamp it has received", () => {
    const clock = createClock("a", () => 1000);
    const remote = formatHlc(5000, 7, "b");
    clock.receive(remote);
    expect(clock.tick() > remote).toBe(true);
  });

  it("resumes from the last persisted timestamp", () => {
    const clock = createClock("a", () => 10, formatHlc(9000, 2, "a"));
    expect(clock.tick()).toBe(formatHlc(9000, 3, "a"));
  });

  it("breaks ties by device id", () => {
    expect(formatHlc(1, 0, "a") < formatHlc(1, 0, "b")).toBe(true);
  });
});
