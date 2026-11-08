# AGENTS.md

Guide for AI agents (and humans) working on Tidra. Read this before changing code, and [STYLE.md](STYLE.md) (the design system) before changing UI.

## What Tidra is

A desktop app (Tauri 2 + React) that keeps a developer's projects healthy from one place: outdated dependencies (update → run checks → the user commits, one project or a batch), changelogs between installed and latest versions, security advisories that mirror CI audits, GitHub Actions versions, GitHub inbox / CI / bot PRs, deploys, published-package stats, toolchain updates, scripts and ports, AI breaking-change summaries, and optional end-to-end encrypted sync.

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
| `pnpm cdp`                      | Read or screenshot the running dev app (see Debugging the running app)                           |

Verification before calling work done: `pnpm fmt && pnpm check`.

## Debugging the running app

**Never test or verify anything with `pnpm web` or in a browser. Always use the dev app (`pnpm dev`).** The web preview only has demo data and no Tauri, so it proves nothing about the real app.

When a bug only shows in the real app (stale UI, a job that never ends), look at it instead of guessing. Run `pnpm dev` with the webview's debug port open:

1. Close the installed Tidra first: the dev app uses the **same database and keychain**, so it shows the user's real projects, and anything you click there really runs (git, pnpm, GitHub).
2. Start it in the background: `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 pnpm dev` (WebView2 is Windows; the variable does nothing elsewhere). Wait until `http://127.0.0.1:9222/json` lists a `localhost:1420` page; the first Rust build takes a few minutes.
3. Drive it with `pnpm cdp`:
   - `pnpm cdp eval "<expression>"` runs in the page and prints the JSON result. `window.__app` is the `ServicesProvider` value (`{ svc, processes }`), e.g. `pnpm cdp eval "__app.svc.scheduler.states()"`, `"__app.svc.queryClient.getQueryData(['jobs'])"`, or click something: `"[...document.querySelectorAll('a')].find(a => a.textContent === 'Toolchain').click()"`.
   - `pnpm cdp shot <file.png>` saves a screenshot; read the PNG to see what the user sees. Comparing it with `eval` output is how stale-UI bugs show up (state says done, screen still spins).
4. Code edits hot-reload; `pnpm cdp eval "location.reload()"` restarts the frontend (it reruns migrations and job registration), Rust edits rebuild on their own.
5. Clean up: stopping `pnpm dev` can leave its `vite` (port 1420) and `tidra.exe` running, and the next start then fails with "Port 1420 is already in use". Find the owner (`netstat -ano | grep :1420`, then its command line) and stop it only if it is from this repo and you started it; the user may be running their own dev app.

Clipboard writes fail from `eval` ("Document is not focused") because the window isn't focused; a real click works.

Write a new migration's SQL before the dev app can see the file: `pnpm db:generate --custom` creates an empty file, Vite hot-reloads, and the running app records the empty migration as applied in the user's real database.

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
- **Keep Rust thin.** Add a Rust command only for OS-level needs; prefer official plugins. A sync `#[tauri::command]` runs on the main thread and freezes the window while it works, so anything that blocks (SQLite, keychain, spawning a tool) uses `#[tauri::command(async)]`.
- **Every plugin call needs a permission** in `src-tauri/capabilities/default.json`. A missing one rejects at runtime, which during startup blanks the app. Check new `@tauri-apps/*` calls against it.
- **Network** from the webview goes through Rust's `http_fetch` (`src-tauri/src/http.rs`, wrapped as `io.fetch` in `src/core/native.ts`): one IPC call per request, a pooled client (about 3x faster on GitHub than the HTTP plugin, which opened a new connection each time), https only (plain http just to this machine, for Ollama, Verdaccio and local sqld), no CORS (CSP `connect-src` is IPC only). It sends a `User-Agent`; GitHub answers 403 without one.
- **Validation**: `@zod/mini`. `z.validate()` when only pass/fail + narrowing is needed; `safeParse()` only where the error is shown to the user; `z.compile()` hot schemas once at module level.
- **Secrets** only via `src/core/secrets.ts` (keychain). Never in SQLite, logs or the repo. They sync only inside the encrypted vault.
- **Sync providers** implement `SyncProvider` and register in `src/sync/registry.ts`; they move encrypted envelopes only and never touch crypto.
- **Project identity** is the normalized git remote plus the folder inside the repo (`subdir`), so a monorepo's `apps/*` are separate projects grouped under the repo. Discovery (`src/engine/discover.ts`) walks up to 4 levels and stops at the first `package.json` on each branch.
- **Repo-level views** (git state, CI, Actions workflows, forks) work per repository through `listRepos()` (`src/services/repos.ts`), never per package, so a monorepo shows once.
- **GitHub budget**: every GET goes through the ETag cache (304s are free). Home shows the budget from GitHub's free `/rate_limit` endpoint (`src/modules/github-limit.tsx`) only when fewer than 1,000 requests are left; it is polled each minute and after every background job. Don't fetch GitHub per package or per project when per repo will do.
- **Notifications**: only news, never a backlog. Advisories notify when a high or critical one is new since the last scan (the first scan just records a baseline), one entry per project. The desktop only gets grouped messages: "You have new high security advisories" and "You have N new notifications". Only notify about fresh events (last 2 days).
- **Registry**: npm documents of popular packages run to tens of MB. Rust downloads them compressed and trims them to the fields Tidra reads (`http_fetch` with `packument`, mirrored by `trimPackument` for tests and `pnpm web`), and only the trimmed copy is cached. A package whose installed version equals its `latest` dist-tag skips the document entirely. Answers are shared for a minute, so one pass over all projects asks once per package.
- **Fingerprints** (`src/engine/fingerprint.ts`): `loadWorkspace` hashes every input (manifests, workspace yaml, npm config, lockfile) with SHA-256. Unchanged projects reuse the last registry answers for 2 h, security scans skip OSV for 12 h while the lockfile hash matches, Actions scans skip for 6 h while workflow files match, and parsed lockfiles are cached by hash. "Check again" on a project forces a fresh check.
- **Background jobs at launch**: each job's last successful run is kept in `kv` (`jobLastRuns`), so a relaunch only runs what is due. At most three jobs run at once, in the priority order in `src/services/jobs.ts`. A full project refresh shares one set of git calls per checkout (`GitInfoCache`), so a monorepo's packages don't each run git; each checkout's git state waits only for its own `git fetch` (origin and upstream only), while registry work runs alongside. Background fetches are skipped when GitHub's branch heads (one ETag-cached request per remote, `remotesUnchanged`) already match `refs/remotes`: an SSH fetch spends ~2 s on the handshake alone. Sync and other user actions always fetch. Screens with Sync buttons fetch in the background when they open and when the window regains focus, at most once a minute per checkout, so counts stay current (`useFreshGit`, `fetchProject`). Only one fetch runs per checkout; a second caller joins it (`createGit().fetch`).
- **Git actions show at once**: a switch, sync, pull or branch delete writes the checkout's git state into its reports (`writeGitState`) and refreshes the screen before reporting success. The registry never holds one up: a full refresh follows in the background when the working tree moved (`refreshInBackground`). A newer refresh always wins; an older one finishing later doesn't write.
- **Reads in bulk**: list screens read snapshots with `readSnapshots` (one query), and background writes call `svc.invalidate(...)`, which coalesces query invalidations so a 30-project refresh rerenders once.
- **Error boundaries**: routes use `RouteError`; panels, chrome and table rows wrap in `ErrorBoundary` (`src/ui/error-boundary.tsx`) so one bad snapshot never blanks a screen. Unhandled promise rejections surface as one toast.
- **Changelogs** cover only what the user watches (packages in the `watchedPackages` setting, repos in `watched_repos`). Nothing is watched automatically.
- **Migrations**: the app is released, so every schema change is a new numbered migration (`pnpm db:generate --name <what>`); never edit an applied one. Columns other devices may still sync stay until no released version writes them.

## Native feel (desktop rules)

- The window starts hidden. `revealWindow()` (`src/app/native-feel.ts`) calls the `app_ready` command after the first frame with final fonts; Rust shows it then, or after a 5 s fallback. Autostart (`--hidden`) launches stay in the tray. window-state must not restore visibility.
- `installNativeFeel()` blocks browser keys (reload, print, find, zoom, view source, history), and the browser context menu outside text. Mouse back/forward and Alt+arrows navigate the app's own history (`useHistoryButtons` in `src/app/shell.tsx`). Devtools stay available in dev builds.
- CSS: `overscroll-behavior: none` on `html`/`body` only (no rubber-band; on every element it would stop nested lists passing the scroll to the page), `overscroll-contain` on dialogs, menus and the palette, arrow cursor on controls, no image/link dragging, text selectable only in inputs, code, logs and `[data-selectable]`.
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

## Code style

### Code

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

### React

- **React Compiler is on.** Don't write `useMemo`, `useCallback` or `memo` by hand. If the compiler bails out, fix the code (it usually means a rule-of-React violation).
- Data comes from TanStack Query hooks (`src/app/queries.ts`) over functions in `src/services`; components don't call `fetch` or `invoke` directly.
- External stores (`useSyncExternalStore`) return immutable snapshots; never mutate an object a component already rendered.
- Keep components small: when a component branches a lot, split it into named subcomponents. Derive flags in a plain function outside the component. Shared feature pieces live in `src/modules`, screen-only ones stay in the route file; non-component helpers go in `src/services` or `src/engine`, not in `.tsx` files.
- Wrap panels, table rows and chrome in `ErrorBoundary` (`src/ui/error-boundary.tsx`) so one bad snapshot can't blank a screen.
- State a user would expect to come back to (tabs, filters, selected item) lives in the URL search params, not `useState`.
- Effects only for syncing with external systems (subscriptions, IPC channels). Derive everything else during render.
- Accessibility: every interactive element is reachable by keyboard, has a visible focus ring, and an accessible name.

### Rust

- `cargo fmt` + `clippy -D warnings` clean. Commands return `Result<T, String>` with messages fit for the UI.
- Never shell out through a shell; pass argv arrays. Resolve programs with `which` so Windows `.cmd` shims work.

## Testing conventions

- Vitest. Name tests by behaviour (`"keeps devDependencies in devDependencies"`); fixtures look like real files (real lockfile shapes, trimmed registry documents).
- A test that reproduces a known bug nobody fixes yet is `it.fails`, with a comment saying what's wrong; it turns red once the bug is gone, and then becomes a plain `it`. In Rust the same pin is `#[should_panic(expected = "...")]`.
- CI only runs on Windows, so `#[cfg(not(windows))]` and `#[cfg(unix)]` Rust isn't compiled there. After changing such code, compile it some other way before pushing: this broke the macOS release once.
- **Bugs are test-first.** When a bug is reported or found, first write a test that reproduces it and watch it fail, then fix the code until it passes. The test stays as the regression test.
- **Features are code-first.** For a new feature, build it, then write tests that cover its behaviour before calling it done.
- Tests live in `tests/`, mirroring `src/` (`tests/engine/spec.test.ts` for `src/engine/spec.ts`). No tests inside `src`.
- `*.test.ts` → node env; `*.test.tsx` → jsdom with Testing Library.
- Engine tests use an in-memory `Io` (`tests/support/memory-io.ts`) and real-shaped fixtures (lockfiles, manifests, registry documents).
- Where git's own behaviour is the point (`tests/services/repos-git.test.ts`), tests run real git on throwaway repositories through `tests/support/node-io.ts`.
- Service and UI tests use real services over in-memory SQLite (`testServices()` in `tests/support/services.ts`) instead of casting partial fakes; fixtures for outdated entries and reports live there too.

## Status

Released as 1.x. `pnpm check` is green (TS tests, Rust tests, clippy clean). UI rules and tokens: [STYLE.md](STYLE.md).

Done:

- Engine, core, Rust layer, sync (E2EE vault, Turso, Supabase), integrations, services, preview mode
- All screens: Home (summary strip and a ranked "Needs you" list, one action per row), Projects (filters, grouped by repo, peek with Space, multi-select with x and a bulk bar, right-click menu), project page (properties panel), Repos (git, CI and workflow actions per repo; replaces Git, CI and Actions), Changelogs, Security (dismiss with Undo), Pull requests (Yours, Review requests, Bots, Notifications), Deploys, Packages, Toolchain, Scripts and ports, Settings (Appearance: theme and accent), one-screen onboarding
- Design system: dark and light themes on the same token names (`src/styles/app.css`), the inset canvas shell, `StatusGlyph` for project state, motion tokens; spec in the Tidra design system artifact
- Dependency search lives in the palette (Ctrl+K by default, set in Settings): type a package to see where it is used and update it everywhere
- Push and open a PR from Tidra (`BranchActions`); merging stays on GitHub, the app never merges
- Updates always run on the current branch; the user decides each time where the work goes. Commit & Push commits there, and its menu's "Commit to new branch…" moves the work to a named branch (`tidra/deps-<date>` by default), commits and pushes it. Open PR shows only off the default branch, once it has commits the base doesn't and no pull request exists. Push shows when commits only go out; Sync (with the incoming count) when something comes in, and pushes on the way. The branch picker offers a new auto-named branch (`freshBranchName`). Updates run beside other uncommitted work: files already edited stay out of the update's commit (`otherWork`), and Revert puts package files edited before the update back as they were (`restore`), not as HEAD has them. Revert restores every tracked file the update changed (`git diff HEAD`), including files the package manager rewrote on its own, such as `pnpm-workspace.yaml`. They never commit, push or open a PR on their own: they stop after the checks. "Commit & Push" (menu: Commit, Push) commits everything with the latest uncommitted run's message (`commitProject`), and "Run checks" reruns the project's checks in an output dialog (update dialog and project page)
- Actions updates commit on a `tidra/actions-<date>` branch cut from the default branch (never the current branch); each repo with outdated actions can copy a prompt for a coding agent (`actionsUpdatePrompt`)
- Security overrides don't commit either: they record a run whose message Commit uses (`fixWithOverride`)
- PR bodies list each package with its versions (`pullBody`), taken from the commit bodies
- Commit subjects and PR titles for several packages name them riskiest first and count the rest (`bumpSubject`): `chore(deps): bump next, oxfmt and 9 more`. PR titles someone wrote by hand are kept
- Sync (`syncRepo`, `SyncButton`): fetch origin and upstream (never `--all`, a contributor's deleted fork would fail it), fast-forward a fork's default branch to `upstream`, take origin's commits with a local `merge --ff-only` (a `git pull` would connect a second time), push, update an open PR's description; never merges or rebases on its own
- Repos page: a repo's row menu opens its branches (`BranchesDialog`) with a merged icon (squash merges included), delete per branch and Delete all. Unmerged branches and Delete all confirm first. The current and default branch can't be deleted, and copies on a remote stay
- Closing an output dialog (update, script, upgrade) while it runs leaves a chip in the header that brings it back (`dismissedWork`, `DismissedWorkChips`)
- Report an issue (Ctrl+Shift+B, the palette, Settings): files a bug, regression or feature on this repo with the user's GitHub CLI (`src/services/issues.ts`); pasted screenshots are uploaded with `gh issue create --attach` (gh 2.103+; the dialog asks older versions to update, and the issue then opens on GitHub to add them). The body is a checked Type list, the description, then the version, OS, behaviour-changing settings and the session's recent errors the user left checked (errors may hold private data, so each can be unchecked). Read new work from those issues with `gh issue list -R yusifaliyevpro/tidra-app`
- A version younger than `minimumReleaseAge` but offered because the package is in `minimumReleaseAgeExclude` shows a clock with the reason (`newerThanReleaseAge`)
- The project glyph shows update state only; advisories are their own column and screen
- Popovers stay inside the window (shift, then flip above the trigger)
- Scripts runs any project's scripts; starting one from a project page or Toolchain opens its live output in a dialog there
- The sidebar resumes each section where it was left (the project tab is in the URL); clicking the current section again goes to its root
- Native feel pass, flash fixes, copy pass
- CI and release workflows, updater signing via `.env.local`
- Releases (1.0.0 onward) go through `release.yml` with signed installers for Windows, macOS and Linux
- Signed installer used day to day: update → checks → commit, push and PR verified on real repos
- README screenshot
- Background update check at launch and every 6 h (`src/app/app-update.tsx`); failures stay silent, a found update shows "Update to x.y.z" beside the search box

Open:

- [ ] In-app updater against a real update: needs the repo to be public (private releases can't be downloaded by installed apps) and a 0.1.1 release; v0.1.0's `latest.json` is verified
- [ ] Sync on a second device, and against Supabase: Turso is connected and syncing on the first device

## Releasing

Bump `version` in `package.json`, update the README's download links to the same version (`tests/readme.test.ts` fails until they match) and push to `main`; that is the whole release. `release.yml` sees the new version (no `v<version>` tag yet), creates a draft release with GitHub's generated notes, builds and signs Windows, macOS (universal) and Linux, uploads installers and `latest.json`, then publishes the release, which creates the tag. Installed apps only see published releases. A failed run leaves a draft that the next run (or "Run workflow") replaces. `package.json` is the only version: `tauri.conf.json` reads it, and the crate version in `Cargo.toml` is a fixed `0.0.0`.

## Release signing

The updater public key is in `src-tauri/tauri.conf.json`. The private key is **not** in the repo (the author keeps a password-protected key at `~/.tauri/tidra.key`). `pnpm build` runs `pnpm --env-file .env.local tauri build`, which loads `TAURI_SIGNING_PRIVATE_KEY` (key path or contents) and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` from a gitignored `.env.local` (see `.env.example`). CI reads the same names from repository secrets; there the key must be the file's contents, not a path.
