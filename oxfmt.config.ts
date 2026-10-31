import { defineConfig } from "oxfmt";

export default defineConfig({
  printWidth: 120,
  singleQuote: false,
  insertFinalNewline: true,
  ignorePatterns: ["src/routeTree.gen.ts", "drizzle/**", "src-tauri/gen/**", "pnpm-lock.yaml"],
  sortTailwindcss: {
    stylesheet: "./src/styles/app.css",
    functions: ["cn"],
  },
  sortImports: {
    newlinesBetween: false,
    internalPattern: ["@/"],
  },
});
