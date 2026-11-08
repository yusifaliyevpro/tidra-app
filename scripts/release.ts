// pnpm release patch|minor   bumps the version in package.json and the README's download links.
// Pushing that to main is the release (AGENTS.md, Releasing). Majors are rare and done by hand.
import { readFileSync, writeFileSync } from "node:fs";

export type Bump = "patch" | "minor";

export function nextVersion(version: string, bump: Bump): string {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`package.json has version "${version}", which isn't x.y.z.`);
  const [major, minor, patch] = [Number(match[1]), Number(match[2]), Number(match[3])];
  return bump === "minor" ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`;
}

/** Only the top-level "version" field changes, so the file keeps its formatting and other "version" keys. */
export function bumpPackageJson(text: string, from: string, to: string): string {
  const field = `\n  "version": "${from}",`;
  if (!text.includes(field)) throw new Error(`Couldn't find "version": "${from}" in package.json.`);
  return text.replace(field, `\n  "version": "${to}",`);
}

/** Release files carry the version in their tag and names, so every download link moves along. */
export function bumpReadme(text: string, from: string, to: string): string {
  let links = 0;
  const next = text.replace(/releases\/download\/[^"\s)]+/g, (link) => {
    links++;
    return link.replaceAll(from, to);
  });
  if (links === 0) throw new Error("The README has no download links to update.");
  return next;
}

function main() {
  const bump = process.argv[2];
  if (bump !== "patch" && bump !== "minor") {
    console.error("Usage: pnpm release patch|minor");
    process.exit(1);
  }
  const pkgPath = new URL("../package.json", import.meta.url);
  const readmePath = new URL("../README.md", import.meta.url);
  const pkg = readFileSync(pkgPath, "utf8");
  const from = /\n {2}"version": "([^"]+)",/.exec(pkg)?.[1];
  if (!from) throw new Error("package.json has no version.");
  const to = nextVersion(from, bump);
  writeFileSync(pkgPath, bumpPackageJson(pkg, from, to));
  writeFileSync(readmePath, bumpReadme(readFileSync(readmePath, "utf8"), from, to));
  console.log(`${from} → ${to}. Commit and push to main to release:`);
  console.log(`  git commit -am "chore: release ${to}" && git push`);
}

if (import.meta.main) main();
