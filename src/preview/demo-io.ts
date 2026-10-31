import type { DirEntry, Io, RunResult } from "@/engine/io";
import { dirname, normalize } from "@/engine/path";

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

/** Sample projects for the browser preview. Registry and GitHub calls are real; files and processes are not. */
export const DEMO_FILES: Record<string, string> = {
  "/demo/web-app/package.json": json({
    name: "web-app",
    private: true,
    packageManager: "pnpm@12.17.0",
    scripts: { check: "greenly", dev: "next dev", build: "next build", test: "vitest run" },
    dependencies: { next: "^15.1.0", react: "^19.0.0", "react-dom": "^19.0.0", zod: "^3.24.0" },
    devDependencies: { typescript: "^5.8.0", vitest: "^3.2.0", "@types/node": "^24.0.0", oxlint: "^1.60.0" },
  }),
  "/demo/web-app/pnpm-lock.yaml": `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      next:
        specifier: ^15.1.0
        version: 15.1.0
      react:
        specifier: ^19.0.0
        version: 19.0.0
      react-dom:
        specifier: ^19.0.0
        version: 19.0.0
      zod:
        specifier: ^3.24.0
        version: 3.24.1
    devDependencies:
      '@types/node':
        specifier: ^24.0.0
        version: 24.0.0
      oxlint:
        specifier: ^1.60.0
        version: 1.60.0
      typescript:
        specifier: ^5.8.0
        version: 5.8.2
      vitest:
        specifier: ^3.2.0
        version: 3.2.4

packages:

  next@15.1.0:
    resolution: {integrity: sha512-x}

  react@19.0.0:
    resolution: {integrity: sha512-x}

  react-dom@19.0.0:
    resolution: {integrity: sha512-x}

  zod@3.24.1:
    resolution: {integrity: sha512-x}

  semver@7.5.1:
    resolution: {integrity: sha512-x}

snapshots:

  next@15.1.0:
    dependencies:
      semver: 7.5.1

  react@19.0.0: {}

  react-dom@19.0.0: {}

  zod@3.24.1: {}

  semver@7.5.1: {}
`,
  "/demo/web-app/.github/workflows/ci.yml": `name: CI
on: [pull_request]
jobs:
  checks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - run: pnpm install --frozen-lockfile
      - run: pnpm check
`,
  "/demo/cli-tool/package.json": json({
    name: "cli-tool",
    version: "1.4.0",
    scripts: { build: "tsdown", lint: "oxlint", test: "vitest run" },
    dependencies: { semver: "~7.6.0", yaml: "^2.6.0" },
    devDependencies: { tsdown: "^0.15.0", vitest: "^3.0.0" },
  }),
  "/demo/cli-tool/package-lock.json": json({
    lockfileVersion: 3,
    packages: {
      "": { name: "cli-tool" },
      "node_modules/semver": { version: "7.6.3" },
      "node_modules/yaml": { version: "2.6.1" },
      "node_modules/tsdown": { version: "0.15.0", dev: true },
      "node_modules/vitest": { version: "3.0.5", dev: true },
    },
  }),
};

const DEMO_GIT: Record<string, string> = {
  "/demo/web-app":
    "# branch.oid abc\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +1 -0\n1 .M N... 100644 100644 100644 a b src/app/page.tsx\n",
  "/demo/cli-tool": "# branch.oid def\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +0 -2\n",
};

const DEMO_REMOTES: Record<string, string> = {
  "/demo/web-app": "git@github.com:vercel/next.js.git",
  "/demo/cli-tool": "https://github.com/npm/node-semver.git",
};

const ok = (stdout = ""): RunResult => ({ code: 0, stdout, stderr: "" });
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createDemoIo(): Io {
  const files = new Map(Object.entries(DEMO_FILES).map(([path, text]) => [normalize(path), text]));
  const dirs = () => {
    const set = new Set<string>();
    for (const path of files.keys()) for (let d = dirname(path); d !== dirname(d); d = dirname(d)) set.add(d);
    return set;
  };
  return {
    homeDir: "/home/demo",
    env: {},
    fetch: (input, init) => globalThis.fetch(input, init),
    readText: async (path) => files.get(normalize(path)) ?? null,
    writeText: async (path, contents) => {
      files.set(normalize(path), contents);
    },
    exists: async (path) => files.has(normalize(path)) || dirs().has(normalize(path)),
    readDir: async (path) => {
      const base = normalize(path);
      const children = new Map<string, DirEntry>();
      for (const file of files.keys()) {
        if (!file.startsWith(`${base}/`)) continue;
        const [name, ...rest] = file.slice(base.length + 1).split("/");
        if (name) children.set(name, { name, isDir: rest.length > 0 });
      }
      return [...children.values()];
    },
    async run(program, args, options) {
      const cwd = normalize(options?.cwd ?? "/");
      if (program === "git" && args[0] === "status") return ok(DEMO_GIT[cwd] ?? "# branch.head main\n");
      if (program === "git" && args[0] === "remote")
        return DEMO_REMOTES[cwd] ? ok(DEMO_REMOTES[cwd]) : { code: 2, stdout: "", stderr: "" };
      if (program === "git" && args[0] === "for-each-ref")
        return ok(`main|${Math.floor(Date.now() / 1000)}|\nold-experiment|1700000000|[gone]\n`);
      if (program === "git" && args[0] === "rev-parse") return ok("0f3a9c1\n");
      if (program === "git") return ok();
      // Simulated install and checks so the update flow can be exercised in the browser.
      const lines = [`$ ${program} ${args.join(" ")}`, "Resolving dependencies…", "Done in 1.2s"];
      for (const line of lines) {
        options?.onOutput?.(`${line}\n`, "stdout");
        await sleep(250);
      }
      return ok();
    },
  };
}
