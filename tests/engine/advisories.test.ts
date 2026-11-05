import { describe, expect, it } from "vitest";
import {
  batchQueries,
  cvssBaseScore,
  DEFAULT_CI_THRESHOLD,
  fixedVersion,
  groupFindings,
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

const grouped = (id: string, version: string, severity: Finding["severity"], fixedIn?: string): Finding => ({
  id,
  aliases: [],
  summary: id,
  severity,
  name: "brace-expansion",
  version,
  dev: false,
  direct: false,
  fixedIn,
  url: `https://osv.dev/${id}`,
});

describe("groupFindings", () => {
  it("folds advisories of one major line into a row with the highest fix", () => {
    const groups = groupFindings([
      grouped("A", "5.0.6", "high", "5.0.7"),
      grouped("B", "5.0.6", "moderate", "5.0.11"),
      grouped("C", "2.1.0", "high", "2.1.2"),
    ]);
    expect(groups.map((g) => [g.key, g.findings.length, g.fixedIn, g.severity])).toEqual([
      ["brace-expansion@5", 2, "5.0.11", "high"],
      ["brace-expansion@2", 1, "2.1.2", "high"],
    ]);
  });

  it("has no fix when one advisory in the group has none", () => {
    const [group] = groupFindings([grouped("A", "1.0.0", "low", "1.0.1"), grouped("B", "1.0.0", "low")]);
    expect(group?.fixedIn).toBeUndefined();
  });
});

const osv = (extra: Partial<OsvVuln>): OsvVuln => ({ id: "GHSA-x", ...extra });
const severeFinding = (name: string, severity: string, dev: boolean) =>
  toFinding(osv({ id: name, database_specific: { severity } }), { name, version: "1.0.0", dev }, true);
const findingAt = (version: string) => toFinding(osv({}), { name: "a", version, dev: false }, true);

describe("advisory edge cases", () => {
  it("has no fix when the range only names a last affected version", () => {
    const v = osv({
      affected: [
        {
          package: { name: "a", ecosystem: "npm" },
          ranges: [{ type: "SEMVER", events: [{ introduced: "0" }, { last_affected: "1.2.0" }] }],
        },
      ],
    });
    expect(fixedVersion(v, "a", "1.0.0")).toBeUndefined();
  });

  it("ignores ranges for other packages and git commit ranges", () => {
    const v = osv({
      affected: [
        {
          package: { name: "other", ecosystem: "npm" },
          ranges: [{ type: "SEMVER", events: [{ introduced: "0" }, { fixed: "9.0.0" }] }],
        },
        {
          package: { name: "a", ecosystem: "npm" },
          ranges: [{ type: "GIT", events: [{ introduced: "0" }, { fixed: "abc" }] }],
        },
      ],
    });
    expect(fixedVersion(v, "a", "1.0.0")).toBeUndefined();
  });

  it("picks the lowest fix among ranges that cover the version", () => {
    const v = osv({
      affected: [
        {
          package: { name: "a", ecosystem: "npm" },
          ranges: [
            {
              type: "ECOSYSTEM",
              events: [{ introduced: "1.0.0" }, { fixed: "1.4.0" }, { introduced: "2.0.0" }, { fixed: "2.1.0" }],
            },
            { type: "SEMVER", events: [{ introduced: "1.2.0" }, { fixed: "1.3.1" }] },
          ],
        },
      ],
    });
    expect(fixedVersion(v, "a", "1.2.5")).toBe("1.3.1");
    expect(fixedVersion(v, "a", "2.0.3")).toBe("2.1.0");
    expect(fixedVersion(v, "a", "1.5.0")).toBeUndefined();
  });

  it("treats an unknown label or CVSS v4 vector as moderate", () => {
    expect(severityOf(osv({ database_specific: { severity: "unknown" } }))).toBe("moderate");
    expect(severityOf(osv({ severity: [{ type: "CVSS_V4", score: "CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N" }] }))).toBe(
      "moderate",
    );
  });

  it("returns no score for incomplete vectors", () => {
    expect(cvssBaseScore("CVSS:3.1/AV:N/AC:L")).toBeUndefined();
    expect(cvssBaseScore("not a vector")).toBeUndefined();
  });

  it("scores a vector without impact as zero", () => {
    expect(cvssBaseScore("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:N")).toBe(0);
  });

  it("uses the first line of the details when there is no summary, and the OSV page when there is no GitHub link", () => {
    const detailed = toFinding(
      osv({ details: "Line one\nLine two" }),
      { name: "a", version: "1.0.0", dev: true },
      false,
    );
    expect(detailed).toMatchObject({
      summary: "Line one",
      url: "https://osv.dev/vulnerability/GHSA-x",
      dev: true,
      direct: false,
    });
  });

  it("counts dev findings when CI audits everything", () => {
    const devHigh = toFinding(
      osv({ database_specific: { severity: "HIGH" } }),
      { name: "a", version: "1.0.0", dev: true },
      true,
    );
    expect(wouldFailCi([devHigh], { level: "high", prodOnly: true })).toBe(false);
    expect(wouldFailCi([devHigh], { level: "high", prodOnly: false })).toBe(true);
    expect(wouldFailCi([devHigh], { level: "critical", prodOnly: false })).toBe(false);
  });

  it("sorts groups worst first, then production before dev", () => {
    const groups = groupFindings([
      severeFinding("dev-high", "HIGH", true),
      severeFinding("prod-low", "LOW", false),
      severeFinding("prod-high", "HIGH", false),
    ]);
    expect(groups.map((g) => g.name)).toEqual(["prod-high", "dev-high", "prod-low"]);
  });

  it("splits one package into a group per major line", () => {
    expect(
      groupFindings([findingAt("1.0.0"), findingAt("1.2.0"), findingAt("2.0.0")]).map((g) => [g.key, g.versions]),
    ).toEqual([
      ["a@1", ["1.0.0", "1.2.0"]],
      ["a@2", ["2.0.0"]],
    ]);
  });

  it("builds one OSV query per locked package", () => {
    expect(batchQueries([{ name: "@scope/a", version: "1.0.0", dev: false }])).toEqual([
      { package: { name: "@scope/a", ecosystem: "npm" }, version: "1.0.0" },
    ]);
  });
});
