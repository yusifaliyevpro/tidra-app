import { defineConfig } from "greenly";

const cargo = "--manifest-path src-tauri/Cargo.toml";

export default defineConfig({
  name: "Tidra",
  checks: [
    { name: "TypeScript", command: "pnpm tsc --noEmit" },
    { name: "Oxfmt", command: "pnpm fmt:check", onFail: "pnpm fmt" },
    { name: "Oxlint", command: "pnpm lint" },
    { name: "Vitest", command: "pnpm test" },
    { name: "React Doctor", command: "pnpm react-doctor" },
    { name: "Rustfmt", command: `cargo fmt ${cargo} --check`, onFail: `cargo fmt ${cargo}` },
    { name: "Clippy", command: `cargo clippy ${cargo} --all-targets -- -D warnings` },
    { name: "Cargo test", command: `cargo test ${cargo}` },
  ],
});
