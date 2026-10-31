import type { Manifest, PackageManager } from "./workspace";

export interface Command {
  program: string;
  args: string[];
}

export function display(command: Command): string {
  return [command.program, ...command.args.map((a) => (/[\s"]/.test(a) ? JSON.stringify(a) : a))].join(" ");
}

export function installCommand(pm: PackageManager): Command {
  return { program: pm.name, args: ["install"] };
}

export function scriptCommand(pm: PackageManager, script: string): Command {
  return { program: pm.name, args: ["run", script] };
}

export function auditCommand(pm: PackageManager, prodOnly: boolean): Command {
  const prod = (flags: string[]) => (prodOnly ? flags : []);
  if (pm.name === "pnpm") return { program: "pnpm", args: ["audit", "--json", ...prod(["--prod"])] };
  if (pm.name === "npm") return { program: "npm", args: ["audit", "--json", ...prod(["--omit=dev"])] };
  if (pm.name === "bun") return { program: "bun", args: ["audit", "--json"] };
  return pm.yarnBerry
    ? { program: "yarn", args: ["npm", "audit", "--json", ...prod(["--environment", "production"])] }
    : { program: "yarn", args: ["audit", "--json", ...prod(["--groups", "dependencies"])] };
}

/** Splits a user-entered command line into argv, honouring single and double quotes. */
export function parseCommandLine(line: string): Command | undefined {
  const tokens: string[] = [];
  let current = "";
  let quote: string | undefined;
  let started = false;
  for (const char of line.trim()) {
    if (quote) {
      if (char === quote) quote = undefined;
      else current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (/\s/.test(char)) {
      if (started) tokens.push(current);
      current = "";
      started = false;
    } else {
      current += char;
      started = true;
    }
  }
  if (started) tokens.push(current);
  const [program, ...args] = tokens;
  return program ? { program, args } : undefined;
}

export interface Check {
  label: string;
  command: Command;
}

const FALLBACK_SCRIPTS = ["typecheck", "type-check", "lint", "test"];

/** A `check` script wins (greenly-style projects); otherwise typecheck, lint and test scripts in that order. */
export function detectChecks(pm: PackageManager, manifest: Manifest): Check[] {
  const scripts = manifest.scripts ?? {};
  if (scripts.check) return [{ label: "check", command: scriptCommand(pm, "check") }];
  return FALLBACK_SCRIPTS.filter((name) => scripts[name] && !/no test specified/.test(scripts[name] ?? "")).map(
    (name) => ({ label: name, command: scriptCommand(pm, name) }),
  );
}

export function checksFromLines(lines: string[]): Check[] {
  return lines.flatMap((line) => {
    const command = parseCommandLine(line);
    return command ? [{ label: line.trim(), command }] : [];
  });
}
