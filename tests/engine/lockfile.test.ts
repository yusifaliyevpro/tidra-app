import { describe, expect, it } from "vitest";
import { parseBunLock, parseNpmLock, parsePnpmLock, parseYarnLock } from "@/engine/lockfile";

const PNPM = `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      react:
        specifier: ^19.0.0
        version: 19.3.1
    devDependencies:
      vite:
        specifier: 8.3.5
        version: 8.3.5(@types/node@26.6.6)

  packages/ui:
    dependencies:
      shared:
        specifier: workspace:*
        version: link:../shared
      zod:
        specifier: 'catalog:'
        version: 4.6.7

packages:

  '@types/node@26.6.6':
    resolution: {integrity: sha512-a}

  react@19.3.1:
    resolution: {integrity: sha512-b}

  vite@8.3.5:
    resolution: {integrity: sha512-c}

  esbuild@0.30.0:
    resolution: {integrity: sha512-d}

  zod@4.6.7:
    resolution: {integrity: sha512-e}

snapshots:

  '@types/node@26.6.6': {}

  react@19.3.1: {}

  vite@8.3.5(@types/node@26.6.6):
    dependencies:
      esbuild: 0.30.0

  esbuild@0.30.0: {}

  zod@4.6.7: {}
`;

describe("parsePnpmLock", () => {
  const lock = parsePnpmLock(PNPM);

  it("reads installed versions per importer without peer suffixes", () => {
    expect(lock.installed(".", "react")).toBe("19.3.1");
    expect(lock.installed(".", "vite")).toBe("8.3.5");
    expect(lock.installed("packages/ui", "zod")).toBe("4.6.7");
  });

  it("reads the project document when pnpm puts its own lock first", () => {
    const env =
      "---\nlockfileVersion: '9.0'\n\nimporters:\n\n  .:\n    configDependencies: {}\n    packageManagerDependencies:\n      pnpm:\n        specifier: '>=12.11.0'\n        version: 12.14.0\n\npackages:\n\n  '@pnpm/exe@12.14.0':\n    resolution: {integrity: sha512-x}\n\n";
    const both = parsePnpmLock(`${env}---\n${PNPM}`);
    expect(both.installed(".", "react")).toBe("19.3.1");
    expect(both.packages.some((p) => p.name === "@pnpm/exe")).toBe(false);
    expect(both.packages.some((p) => p.name === "react")).toBe(true);
  });

  it("ignores workspace links", () => {
    expect(lock.installed("packages/ui", "shared")).toBeUndefined();
  });

  it("marks packages only reachable from devDependencies as dev", () => {
    const dev = Object.fromEntries(lock.packages.map((p) => [p.name, p.dev]));
    expect(dev).toMatchObject({ react: false, zod: false, vite: true, esbuild: true, "@types/node": true });
  });
});

describe("parseNpmLock", () => {
  const lock = parseNpmLock(
    JSON.stringify({
      lockfileVersion: 3,
      packages: {
        "": { name: "root" },
        "node_modules/react": { version: "19.3.1" },
        "node_modules/vitest": { version: "5.0.5", dev: true },
        "packages/a": { name: "a" },
        "packages/a/node_modules/react": { version: "18.3.1" },
        "node_modules/a": { resolved: "packages/a", link: true },
        "node_modules/@scope/pkg": { version: "1.0.0" },
      },
    }),
  );

  it("prefers the importer's nested copy, then the hoisted one", () => {
    expect(lock.installed("packages/a", "react")).toBe("18.3.1");
    expect(lock.installed("packages/b", "react")).toBe("19.3.1");
    expect(lock.installed(".", "@scope/pkg")).toBe("1.0.0");
  });

  it("lists the tree with dev flags and skips links", () => {
    expect(lock.packages).toContainEqual({ name: "vitest", version: "5.0.5", dev: true });
    expect(lock.packages.map((p) => p.name)).not.toContain("a");
  });
});

describe("parseYarnLock", () => {
  it("reads classic lockfiles", () => {
    const lock = parseYarnLock(`# yarn lockfile v1

"@babel/core@^7.0.0", "@babel/core@^7.20.0":
  version "7.26.0"
  resolved "https://registry.yarnpkg.com/@babel/core/-/core-7.26.0.tgz"

react@^18.0.0:
  version "18.3.1"
`);
    expect(lock.installed(".", "@babel/core", "^7.20.0")).toBe("7.26.0");
    expect(lock.installed(".", "react", "^18.0.0")).toBe("18.3.1");
    expect(lock.packages).toHaveLength(2);
  });

  it("reads berry lockfiles", () => {
    const lock = parseYarnLock(`__metadata:
  version: 8

"react@npm:^19.0.0":
  version: 19.3.1
  resolution: "react@npm:19.3.1"
`);
    expect(lock.installed(".", "react", "^19.0.0")).toBe("19.3.1");
    expect(lock.packages.map((p) => p.name)).toEqual(["react"]);
  });
});

describe("parseBunLock", () => {
  it("reads top-level packages and skips nested duplicates", () => {
    const lock = parseBunLock(`{
  "lockfileVersion": 1,
  "workspaces": { "": { "dependencies": { "react": "^19.0.0" } } },
  "packages": {
    "react": ["react@19.3.1", "", {}, "sha512-x"],
    "@types/node": ["@types/node@26.6.6", "", {}, "sha512-y"],
    "old/react": ["react@18.3.1", "", {}, "sha512-z"],
  },
}`);
    expect(lock.installed(".", "react")).toBe("19.3.1");
    expect(lock.installed(".", "@types/node")).toBe("26.6.6");
    expect(lock.packages).toHaveLength(3);
  });
});

describe("lockfile edge cases", () => {
  it("returns nothing for unknown importers and packages", () => {
    const lock = parsePnpmLock(PNPM);
    expect(lock.installed("apps/missing", "react")).toBeUndefined();
    expect(lock.installed(".", "not-installed")).toBeUndefined();
  });

  it("reads pnpm lockfiles from older pnpm that list packages without snapshots", () => {
    const lock = parsePnpmLock(
      "lockfileVersion: '6.0'\nimporters:\n  .:\n    dependencies:\n      react:\n        specifier: ^18.0.0\n        version: 18.2.0\npackages:\n  /react@18.2.0:\n    resolution: {integrity: sha512-a}\n",
    );
    expect(lock.installed(".", "react")).toBe("18.2.0");
    expect(lock.packages).toEqual([{ name: "react", version: "18.2.0", dev: false }]);
  });

  it("tolerates an empty pnpm lockfile", () => {
    expect(parsePnpmLock("").packages).toEqual([]);
  });

  it("throws on a corrupt npm lockfile, which the workspace loader turns into no lockfile", () => {
    expect(() => parseNpmLock("{ not json")).toThrow(SyntaxError);
  });

  it("reads yarn entries only for the spec the manifest uses", () => {
    const lock = parseYarnLock(
      'react@^18.0.0, react@^18.2.0:\n  version "18.2.0"\n\nreact@^17.0.0:\n  version "17.0.2"\n',
    );
    expect(lock.installed(".", "react", "^17.0.0")).toBe("17.0.2");
    expect(lock.installed(".", "react", "^18.0.0")).toBe("18.2.0");
    expect(lock.installed(".", "react")).toBeUndefined();
  });

  it("skips bun workspace packages", () => {
    const lock = parseBunLock(
      '{ "packages": { "ui": ["ui@workspace:packages/ui"], "zod": ["zod@4.0.0", "", {}, "sha"] } }',
    );
    expect(lock.packages.map((p) => p.name)).toEqual(["zod"]);
    expect(lock.installed(".", "ui")).toBeUndefined();
  });
});
