import { describe, expect, it } from "vitest";
import {
  cvssBaseScore,
  DEFAULT_CI_THRESHOLD,
  fixedVersion,
  severityOf,
  toFinding,
  wouldFailCi,
  type Finding,
  type OsvVuln,
} from "@/engine/advisories";

const vuln: OsvVuln = {
  id: "GHSA-c2qf-rxjj-qqgw",
  aliases: ["CVE-2022-25883"],
  summary: "semver vulnerable to Regular Expression Denial of Service",
  database_specific: { severity: "MODERATE" },
  affected: [
    {
      package: { name: "semver", ecosystem: "npm" },
      ranges: [
        {
          type: "SEMVER",
          events: [
            { introduced: "0" },
            { fixed: "5.7.2" },
            { introduced: "6.0.0" },
            { fixed: "6.3.1" },
            { introduced: "7.0.0" },
            { fixed: "7.5.2" },
          ],
        },
      ],
    },
  ],
  references: [{ url: "https://github.com/advisories/GHSA-c2qf-rxjj-qqgw" }],
};

describe("fixedVersion", () => {
  it("returns the fix for the range that covers the installed version", () => {
    expect(fixedVersion(vuln, "semver", "6.1.0")).toBe("6.3.1");
    expect(fixedVersion(vuln, "semver", "7.3.8")).toBe("7.5.2");
    expect(fixedVersion(vuln, "semver", "7.5.2")).toBeUndefined();
    expect(fixedVersion(vuln, "other", "6.1.0")).toBeUndefined();
  });
});

describe("severityOf", () => {
  it("uses GitHub's label and maps medium to moderate", () => {
    expect(severityOf(vuln)).toBe("moderate");
    expect(severityOf({ id: "x", database_specific: { severity: "MEDIUM" } })).toBe("moderate");
    expect(severityOf({ id: "x", database_specific: { severity: "CRITICAL" } })).toBe("critical");
  });

  it("falls back to the CVSS score", () => {
    expect(
      severityOf({ id: "x", severity: [{ type: "CVSS_V3", score: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H" }] }),
    ).toBe("critical");
    expect(severityOf({ id: "x" })).toBe("moderate");
  });

  it("computes CVSS 3.1 base scores", () => {
    expect(cvssBaseScore("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H")).toBe(9.8);
    expect(cvssBaseScore("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H")).toBe(7.5);
    expect(cvssBaseScore("CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N")).toBe(6.1);
    expect(cvssBaseScore("CVSS:2.0/AV:N")).toBeUndefined();
  });
});

const finding = (severity: Finding["severity"], dev: boolean): Finding => ({
  ...toFinding(vuln, { name: "semver", version: "7.3.8", dev }, false),
  severity,
});

describe("CI mirror", () => {
  it("builds findings with the fix and the advisory link", () => {
    expect(toFinding(vuln, { name: "semver", version: "7.3.8", dev: false }, true)).toMatchObject({
      fixedIn: "7.5.2",
      direct: true,
      url: "https://github.com/advisories/GHSA-c2qf-rxjj-qqgw",
    });
  });

  it("fails like `pnpm audit --prod --audit-level high`", () => {
    expect(wouldFailCi([finding("high", false)], DEFAULT_CI_THRESHOLD)).toBe(true);
    expect(wouldFailCi([finding("moderate", false)], DEFAULT_CI_THRESHOLD)).toBe(false);
    expect(wouldFailCi([finding("critical", true)], DEFAULT_CI_THRESHOLD)).toBe(false);
    expect(wouldFailCi([finding("critical", true)], { level: "high", prodOnly: false })).toBe(true);
  });

  it("ignores dismissed advisories", () => {
    expect(wouldFailCi([finding("critical", false)], DEFAULT_CI_THRESHOLD, new Set([vuln.id]))).toBe(false);
  });
});
