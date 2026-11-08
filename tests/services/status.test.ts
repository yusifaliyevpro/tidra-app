import { describe, expect, it } from "vitest";
import { projectStatus } from "@/services/status";

const health = (over: Partial<Parameters<typeof projectStatus>[0] & object> = {}) => ({
  updates: { major: 0, minor: 0, patch: 0 },
  security: { critical: 0, high: 0, moderate: 0, low: 0, total: 0 },
  failsAudit: false,
  ...over,
});

describe("projectStatus", () => {
  it("is off for a project that was never checked or failed to check", () => {
    expect(projectStatus(undefined)).toBe("off");
    expect(projectStatus(health({ error: "No package.json" }))).toBe("off");
  });

  it("puts advisories above major updates", () => {
    const h = health({
      updates: { major: 3, minor: 0, patch: 0 },
      security: { critical: 0, high: 1, moderate: 0, low: 0, total: 1 },
    });
    expect(projectStatus(h)).toBe("alert");
  });

  it("counts a failing audit as an alert even without high advisories", () => {
    expect(
      projectStatus(health({ failsAudit: true, security: { critical: 0, high: 0, moderate: 2, low: 0, total: 2 } })),
    ).toBe("alert");
  });

  it("ranks major over minor and patch", () => {
    expect(projectStatus(health({ updates: { major: 1, minor: 4, patch: 9 } }))).toBe("major");
    expect(projectStatus(health({ updates: { major: 0, minor: 0, patch: 2 } }))).toBe("minor");
  });

  it("is ok when nothing is outdated or vulnerable", () => {
    expect(projectStatus(health({ security: { critical: 0, high: 0, moderate: 0, low: 1, total: 1 } }))).toBe("ok");
  });

  it("shows checking while a check runs, whatever the last state", () => {
    expect(projectStatus(health({ updates: { major: 2, minor: 0, patch: 0 } }), true)).toBe("checking");
  });
});
