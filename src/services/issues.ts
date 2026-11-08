import type { Io } from "@/engine/io";

/** Where Tidra's own issues live. */
export const TIDRA_REPO = "yusifaliyevpro/tidra-app";
/** Screenshots are stored on this branch of the repo, so issues can show them. */
const ASSET_BRANCH = "issue-assets";

export type IssueKind = "bug" | "regression" | "feature";

export const ISSUE_KINDS: { value: IssueKind; label: string; github: string }[] = [
  { value: "bug", label: "Bug", github: "bug" },
  { value: "regression", label: "Regression", github: "regression" },
  { value: "feature", label: "Feature", github: "enhancement" },
];

export type GhState = { state: "missing" } | { state: "signed-out" } | { state: "ready"; user: string };

/** Whether the GitHub CLI is installed and signed in; issues go through it with the user's own account. */
export async function ghState(io: Io): Promise<GhState> {
  const version = await io.run("gh", ["--version"]);
  if (version.code !== 0) return { state: "missing" };
  const user = await io.run("gh", ["api", "user", "--jq", ".login"]);
  return user.code === 0 && user.stdout.trim() ? { state: "ready", user: user.stdout.trim() } : { state: "signed-out" };
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

const tempFile = (io: Io, name: string) => {
  const dir = io.env.TEMP ?? io.env.TMPDIR ?? "/tmp";
  return `${dir.replace(/[\\/]$/, "")}/${name}`;
};

async function gh(io: Io, args: string[]) {
  const result = await io.run("gh", args);
  if (result.code !== 0) throw new Error((result.stderr || result.stdout).trim() || `gh ${args[0]} failed`);
  return result.stdout.trim();
}

/** The description as it is sent: screenshot references point at uploaded files, or are dropped when there are none. */
export function issueBody(draft: IssueDraft, env: Environment, urls: Map<string, string>): string {
  let body = draft.body.trim();
  for (const shot of draft.screenshots) {
    const url = urls.get(shot.name);
    const ref = new RegExp(`!\\[([^\\]]*)\\]\\(${shot.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\)`, "g");
    body = url ? body.replace(ref, `![$1](${url})`) : body.replace(ref, "");
  }
  const kind = ISSUE_KINDS.find((k) => k.value === draft.kind)?.label ?? draft.kind;
  return `${body.trim()}\n\n---\n**Type:** ${kind} · **Tidra** ${env.version} · ${env.platform}\n`;
}

/** Pushes screenshots to the asset branch; only people who can push to the repo can, others attach them on GitHub. */
async function uploadScreenshots(io: Io, screenshots: Screenshot[]): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  if (screenshots.length === 0) return urls;
  const canPush = await io.run("gh", ["api", `repos/${TIDRA_REPO}`, "--jq", ".permissions.push"]);
  if (canPush.stdout.trim() !== "true") return urls;
  const branch = await io.run("gh", ["api", `repos/${TIDRA_REPO}/branches/${ASSET_BRANCH}`, "--jq", ".name"]);
  if (branch.code !== 0) {
    const base = await gh(io, ["api", `repos/${TIDRA_REPO}`, "--jq", ".default_branch"]);
    const sha = await gh(io, ["api", `repos/${TIDRA_REPO}/git/ref/heads/${base}`, "--jq", ".object.sha"]);
    await gh(io, [
      "api",
      "-X",
      "POST",
      `repos/${TIDRA_REPO}/git/refs`,
      "-f",
      `ref=refs/heads/${ASSET_BRANCH}`,
      "-f",
      `sha=${sha}`,
    ]);
  }
  const folder = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*$/, "");
  for (const shot of screenshots) {
    const path = `issues/${folder}/${shot.name}`;
    const input = tempFile(io, "tidra-issue-upload.json");
    const content = shot.dataUrl.slice(shot.dataUrl.indexOf(",") + 1);
    await io.writeText(input, JSON.stringify({ message: `Screenshot ${shot.name}`, content, branch: ASSET_BRANCH }));
    await gh(io, ["api", "-X", "PUT", `repos/${TIDRA_REPO}/contents/${path}`, "--input", input]);
    urls.set(shot.name, `https://github.com/${TIDRA_REPO}/blob/${ASSET_BRANCH}/${path}?raw=true`);
  }
  return urls;
}

/** Opens the issue on GitHub with the user's gh account and returns its URL, and whether screenshots still need adding. */
export async function createIssue(
  io: Io,
  draft: IssueDraft,
  env: Environment,
): Promise<{ url: string; screenshotsLeft: boolean }> {
  const title = draft.title.trim();
  if (!title) throw new Error("Give the issue a title.");
  const urls = await uploadScreenshots(io, draft.screenshots);
  const bodyFile = tempFile(io, "tidra-issue-body.md");
  await io.writeText(bodyFile, issueBody(draft, env, urls));
  const base = ["issue", "create", "-R", TIDRA_REPO, "--title", title, "--body-file", bodyFile];
  const label = ISSUE_KINDS.find((k) => k.value === draft.kind)?.github;
  // Labels that don't exist on the repo fail the whole command; the type is in the body either way.
  const labeled = label ? await io.run("gh", [...base, "--label", label]) : undefined;
  const url = labeled?.code === 0 ? labeled.stdout.trim() : await gh(io, base);
  return { url: url.split(/\r?\n/).at(-1) ?? url, screenshotsLeft: urls.size < draft.screenshots.length };
}
