import { describe, expect, it } from "vitest";
import { acceleratorFromEvent, acceleratorKeys } from "@/app/accelerator";

const press = (code: string, mods: { ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean } = {}) =>
  acceleratorFromEvent({
    code,
    ctrlKey: mods.ctrl ?? false,
    altKey: mods.alt ?? false,
    shiftKey: mods.shift ?? false,
    metaKey: mods.meta ?? false,
  });

describe("acceleratorFromEvent", () => {
  it("builds Tauri accelerators", () => {
    expect(press("Space", { ctrl: true, shift: true })).toBe("CommandOrControl+Shift+Space");
    expect(press("KeyT", { alt: true })).toBe("Alt+T");
    expect(press("Digit1", { meta: true })).toBe("CommandOrControl+1");
    expect(press("F9", { ctrl: true })).toBe("CommandOrControl+F9");
  });

  it("waits for a real key and requires a modifier", () => {
    expect(press("ShiftLeft", { shift: true })).toBeUndefined();
    expect(press("KeyA")).toBeUndefined();
    expect(press("KeyA", { shift: true })).toBeUndefined();
    expect(press("IntlBackslash", { ctrl: true })).toBeUndefined();
  });
});

describe("acceleratorKeys", () => {
  it("shows Ctrl for the cross-platform modifier", () => {
    expect(acceleratorKeys("CommandOrControl+Shift+Space")).toEqual(["Ctrl", "Shift", "Space"]);
    expect(acceleratorKeys("")).toEqual([]);
  });
});
