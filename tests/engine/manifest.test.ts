import { describe, expect, it } from "vitest";
import { detectFormatting, editCatalogs, editJsonOverrides, editManifest, editYamlOverrides } from "@/engine/manifest";

describe("editManifest", () => {
  it("changes only the value and keeps key order, indentation and trailing newline", () => {
    const before =
      '{\n    "name": "app",\n    "dependencies": {\n        "zod": "^4.6.0",\n        "react": "^18.3.1"\n    }\n}\n';
    const after = editManifest(before, [{ field: "dependencies", name: "react", value: "^19.3.1" }]);
    expect(after).toBe(before.replace("^18.3.1", "^19.3.1"));
  });

  it("keeps CRLF line endings and tabs", () => {
    const before = '{\r\n\t"devDependencies": {\r\n\t\t"vite": "8.3.4"\r\n\t}\r\n}';
    const after = editManifest(before, [{ field: "devDependencies", name: "vite", value: "8.3.5" }]);
    expect(after).toBe(before.replace("8.3.4", "8.3.5"));
  });

  it("keeps devDependencies in devDependencies", () => {
    const before = JSON.stringify({ dependencies: { a: "1.0.0" }, devDependencies: { b: "1.0.0" } }, null, 2);
    const parsed = JSON.parse(editManifest(before, [{ field: "devDependencies", name: "b", value: "2.0.0" }]));
    expect(parsed).toEqual({ dependencies: { a: "1.0.0" }, devDependencies: { b: "2.0.0" } });
  });

  it("detects indentation", () => {
    expect(detectFormatting('{\n  "a": 1\n}')).toMatchObject({ insertSpaces: true, tabSize: 2, eol: "\n" });
    expect(detectFormatting('{\n\t"a": 1\n}')).toMatchObject({ insertSpaces: false });
  });
});

describe("editCatalogs", () => {
  const yaml = [
    "packages:",
    "  - apps/*",
    "",
    "# shared versions",
    "catalog:",
    "  zod: ^4.6.0 # validation",
    "  react: ^19.0.0",
    "catalogs:",
    "  legacy:",
    "    react: ^18.3.0",
    "",
  ].join("\n");

  it("edits the default and named catalogs while keeping comments", () => {
    const after = editCatalogs(yaml, [
      { catalog: "default", name: "zod", value: "^4.6.7" },
      { catalog: "legacy", name: "react", value: "^18.3.1" },
    ]);
    expect(after).toContain("# shared versions");
    expect(after).toContain("zod: ^4.6.7 # validation");
    expect(after).toContain("    react: ^18.3.1");
    expect(after).toContain("  react: ^19.0.0");
  });

  it("edits a default catalog declared under catalogs.default", () => {
    const after = editCatalogs("catalogs:\n  default:\n    zod: ^4.0.0\n", [
      { catalog: "default", name: "zod", value: "^4.6.7" },
    ]);
    expect(after).toBe("catalogs:\n  default:\n    zod: ^4.6.7\n");
  });
});

describe("overrides", () => {
  it("adds pnpm overrides to pnpm-workspace.yaml", () => {
    expect(editYamlOverrides("packages:\n  - .\n", [{ name: "semver", value: "^7.5.2" }])).toBe(
      "packages:\n  - .\noverrides:\n  semver: ^7.5.2\n",
    );
  });

  it("adds npm overrides and yarn resolutions to package.json", () => {
    const text = '{\n  "name": "a"\n}\n';
    expect(JSON.parse(editJsonOverrides(text, "overrides", [{ name: "semver", value: "^7.5.2" }]))).toEqual({
      name: "a",
      overrides: { semver: "^7.5.2" },
    });
    expect(
      JSON.parse(editJsonOverrides(text, "resolutions", [{ name: "semver", value: "^7.5.2" }])).resolutions,
    ).toEqual({
      semver: "^7.5.2",
    });
  });
});
