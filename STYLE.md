# STYLE.md

How Tidra code and UI should look. Short version: small, literal, typed, tested, fast.

## Code

- **TypeScript strict** (`noUncheckedIndexedAccess`, `verbatimModuleSyntax`). Use `import type` for types. Path alias `@/` → `src/`.
- **Formatting is oxfmt's job** (120 columns, double quotes). Don't hand-format; run `pnpm fmt`.
- **Comments**: one line, two at most, only for the non-obvious _why_. Never restate what the code says. No banner or block comments.
- **Naming**: say what it is. `computeOutdated`, `parseStatus`, `formatSpec`. No `utils.ts` dumping grounds; put helpers next to their only caller or in a named module.
- **Functions over classes**, except for typed errors (`RegistryError`, `GitError`).
- **Pure first**: parsing, planning and formatting are pure functions with tests; I/O happens at the edges through `Io`.
- **Errors**: throw `Error` subclasses with a message a user can act on ("The working tree has uncommitted changes. Commit or stash them first."). Never swallow errors silently; surface them in the UI.
- **No dead flexibility**: no options nobody passes, no abstractions for one caller. Interfaces exist only where we already have or plan multiple implementations (sync, deploy, AI providers, `Io`).
- **Performance from the start**: dedupe in-flight requests, cache with ETags, limit concurrency, virtualize long lists, avoid re-parsing big files in render.
- **Dependencies**: pinned exact (`saveExact`), latest stable, respecting `minimumReleaseAge`. Prefer the platform (WebCrypto, `fetch`, `structuredClone`) before adding a package.

## React

- **React Compiler is on.** Don't write `useMemo`, `useCallback` or `memo` by hand. If the compiler bails out, fix the code (it usually means a rule-of-React violation).
- Data comes from TanStack Query hooks in `src/modules/<id>/queries.ts`; components don't call `fetch` or `invoke` directly.
- Keep components small; one component per file when it's exported. Co-locate module-only components under the module.
- Effects only for syncing with external systems (subscriptions, IPC channels). Derive everything else during render.
- Accessibility: every interactive element is reachable by keyboard, has a visible focus ring, and an accessible name.

## UI and copy

- **Dark, minimal, dense.** Background `#0b0b0c`; surfaces step up slightly; 1px borders at ~7% white; text `#ededed` / `#8b8b90`; one accent (default cobalt `#3a74d8`).
- **Color means something**: green = patch / passing, amber = minor / warning, red = major / breaking / failing / critical. Nothing decorative.
- No gradients, glows, big shadows, emoji, or illustrations. Icons: lucide, 16px, 1.5 stroke.
- Type: Geist 13px / 20px line height; Geist Mono with tabular numbers for versions, hashes, logs, ports.
- Motion: 120–150ms opacity/transform, respects `prefers-reduced-motion`.
- **Copy is short and literal.** Sentence case. Buttons are verbs ("Update 3 packages", "Open in VS Code"). Empty states say exactly what to do next. No marketing language, no exclamation marks, no "Oops".
- Keyboard first: every list supports j/k, Enter, Space to select, Esc; Ctrl+K opens the palette.

## Rust

- `cargo fmt` + `clippy -D warnings` clean. Commands return `Result<T, String>` with messages fit for the UI.
- Never shell out through a shell; pass argv arrays. Resolve programs with `which` so Windows `.cmd` shims work.

## Tests

- Vitest, in `tests/` mirroring `src/`. Name tests by behaviour (`"keeps devDependencies in devDependencies"`).
- Every bug fix gets a regression test. Fixtures should look like real files (real lockfile shapes, real registry documents trimmed down).
