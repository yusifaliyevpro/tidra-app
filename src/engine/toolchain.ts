import * as z from "@zod/mini";
import semver from "semver";
import type { Command } from "./pm";

/** First semver-looking token in `--version` output (`git version 2.47.1.windows.2` → 2.47.1). */
export function parseVersionOutput(output: string): string | undefined {
  const match = /(\d+\.\d+(?:\.\d+)?)/.exec(output);
  return match?.[1] ? semver.coerce(match[1])?.version : undefined;
}

export interface WingetUpgrade {
  name: string;
  id: string;
  version: string;
  available: string;
}

/**
 * Parses `winget upgrade` output. The table is fixed-width and localized, so columns are located from the
 * dashed separator line and the header row's word starts rather than from header text.
 */
export function parseWingetUpgrades(output: string): WingetUpgrade[] {
  const lines = output.split(/\r?\n/).map((line) => line.replace(/^.*\r/, ""));
  const separator = lines.findIndex((line) => /^-{10,}\s*$/.test(line));
  const header = lines[separator - 1];
  if (separator < 1 || !header) return [];
  const starts = [...header.matchAll(/\S+/g)]
    .map((m) => m.index)
    .filter((i, n, all) => n === 0 || i > (all[n - 1] ?? 0) + 1);
  if (starts.length < 4) return [];
  const [, idStart = 0, versionStart = 0, availableStart = 0, sourceStart] = starts;
  return lines.slice(separator + 1).flatMap((line) => {
    if (!line.trim() || /^\d+ (upgrades?|package)/i.test(line.trim())) return [];
    const cut = (from: number, to?: number) => line.slice(from, to).trim();
    const row = {
      name: cut(0, idStart),
      id: cut(idStart, versionStart),
      version: cut(versionStart, availableStart),
      available: cut(availableStart, sourceStart),
    };
    return row.id && row.available ? [row] : [];
  });
}

const PnpmGlobalOutdated = z.compile(z.record(z.string(), z.looseObject({ latest: z.optional(z.string()) })));
const PnpmGlobalList = z.compile(
  z.array(z.looseObject({ dependencies: z.optional(z.record(z.string(), z.looseObject({ version: z.string() }))) })),
);

export interface GlobalPackage {
  name: string;
  version: string;
  /** Only set when a newer version exists. */
  latest?: string;
}

/** The JSON document in pnpm's output, skipping any warnings printed before it. */
function jsonAfterWarnings(stdout: string, open: "{" | "["): unknown {
  const start = stdout.indexOf(open);
  if (start < 0) return undefined;
  try {
    return JSON.parse(stdout.slice(start));
  } catch {
    return undefined;
  }
}

/** Every global package from `pnpm ls -g --json`, with the newer version from `pnpm outdated -g --format json`. */
export function parsePnpmGlobals(listStdout: string, outdatedStdout: string): GlobalPackage[] {
  const list = jsonAfterWarnings(listStdout, "[");
  if (!z.validate(PnpmGlobalList, list)) return [];
  const outdated = jsonAfterWarnings(outdatedStdout, "{");
  const latest = z.validate(PnpmGlobalOutdated, outdated) ? outdated : {};
  return Object.entries(list[0]?.dependencies ?? {})
    .map(([name, { version }]) => {
      const newer = latest[name]?.latest;
      return newer && newer !== version ? { name, version, latest: newer } : { name, version };
    })
    .toSorted((a, b) => a.name.localeCompare(b.name));
}

const NodeIndex = z.compile(z.array(z.looseObject({ version: z.string(), lts: z.union([z.string(), z.boolean()]) })));

/** Latest LTS and latest current release from nodejs.org/dist/index.json. */
export function parseNodeIndex(data: unknown): { lts?: string; current?: string } {
  if (!z.validate(NodeIndex, data)) return {};
  return {
    current: data[0]?.version.replace(/^v/, ""),
    lts: data.find((release) => release.lts !== false)?.version.replace(/^v/, ""),
  };
}

/** `-EncodedCommand` payload: base64 of the script as UTF-16LE, so no quoting can break or inject. */
export function encodePowerShell(script: string): string {
  let binary = "";
  for (const char of script) {
    const code = char.charCodeAt(0);
    binary += String.fromCharCode(code & 0xff, code >> 8);
  }
  return btoa(binary);
}

const CHOCOLATEY_INSTALL = "https://community.chocolatey.org/install.ps1";

/**
 * Installs Node.js `version` with Chocolatey in an elevated PowerShell (UAC prompt), installing Chocolatey
 * first when it's missing. The window stays open on failure so the error can be read.
 */
export function chocolateyNodeUpdate(version: string): Command {
  if (!semver.valid(version)) throw new Error(`Not a Node.js version: ${version}`);
  const elevated = [
    "$ErrorActionPreference = 'Stop'",
    "try {",
    "  if (-not (Get-Command choco -ErrorAction SilentlyContinue)) {",
    "    Set-ExecutionPolicy Bypass -Scope Process -Force",
    "    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor 3072",
    `    Invoke-RestMethod ${CHOCOLATEY_INSTALL} | Invoke-Expression`,
    String.raw`    $env:Path += ";$env:ALLUSERSPROFILE\chocolatey\bin"`,
    "  }",
    `  choco upgrade nodejs --version="${version}" -y`,
    '  if ($LASTEXITCODE -ne 0) { throw "choco exited with $LASTEXITCODE" }',
    "} catch {",
    "  Write-Host $_ -ForegroundColor Red",
    "  Read-Host 'Press Enter to close'",
    "  exit 1",
    "}",
  ].join("\n");
  // One line: a parameter name at the end of a line leaves it without a value.
  const launcher = [
    `$p = Start-Process powershell -Verb RunAs -Wait -PassThru -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand','${encodePowerShell(elevated)}'`,
    "exit $p.ExitCode",
  ].join("\n");
  return { program: "powershell", args: ["-NoProfile", "-EncodedCommand", encodePowerShell(launcher)] };
}
