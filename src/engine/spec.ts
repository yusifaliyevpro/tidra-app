import semver from "semver";

export type RangeStyle = "caret" | "tilde" | "exact" | "complex";

export type DependencySpec =
  | { kind: "range"; name: string; range: string; style: RangeStyle; alias: boolean }
  | { kind: "tag"; name: string; tag: string; alias: boolean }
  | { kind: "catalog"; catalog: string }
  | { kind: "workspace"; range: string }
  | { kind: "git" | "file" | "link" | "url"; target: string };

const GIT = /^(git\+|git:|github:|gitlab:|bitbucket:|[\w-]+\/[\w.-]+(#.*)?$)/;

/** Parses a dependency value from package.json; `name` is the key it appears under. */
export function parseSpec(name: string, raw: string): DependencySpec {
  const value = raw.trim();
  if (value.startsWith("catalog:")) return { kind: "catalog", catalog: value.slice(8) || "default" };
  if (value.startsWith("workspace:")) return { kind: "workspace", range: value.slice(10) };
  if (value.startsWith("file:")) return { kind: "file", target: value.slice(5) };
  if (value.startsWith("link:") || value.startsWith("portal:")) return { kind: "link", target: value };
  if (/^https?:\/\//.test(value)) return { kind: "url", target: value };
  if (value.startsWith("npm:")) {
    const target = value.slice(4);
    const at = target.lastIndexOf("@");
    const aliased = at > 0 ? target.slice(0, at) : target;
    return withName(aliased, at > 0 ? target.slice(at + 1) : "latest", true);
  }
  if (GIT.test(value)) return { kind: "git", target: value };
  return withName(name, value, false);
}

function withName(name: string, value: string, alias: boolean): DependencySpec {
  const range = value === "" ? "*" : value;
  if (semver.validRange(range) === null || range === "*" || range === "x") {
    return { kind: "tag", name, tag: range, alias };
  }
  return { kind: "range", name, range, style: rangeStyle(range), alias };
}

export function rangeStyle(range: string): RangeStyle {
  if (semver.valid(range)) return "exact";
  if (/^\^\d+(\.\d+){0,2}(-[\w.]+)?$/.test(range)) return "caret";
  if (/^~\d+(\.\d+){0,2}(-[\w.]+)?$/.test(range)) return "tilde";
  return "complex";
}

/** Writes `version` in the same style as `previous`; complex ranges collapse to a caret range. */
export function formatSpec(previous: string, version: string, saveExact: boolean): string {
  if (previous.startsWith("npm:")) {
    const target = previous.slice(4);
    const at = target.lastIndexOf("@");
    const aliased = at > 0 ? target.slice(0, at) : target;
    return `npm:${aliased}@${formatSpec(at > 0 ? target.slice(at + 1) : "", version, saveExact)}`;
  }
  if (previous.startsWith("workspace:")) return previous;
  if (saveExact) return version;
  switch (rangeStyle(previous)) {
    case "exact":
      return version;
    case "tilde":
      return `~${version}`;
    default:
      return `^${version}`;
  }
}
