import type { Io } from "@/engine/io";
import { join } from "@/engine/path";

/** Where Tidra's own issues live. */
export const TIDRA_REPO = "yusifaliyevpro/tidra-app";

export type IssueKind = "bug" | "regression" | "feature";

export const ISSUE_KINDS: { value: IssueKind; label: string; github: string }[] = [
  { value: "bug", label: "Bug", github: "bug" },
  { value: "regression", label: "Regression", github: "regression" },
  { value: "feature", label: "Feature", github: "enhancement" },
];

export type GhState =
  | { state: "missing" }
  | { state: "signed-out" }
  /** `attach`: this gh can upload screenshots (`gh issue create --attach`, from `GH_ATTACH_VERSION`). */
  | { state: "ready"; user: string; version: string; attach: boolean };

/** The first gh release with `gh issue create --attach`. */
export const GH_ATTACH_VERSION = "2.103.0";

/** Whether the GitHub CLI is installed and signed in; issues go through it with the user's own account. */
export async function ghState(io: Io): Promise<GhState> {
  const version = await io.run("gh", ["--version"]);
  if (version.code !== 0) return { state: "missing" };
  const [user, help] = await Promise.all([
    io.run("gh", ["api", "user", "--jq", ".login"]),
    io.run("gh", ["issue", "create", "--help"]),
  ]);
  if (user.code !== 0 || !user.stdout.trim()) return { state: "signed-out" };
  return {
    state: "ready",
    user: user.stdout.trim(),
    version: /gh version (\S+)/.exec(version.stdout)?.[1] ?? "unknown",
    attach: help.stdout.includes("--attach"),
  };
}

export interface Screenshot {
  /** The name the description refers to, `screenshot-1.png`. */
  name: string;
  /** `data:image/png;base64,…` */
  dataUrl: string;
}

export interface IssueDraft {
  title: string;
  body: string;
  kind: IssueKind;
  screenshots: Screenshot[];
}

export interface Environment {
  version: string;
  platform: string;
}

const tempDir = (io: Io) => join(io.env.TEMP ?? io.env.TMPDIR ?? "/tmp", "tidra-issue");

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The description as it is sent. Screenshot references become `./name` paths, which `gh --attach` swaps for the
 * uploaded files; without attachments they are dropped.
 */
export function issueBody(draft: IssueDraft, env: Environment, attached: boolean): string {
  let body = draft.body.trim();
  for (const shot of draft.screenshots) {
    const ref = new RegExp(`!\\[([^\\]]*)\\]\\(${escapeRegExp(shot.name)}\\)`, "g");
    body = body.replace(ref, attached ? `![$1](./${shot.name})` : "");
  }
  const kind = ISSUE_KINDS.find((k) => k.value === draft.kind)?.label ?? draft.kind;
  return `${body.trim()}\n\n---\n**Type:** ${kind} · **Tidra** ${env.version} · ${env.platform}\n`;
}

const bytesOf = (dataUrl: string) =>
  Uint8Array.from(atob(dataUrl.slice(dataUrl.indexOf(",") + 1)), (char) => char.charCodeAt(0));

const issueUrl = (stdout: string) => /https:\/\/github\.com\/\S+\/issues\/\d+/.exec(stdout)?.[0];

/** Opens the issue on GitHub with the user's gh account; returns its URL and whether screenshots still need adding. */
export async function createIssue(
  io: Io,
  draft: IssueDraft,
  env: Environment,
  options: { attach: boolean },
): Promise<{ url: string; screenshotsLeft: boolean }> {
  const title = draft.title.trim();
  if (!title) throw new Error("Give the issue a title.");
  const dir = tempDir(io);
  const attach = options.attach && draft.screenshots.length > 0;
  const files: string[] = [];
  if (attach) {
    for (const shot of draft.screenshots) {
      const path = `${dir}/${shot.name}`;
      await io.writeBytes(path, bytesOf(shot.dataUrl));
      files.push("--attach", `${path}#${shot.name.replace(/\.\w+$/, "")}`);
    }
  }
  const bodyFile = `${dir}/body.md`;
  await io.writeText(bodyFile, issueBody(draft, env, attach));
  const base = ["issue", "create", "-R", TIDRA_REPO, "--title", title, "--body-file", bodyFile, ...files];
  const label = ISSUE_KINDS.find((k) => k.value === draft.kind)?.github;

  // Labels that don't exist on the repo fail the whole command; the type is in the body either way.
  let result = label ? await io.run("gh", [...base, "--label", label]) : undefined;
  if (!result || (result.code !== 0 && !issueUrl(result.stdout))) result = await io.run("gh", base);
  const url = issueUrl(result.stdout);
  if (!url) throw new Error((result.stderr || result.stdout).trim() || "gh couldn't open the issue.");
  // gh still creates the issue when some uploads fail, and then exits non-zero.
  const screenshotsLeft = draft.screenshots.length > 0 && (!attach || result.code !== 0);
  return { url, screenshotsLeft };
}
