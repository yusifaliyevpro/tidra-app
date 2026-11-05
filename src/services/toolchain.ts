import semver from "semver";
import { emptyConfig } from "@/engine/npmrc";
import { fetchWithRetry } from "@/engine/registry";
import {
  nodeUpdateTarget,
  parseNodeIndex,
  parsePnpmGlobals,
  parseVersionOutput,
  parseWingetUpgrades,
  type GlobalPackage,
  type WingetUpgrade,
} from "@/engine/toolchain";
import type { Services } from "./context";
import { readSnapshot, writeSnapshot } from "./snapshot";

export interface ToolInfo {
  id: string;
  label: string;
  installed?: string;
  latest?: string;
  note?: string;
  outdated: boolean;
  /** Command line the user can run to update, shown and copyable rather than run blindly. */
  updateHint?: string;
}

export interface ToolchainSnapshot {
  tools: ToolInfo[];
  globals: GlobalPackage[];
  winget: WingetUpgrade[];
  wingetAvailable: boolean;
  updatedAt: string;
}

async function installedVersion(svc: Services, program: string, args = ["--version"]) {
  const result = await svc.io.run(program, args);
  return result.code === 0 ? parseVersionOutput(result.stdout || result.stderr) : undefined;
}

async function npmLatest(svc: Services, name: string) {
  return (
    await svc
      .registry(emptyConfig())
      .abbreviated(name)
      .catch(() => null)
  )?.["dist-tags"].latest;
}

async function githubLatestTag(svc: Services, owner: string, repo: string) {
  const tag = (await (await svc.github()).latestRelease(owner, repo).catch(() => undefined))?.tag;
  return tag ? parseVersionOutput(tag) : undefined;
}

const isOutdated = (installed?: string, latest?: string) =>
  Boolean(installed && latest && semver.valid(installed) && semver.valid(latest) && semver.lt(installed, latest));

export async function refreshToolchain(svc: Services): Promise<ToolchainSnapshot> {
  const nodeIndexRequest = fetchWithRetry(svc.io.fetch, "https://nodejs.org/dist/index.json", {})
    .then((r): Promise<unknown> => r.json())
    .catch(() => undefined);
  const windows = svc.io.platform === "windows";

  const [nodeReleases, node, pnpm, npm, git, rustc, cargo, pnpmLatest, npmLatestVersion, gitLatest, rustLatest] =
    await Promise.all([
      nodeIndexRequest,
      installedVersion(svc, "node"),
      installedVersion(svc, "pnpm"),
      installedVersion(svc, "npm"),
      installedVersion(svc, "git"),
      installedVersion(svc, "rustc"),
      installedVersion(svc, "cargo"),
      npmLatest(svc, "pnpm"),
      npmLatest(svc, "npm"),
      // Elsewhere git comes from the system's packages, so a git-for-windows release says nothing about it.
      windows ? githubLatestTag(svc, "git-for-windows", "git") : undefined,
      githubLatestTag(svc, "rust-lang", "rust"),
    ]);

  const nodeIndex = parseNodeIndex(nodeReleases);
  const nodeTarget = nodeUpdateTarget(nodeReleases, node);
  const tools: ToolInfo[] = [
    {
      id: "node",
      label: "Node.js",
      installed: node,
      latest: nodeTarget,
      outdated: isOutdated(node, nodeTarget),
      note: nodeIndex.lts ? `LTS ${nodeIndex.lts}` : undefined,
    },
    {
      id: "pnpm",
      label: "pnpm",
      installed: pnpm,
      latest: pnpmLatest,
      outdated: isOutdated(pnpm, pnpmLatest),
      updateHint: "pnpm self-update",
    },
    {
      id: "npm",
      label: "npm",
      installed: npm,
      latest: npmLatestVersion,
      outdated: isOutdated(npm, npmLatestVersion),
      updateHint: "npm install -g npm@latest",
    },
    { id: "git", label: "Git", installed: git, latest: gitLatest, outdated: isOutdated(git, gitLatest) },
    {
      id: "rustc",
      label: "Rust",
      installed: rustc,
      latest: rustLatest,
      outdated: isOutdated(rustc, rustLatest),
      updateHint: "rustup update stable",
    },
    {
      id: "cargo",
      label: "Cargo",
      installed: cargo,
      latest: rustLatest,
      outdated: isOutdated(cargo, rustLatest),
      updateHint: "rustup update stable",
    },
  ];

  const [globals, wingetRun] = await Promise.all([
    pnpm ? readGlobals(svc) : [],
    windows ? svc.io.run("winget", ["upgrade", "--include-unknown", "--disable-interactivity"]) : undefined,
  ]);
  const snapshot: ToolchainSnapshot = {
    tools,
    globals,
    winget: wingetRun && wingetRun.code !== null ? parseWingetUpgrades(wingetRun.stdout) : [],
    wingetAvailable: Boolean(wingetRun && wingetRun.code !== null),
    updatedAt: new Date().toISOString(),
  };
  await writeSnapshot(svc, "toolchain", snapshot);
  await svc.queryClient.invalidateQueries({ queryKey: ["toolchain"] });
  return snapshot;
}

export const readToolchain = async (svc: Services) => (await readSnapshot<ToolchainSnapshot>(svc, "toolchain"))?.data;

async function readGlobals(svc: Services): Promise<GlobalPackage[]> {
  const [list, outdated] = await Promise.all([
    svc.io.run("pnpm", ["ls", "-g", "--json"]),
    svc.io.run("pnpm", ["outdated", "-g", "--format", "json"]),
  ]);
  return parsePnpmGlobals(list.stdout, outdated.stdout);
}

/** After updating or removing a global package: reads only the globals again, not the whole toolchain. */
export async function refreshGlobals(svc: Services): Promise<void> {
  const [current, globals] = await Promise.all([readToolchain(svc), readGlobals(svc)]);
  if (!current) return;
  await writeSnapshot(svc, "toolchain", { ...current, globals });
  await svc.queryClient.invalidateQueries({ queryKey: ["toolchain"] });
}
