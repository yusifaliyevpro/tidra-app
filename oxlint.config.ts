import { defineConfig } from "oxlint";

export default defineConfig({
  plugins: ["typescript", "unicorn", "oxc", "import", "jsx-a11y", "react", "react-perf", "vitest"],
  categories: {
    suspicious: "warn",
    correctness: "warn",
  },
  options: {
    typeAware: true,
    typeCheck: true,
  },
  ignorePatterns: ["dist", "src-tauri/target", "src-tauri/gen", "src/routeTree.gen.ts", "drizzle", "coverage"],
  rules: {
    eqeqeq: "warn",
    "no-throw-literal": "warn",
    "import/no-unassigned-import": ["warn", { allow: ["**/*.css", "@fontsource-variable/**"] }],
    "unicorn/prefer-node-protocol": "warn",
    "react/react-in-jsx-scope": "off",
    "typescript/consistent-type-imports": "warn",
  },
});
