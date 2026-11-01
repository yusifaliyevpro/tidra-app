# STYLE.md

How Tidra code and UI should look. Short version: small, literal, typed, tested, fast.

## Code

- **TypeScript strict** (`noUncheckedIndexedAccess`, `verbatimModuleSyntax`). Use `import type` for types. Path alias `@/` → `src/`.
- **Formatting is oxfmt's job** (120 columns, double quotes). Don't hand-format; run `pnpm fmt`.
- **Comments**: one line, two at most, only for the non-obvious _why_. Never restate what the code says. No banner or block comments.
- **Naming**: say what it is. `computeOutdated`, `parseStatus`, `formatSpec`. No `utils.ts` dumping grounds; put helpers next to their only caller or in a named module.
- **Functions over classes**, except for typed errors (`RegistryError`, `GitError`).
- **Pure first**: parsing, planning and formatting are pure functions with tests; I/O happens at the edges through `Io`.
- **Errors**: throw `Error` subclasses with a message a user can act on ("The working tree has uncommitted changes. Commit or stash them first."). Anything the user started surfaces its error in the UI. Only background work they didn't ask for (update check, `git fetch` before counting commits) may fail quietly, and it then behaves as "nothing new".
- **No dead flexibility**: no options nobody passes, no abstractions for one caller. Interfaces exist only where we already have or plan multiple implementations (sync, deploy, AI providers, `Io`).
- **Performance from the start**: dedupe in-flight requests, cache with ETags, skip work whose inputs' SHA-256 fingerprint is unchanged, read snapshots in bulk, coalesce query invalidations (`svc.invalidate`), limit concurrency, virtualize long lists, avoid re-parsing big files in render.
- **Dependencies**: pinned exact (`saveExact`), latest stable, respecting `minimumReleaseAge`. Prefer the platform (WebCrypto, `fetch`, `structuredClone`) before adding a package.

## React

- **React Compiler is on.** Don't write `useMemo`, `useCallback` or `memo` by hand. If the compiler bails out, fix the code (it usually means a rule-of-React violation).
- Data comes from TanStack Query hooks (`src/app/queries.ts`) over functions in `src/services`; components don't call `fetch` or `invoke` directly.
- External stores (`useSyncExternalStore`) return immutable snapshots; never mutate an object a component already rendered.
- Keep components small: when a component branches a lot, split it into named subcomponents. Derive flags in a plain function outside the component. Shared feature pieces live in `src/modules`, screen-only ones stay in the route file; non-component helpers go in `src/services` or `src/engine`, not in `.tsx` files.
- Wrap panels, table rows and chrome in `ErrorBoundary` (`src/ui/error-boundary.tsx`) so one bad snapshot can't blank a screen.
- State a user would expect to come back to (tabs, filters, selected item) lives in the URL search params, not `useState`.
- Effects only for syncing with external systems (subscriptions, IPC channels). Derive everything else during render.
- Accessibility: every interactive element is reachable by keyboard, has a visible focus ring, and an accessible name.

## UI and copy

- **Dark, minimal, dense.** Background `#0b0b0c`; surfaces step up slightly; 1px borders at ~7% white; text `#ededed` / `#8b8b90`; one accent (default cobalt `#3a74d8`).
- **Color means something**: green = patch / passing, amber = minor / warning, red = major / breaking / failing / critical. Nothing decorative.
- No gradients, glows, big shadows, emoji, or illustrations. Icons: lucide, 16px, 1.5 stroke. Brand marks lucide lacks (VS Code) are one-color inline SVGs in `src/ui` using `currentColor`.
- Type: Geist 13px / 20px line height; Geist Mono with tabular numbers for versions, hashes, logs, ports.
- Motion: 120–150ms opacity/transform, respects `prefers-reduced-motion`.
- **Copy is short and literal.** Sentence case. Buttons are verbs ("Update 3 packages", "Open in VS Code"). No marketing language, no exclamation marks, no "Oops".
- **No text pollution.** Don't explain what the screen already shows. Empty states are a title ("No workflows"), plus one line only when it tells you what to do. Descriptions under settings are a few words ("Opens in the tray"), not sentences. Prefer no hint over an obvious one.
- **Not a website.** No hero headers, "Open →" links or cards that only say "all good". Lists and rows, like a native app. The one dashboard is Overview: a few tiles with real numbers and thin bars, then tables. When nothing needs attention, say so once ("All clear").
- **Quiet numbers.** Zeros fade (`text-white/15`) instead of repeating "0 major"; counts sit in fixed columns so rows line up. Sidebar counts appear only when there is something to act on.

## Native behaviour

- Arrow cursor on every control; the I-beam only in text fields. No pointer hands.
- Scroll stops dead at the ends (no rubber-band). Text is selectable only in fields, code, logs and `[data-selectable]`.
- No flashes: the window appears after the first painted frame, spinners wait 250 ms, data the first frame needs is prefetched.
- Settings use `SettingsGroup` + `SettingRow` (`src/modules/settings/rows.tsx`): label left, control right, hairline dividers, one pane per category. Shortcuts are recorded (`ShortcutInput`), never typed as accelerator strings.
- Destructive actions confirm in a `Dialog` that says what is and isn't affected.
- Dialogs, the palette and menus close on Esc and on a click outside. Menus and dropdowns use `Popover` + `MenuItem` (`src/ui/popover.tsx`); a primary action with alternatives is a split button ("Commit & Push" ▾ Commit, Push).
- Long-running output (scripts, upgrades) opens in a dialog where it was started, never "see another screen".
- Keyboard first: every list supports j/k, Enter, Space to select, Esc; Ctrl+P (configurable) opens the palette; `g` + a letter jumps to a screen.

## Rust

- `cargo fmt` + `clippy -D warnings` clean. Commands return `Result<T, String>` with messages fit for the UI.
- Never shell out through a shell; pass argv arrays. Resolve programs with `which` so Windows `.cmd` shims work.

## Tests

- Vitest, in `tests/` mirroring `src/`. Name tests by behaviour (`"keeps devDependencies in devDependencies"`).
- Bugs are test-first: write a test that reproduces the bug and fails, then fix it. Features are code-first: build, then cover them with tests.
- Fixtures should look like real files (real lockfile shapes, real registry documents trimmed down).
