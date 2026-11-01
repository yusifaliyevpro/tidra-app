# AGENTS.md

Guide for AI agents (and humans) working on Tidra. Read this and [STYLE.md](STYLE.md) before changing code.

## What Tidra is

A desktop app (Tauri 2 + React) that keeps a developer's projects healthy from one place: outdated dependencies (update → run checks → commit, one project or a batch), changelogs between installed and latest versions, security advisories that mirror CI audits, GitHub Actions versions, GitHub inbox / CI / bot PRs, deploys, published-package stats, toolchain updates, scripts and ports, AI breaking-change summaries, and optional end-to-end encrypted sync.

Windows 11 first; macOS and Linux supported. Open source (AGPL-3.0-or-later): the repo must never contain personal data, tokens, paths or default projects. Everything is configured inside the app; secrets live in the OS keychain.

## Commands

Always use `pnpm` / `pnpx`, never npm / npx.

| Command                         | What it does                                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------------------------ |
| `pnpm dev`                      | Run the desktop app (Vite + Tauri)                                                               |
| `pnpm web`                      | UI only in a browser at http://localhost:1420: in-memory SQLite and demo projects under `/demo`  |
| `pnpm build`                    | Signed installers in `src-tauri/target/release/bundle`; needs `.env.local` (see Release signing) |
| `pnpm tauri build`              | Same without loading `.env.local`                                                                |
| `pnpm test` / `pnpm test:watch` | Vitest (projects: `engine` = node for `*.test.ts`, `ui` = jsdom for `*.test.tsx`)                |
| `pnpm fmt`                      | oxfmt (run before `pnpm check`)                                                                  |
| `pnpm check`                    | greenly: tsc, oxfmt check, oxlint, vitest, react-doctor, rustfmt, clippy, cargo test             |
| `pnpm db:generate`              | drizzle-kit migration from `src/core/db/schema.ts` into `drizzle/`                               |

Verification before calling work done: `pnpm fmt && pnpm check`.

## Architecture

```
Routes (TanStack file routes)        src/routes      one file per screen; routeTree.gen.ts is generated and committed
App shell                            src/app         shell, title bar, sidebar, palette, shortcuts, native feel, queries
Feature UI                           src/modules     pieces shared by routes: projects, settings, security, changelog panel
UI kit                               src/ui          Button, fields, Dialog, layout, Log, Markdown, toasts
Services                             src/services    app logic on top of the engine: projects, updates, jobs, sync, reset…
TS core                              src/core        db (Drizzle sqlite-proxy → Rust rusqlite), store, scheduler, secrets, native bridge
TS engine (pure, no Tauri/React)     src/engine      pm, spec, workspace, lockfile, npmrc, registry, outdated, manifest, apply, git,
                                                     changelog, advisories, actions, toolchain, discover
Integrations                         src/integrations github, npm, deploy (Vercel/Netlify/Cloudflare), ai (Vercel AI SDK)
Sync                                 src/sync        provider registry, E2EE vault, HLC, Turso + Supabase providers
Preview                              src/preview     sqlite-wasm driver and demo Io for `pnpm web`
Rust (thin)                          src-tauri/src   db, proc, fs, secrets, ports, tray, app_ready
```

Rules:

- **`src/engine` never imports Tauri or React.** It receives an `Io` (`src/engine/io.ts`); tests pass fakes. Almost all logic should be testable in plain Node.
- **Screens are registered in `src/app/modules.ts`** (sidebar, palette, `g` + key navigation); the screen itself is a file route in `src/routes`.
- **Local-first**: views read SQLite snapshots through TanStack Query (`src/app/queries.ts`); background jobs (`src/services/jobs.ts`) write snapshots and invalidate queries. Rendering never waits on the network.
- **Keep Rust thin.** Add a Rust command only for OS-level needs; prefer official plugins.
- **Every plugin call needs a permission** in `src-tauri/capabilities/default.json`. A missing one rejects at runtime, which during startup blanks the app. Check new `@tauri-apps/*` calls against it.
- **Network** from the webview goes through `@tauri-apps/plugin-http` fetch (no CORS; CSP `connect-src` is IPC only).
- **Validation**: `@zod/mini`. `z.validate()` when only pass/fail + narrowing is needed; `safeParse()` only where the error is shown to the user; `z.compile()` hot schemas once at module level.
- **Secrets** only via `src/core/secrets.ts` (keychain). Never in SQLite, logs or the repo. They sync only inside the encrypted vault.
- **Sync providers** implement `SyncProvider` and register in `src/sync/registry.ts`; they move encrypted envelopes only and never touch crypto.
- **Project identity** is the normalized git remote plus the folder inside the repo (`subdir`), so a monorepo's `apps/*` are separate projects grouped under the repo. Discovery (`src/engine/discover.ts`) walks up to 4 levels and stops at the first `package.json` on each branch.
- **Repo-level views** (git state, CI, Actions workflows, forks) work per repository through `listRepos()` (`src/services/repos.ts`), never per package, so a monorepo shows once.
- **GitHub budget**: every GET goes through the ETag cache (304s are free) and records the rate limit (`src/services/github-limit.ts`, shown on Home). Don't fetch GitHub per package or per project when per repo will do.
- **Notifications**: only news, never a backlog. Advisories notify when a high or critical one is new since the last scan (the first scan just records a baseline), one entry per project. The desktop only gets grouped messages: "You have new high security advisories" and "You have N new notifications". Only notify about fresh events (last 2 days).
- **Fingerprints** (`src/engine/fingerprint.ts`): `loadWorkspace` hashes every input (manifests, workspace yaml, npm config, lockfile) with SHA-256. Unchanged projects reuse the last registry answers for 2 h, security scans skip OSV for 12 h while the lockfile hash matches, Actions scans skip for 6 h while workflow files match, and parsed lockfiles are cached by hash. "Check again" on a project forces a fresh check.
- **Background jobs at launch**: each job's last successful run is kept in `kv` (`jobLastRuns`), so a relaunch only runs what is due. At most three jobs run at once, in the priority order in `src/services/jobs.ts`. A full project refresh shares one set of git calls per checkout (`GitInfoCache`), so a monorepo's packages don't each run git.
- **Reads in bulk**: list screens read snapshots with `readSnapshots` (one query), and background writes call `svc.invalidate(...)`, which coalesces query invalidations so a 30-project refresh rerenders once.
- **Error boundaries**: routes use `RouteError`; panels, chrome and table rows wrap in `ErrorBoundary` (`src/ui/error-boundary.tsx`) so one bad snapshot never blanks a screen. Unhandled promise rejections surface as one toast.
- **Changelogs** cover only what the user watches (packages in the `watchedPackages` setting, repos in `watched_repos`). Nothing is watched automatically.
- **Migrations**: the app is unreleased, so schema changes are still folded into `drizzle/0000_init.sql` (delete `drizzle/`, rerun `pnpm db:generate --name init`). After release, add numbered migrations instead.

## Native feel (desktop rules)

- The window starts hidden. `revealWindow()` (`src/app/native-feel.ts`) calls the `app_ready` command after the first frame with final fonts; Rust shows it then, or after a 5 s fallback. Autostart (`--hidden`) launches stay in the tray. window-state must not restore visibility.
- `installNativeFeel()` blocks browser keys (reload, print, find, zoom, view source, history), the browser context menu outside text, and mouse back/forward. Devtools stay available in dev builds.
- CSS: `overscroll-behavior: none` everywhere (no rubber-band at scroll ends), arrow cursor on controls, no image/link dragging, text selectable only in inputs, code, logs and `[data-selectable]`.
- Spinners fade in after 250 ms (`appear-late`), so quick loads never flash one. Prefetch anything the first frame needs (see the `onboarded` prefetch in `src/main.tsx`).
- Screens outside the shell (onboarding, startup error, crashed route) render inside `Frame` so the title bar and window buttons are always there. Route errors render in place with the shell intact (`RouteError`).

## React Compiler gotchas

- External stores read with `useSyncExternalStore` must return **immutable snapshots** (new array/objects on change). Mutating objects in place and returning the same reference makes the compiler cache stale output (this broke live script output once; see `src/services/processes.ts`).
- No computed object keys that are call expressions (`{ [keyOf(x)]: v }`); hoist them into a helper with a plain parameter.
- If `react-doctor` flags a component as too complex, split it into named subcomponents rather than suppressing the rule.

## Update engine facts (lessons from ripen)

- Package manager: `packageManager` → `devEngines.packageManager` → nearest lockfile walking up → npm.
- "Current" comes from the lockfile, not the range floor (floor is only a fallback, flagged `currentFromLockfile: false`).
- `workspace:` packages are never looked up on npm; `catalog:` ranges come from `pnpm-workspace.yaml`. Non-range specs (`link:`, `file:`, git, `workspace:`) must never reach `semver` range functions.
- Prerelease channel follows its dist-tag (`canary` → `canary`); `@types/node` is major-pinned by default.
- Respect `minimumReleaseAge` (needs full packument `time`; abbreviated metadata has no publish times).
- Never send the abbreviated Accept header to `/<pkg>/latest` (406).
- 0.x: minor bump is breaking; 0.0.x: patch bump is breaking.
- Updates run the package manager's own `add` (`planAddCommands`) in each importer's folder, keeping range prefix, exact pins and dependency field. Tidra only writes catalog entries itself, then installs. Peer ranges are never rewritten.
- pnpm 11+ may write `pnpm-lock.yaml` as two YAML documents (its own lock first); the project's is the last one.
- Catalog/override edits go through the `yaml` Document API to keep comments.
- Retry 429/5xx/network with backoff; always clear abort timers.
- Monorepo release tags (`expo-router@58.0.29`) only appear in Changelogs for packages the user depends on, unless the repo is watched.

## Testing conventions

- Tests live in `tests/`, mirroring `src/` (`tests/engine/spec.test.ts` for `src/engine/spec.ts`). No tests inside `src`.
- `*.test.ts` → node env; `*.test.tsx` → jsdom with Testing Library.
- Engine tests use an in-memory `Io` (`tests/support/memory-io.ts`) and real-shaped fixtures (lockfiles, manifests, registry documents).
- Service and UI tests use real services over in-memory SQLite (`testServices()` in `tests/support/services.ts`) instead of casting partial fakes; fixtures for outdated entries and reports live there too.

## Status

Every feature from the plan is implemented and `pnpm check` is green (~170 TS tests, Rust tests, clippy clean).

Done:

- Engine, core, Rust layer, sync (E2EE vault, Turso, Supabase), integrations, services, preview mode
- All screens: Overview (dashboard: totals, needs-attention table, recent updates, releases, background checks), Projects (filters, branch switcher, grouped by repo), project page, Changelogs, Security (per package), Actions (collapsible per repo), Git, Pull requests, CI, Bot PRs (read-only list), Deploys, My packages, Toolchain, Scripts and ports, Settings (Windows 11 style panes, shortcut recorder, delete all data), onboarding
- Dependency search lives in the palette (Ctrl+P by default, set in Settings): type a package to see where it is used and update it everywhere
- Push and open a PR from Tidra (`BranchActions`); merging stays on GitHub, the app never merges
- An update stopped by its checks leaves changes uncommitted; "Commit & Push" (menu: Commit, Push) commits everything with that run's message (`commitProject`), so nothing is pushed half-done
- Actions updates commit on a `tidra/actions-<date>` branch cut from the default branch (never the current branch); each repo with outdated actions can copy a prompt for a coding agent (`actionsUpdatePrompt`)
- Sync (`syncRepo`, `SyncButton`): fetch, fast-forward a fork's default branch to `upstream`, pull, push; never merges or rebases on its own
- Scripts runs any project's scripts; starting one from a project page or Toolchain opens its live output in a dialog there
- The sidebar resumes each section where it was left (the project tab is in the URL); clicking the current section again goes to its root
- Native feel pass, flash fixes, copy pass
- CI and release workflows, updater signing via `.env.local`
- v0.1.0 released through `release.yml` with signed installers for Windows, macOS and Linux
- Signed installer used day to day: update → checks → commit, push and PR verified on real repos
- README screenshot
- Background update check at launch and every 6 h (`src/app/app-update.tsx`); failures stay silent, a found update shows "Update to x.y.z" beside the search box

Open:

- [ ] In-app updater against a real update: needs the repo to be public (private releases can't be downloaded by installed apps) and a 0.1.1 release; v0.1.0's `latest.json` is verified
- [ ] Sync on a second device, and against Supabase: Turso is connected and syncing on the first device

## Releasing

Bump `version` in `package.json` and push to `main`; that is the whole release. `release.yml` sees the new version (no `v<version>` tag yet), creates a draft release with GitHub's generated notes, builds and signs Windows, macOS (universal) and Linux, uploads installers and `latest.json`, then publishes the release, which creates the tag. Installed apps only see published releases. A failed run leaves a draft that the next run (or "Run workflow") replaces. `package.json` is the only version: `tauri.conf.json` reads it, and the crate version in `Cargo.toml` is a fixed `0.0.0`.

## Release signing

The updater public key is in `src-tauri/tauri.conf.json`. The private key is **not** in the repo (the author keeps a password-protected key at `~/.tauri/tidra.key`). `pnpm build` runs `pnpm --env-file .env.local tauri build`, which loads `TAURI_SIGNING_PRIVATE_KEY` (key path or contents) and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` from a gitignored `.env.local` (see `.env.example`). CI reads the same names from repository secrets; there the key must be the file's contents, not a path.
