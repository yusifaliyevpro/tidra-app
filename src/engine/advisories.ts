import * as z from "@zod/mini";
import semver from "semver";
import type { LockedPackage } from "./lockfile";

export const SEVERITIES = ["low", "moderate", "high", "critical"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const severityRank = (severity: Severity) => SEVERITIES.indexOf(severity);

const Event = z.looseObject({
  introduced: z.optional(z.string()),
  fixed: z.optional(z.string()),
  last_affected: z.optional(z.string()),
});

export const OsvVulnSchema = z.compile(
  z.looseObject({
    id: z.string(),
    summary: z.optional(z.string()),
    details: z.optional(z.string()),
    aliases: z.optional(z.array(z.string())),
    database_specific: z.optional(z.looseObject({ severity: z.optional(z.string()) })),
    severity: z.optional(z.array(z.looseObject({ type: z.string(), score: z.string() }))),
    affected: z.optional(
      z.array(
        z.looseObject({
          package: z.optional(z.looseObject({ name: z.string(), ecosystem: z.string() })),
          ranges: z.optional(z.array(z.looseObject({ type: z.string(), events: z.array(Event) }))),
          versions: z.optional(z.array(z.string())),
        }),
      ),
    ),
    references: z.optional(z.array(z.looseObject({ url: z.string() }))),
  }),
);

export type OsvVuln = z.infer<typeof OsvVulnSchema>;

export const OsvBatchSchema = z.compile(
  z.looseObject({
    results: z.array(z.looseObject({ vulns: z.optional(z.array(z.looseObject({ id: z.string() }))) })),
  }),
);

export const OSV_BATCH_URL = "https://api.osv.dev/v1/querybatch";
export const osvVulnUrl = (id: string) => `https://api.osv.dev/v1/vulns/${encodeURIComponent(id)}`;
export const OSV_BATCH_LIMIT = 1000;

export function batchQueries(packages: LockedPackage[]) {
  return packages.map((p) => ({ package: { name: p.name, ecosystem: "npm" }, version: p.version }));
}

/** GitHub's severity label when present; otherwise the CVSS v3 base score bucket. */
export function severityOf(vuln: OsvVuln): Severity {
  const label = vuln.database_specific?.severity?.toLowerCase();
  if (label === "medium") return "moderate";
  const known = SEVERITIES.find((s) => s === label);
  if (known) return known;
  const score = vuln.severity?.map((s) => cvssBaseScore(s.score)).find((n) => n !== undefined);
  if (score === undefined) return "moderate";
  return score >= 9 ? "critical" : score >= 7 ? "high" : score >= 4 ? "moderate" : "low";
}

const cia = (v: string | undefined): number | undefined => ({ H: 0.56, L: 0.22, N: 0 })[v ?? ""];

/** Approximate CVSS 3.x base score from a vector, enough to bucket severity. */
export function cvssBaseScore(vector: string): number | undefined {
  if (!vector.startsWith("CVSS:3")) return undefined;
  const m: Record<string, string> = {};
  for (const part of vector.split("/").slice(1)) {
    const [key, value] = part.split(":");
    if (key && value) m[key] = value;
  }
  const av = { N: 0.85, A: 0.62, L: 0.55, P: 0.2 }[m.AV ?? ""];
  const ac = { L: 0.77, H: 0.44 }[m.AC ?? ""];
  const ui = { N: 0.85, R: 0.62 }[m.UI ?? ""];
  const changed = m.S === "C";
  const pr = changed ? { N: 0.85, L: 0.68, H: 0.5 }[m.PR ?? ""] : { N: 0.85, L: 0.62, H: 0.27 }[m.PR ?? ""];
  const [c, i, a] = [cia(m.C), cia(m.I), cia(m.A)];
  if ([av, ac, ui, pr, c, i, a].some((v) => v === undefined)) return undefined;
  const iss = 1 - (1 - c!) * (1 - i!) * (1 - a!);
  const impact = changed ? 7.52 * (iss - 0.029) - 3.25 * (iss - 0.02) ** 15 : 6.42 * iss;
  if (impact <= 0) return 0;
  const exploitability = 8.22 * av! * ac! * pr! * ui!;
  const raw = changed ? Math.min(1.08 * (impact + exploitability), 10) : Math.min(impact + exploitability, 10);
  return Math.ceil(raw * 10) / 10;
}

/** Lowest `fixed` event of a range that covers the installed version. */
export function fixedVersion(vuln: OsvVuln, name: string, version: string): string | undefined {
  const fixes: string[] = [];
  for (const affected of vuln.affected ?? []) {
    if (affected.package && affected.package.name !== name) continue;
    for (const range of affected.ranges ?? []) {
      if (range.type !== "SEMVER" && range.type !== "ECOSYSTEM") continue;
      let introduced: string | undefined;
      for (const event of range.events) {
        if (event.introduced !== undefined) introduced = event.introduced === "0" ? "0.0.0" : event.introduced;
        if (event.fixed && introduced && semver.valid(event.fixed) && semver.valid(introduced)) {
          if (semver.gte(version, introduced) && semver.lt(version, event.fixed)) fixes.push(event.fixed);
          introduced = undefined;
        }
      }
    }
  }
  return fixes.toSorted(semver.compare)[0];
}

export interface Finding {
  id: string;
  aliases: string[];
  summary: string;
  severity: Severity;
  name: string;
  version: string;
  dev: boolean;
  /** Declared directly in a manifest, so a version bump fixes it; otherwise it needs an override. */
  direct: boolean;
  fixedIn?: string;
  url: string;
}

export function toFinding(vuln: OsvVuln, pkg: LockedPackage, direct: boolean): Finding {
  return {
    id: vuln.id,
    aliases: vuln.aliases ?? [],
    summary: vuln.summary ?? vuln.details?.split("\n")[0] ?? vuln.id,
    severity: severityOf(vuln),
    name: pkg.name,
    version: pkg.version,
    dev: pkg.dev,
    direct,
    fixedIn: fixedVersion(vuln, pkg.name, pkg.version),
    url:
      vuln.references?.find((r) => r.url.includes("github.com/advisories"))?.url ??
      `https://osv.dev/vulnerability/${vuln.id}`,
  };
}

export interface CiThreshold {
  level: Severity;
  prodOnly: boolean;
}

export const DEFAULT_CI_THRESHOLD: CiThreshold = { level: "high", prodOnly: true };

/** Mirrors `pnpm audit --prod --audit-level high`: any finding at or above the level fails CI. */
export function wouldFailCi(
  findings: Finding[],
  threshold: CiThreshold,
  dismissed: ReadonlySet<string> = new Set(),
): boolean {
  return findings.some(
    (f) =>
      !dismissed.has(f.id) &&
      (!threshold.prodOnly || !f.dev) &&
      severityRank(f.severity) >= severityRank(threshold.level),
  );
}
