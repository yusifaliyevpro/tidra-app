import { describe, expect, it } from "vitest";
import { attribute } from "@/services/changelogs";

const expo = {
  packages: new Map([
    ["expo-router", ["mobile"]],
    ["@expo/ui", ["mobile", "web"]],
  ]),
  watched: false,
};

describe("attribute", () => {
  it("keeps monorepo releases only for packages you use", () => {
    expect(attribute("expo-router@58.0.29", expo)).toEqual({ packageName: "expo-router", usedBy: ["mobile"] });
    expect(attribute("expo-template-tabs@58.0.31", expo)).toBeUndefined();
  });

  it("shows every release of a watched repo", () => {
    expect(attribute("expo-template-tabs@58.0.31", { ...expo, watched: true })).toEqual({
      packageName: "expo-template-tabs",
      usedBy: [],
    });
  });

  it("gives plain tags to every package from the repo", () => {
    expect(attribute("v5.0.0", expo)).toEqual({ packageName: undefined, usedBy: ["mobile", "web"] });
    const single = { packages: new Map([["vite", ["web"]]]), watched: false };
    expect(attribute("v8.0.0", single)).toEqual({ packageName: "vite", usedBy: ["web"] });
  });
});
