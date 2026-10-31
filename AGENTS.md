# AGENTS.md

Guide for AI agents (and humans) working on Tidra. Read this and [STYLE.md](STYLE.md) before changing code.
The full approved plan lives in `C:\Users\yusif\.claude\plans\wiggly-prancing-rainbow.md` on the author's machine; this file is the in-repo summary.

## What Tidra is

A desktop app (Tauri 2 + React) that keeps a developer's projects healthy from one place: outdated dependencies (update → run checks → commit), changelogs between installed and latest versions, security advisories that mirror CI audits, GitHub Actions versions, GitHub inbox / CI / bot PRs, deploys, published-package stats, toolchain updates, scripts and ports, AI breaking-change summaries, and optional end-to-end encrypted sync.

Windows 11 first; macOS and Linux supported. Open source: the repo must never contain personal data, tokens, paths or default projects. Everything is configured inside the app; secrets live in the OS keychain.

## Commands

Always use `pnpm` / `pnpx`, never npm / npx.

| Command                         | What it does                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------- |
| `pnpm dev`                      | Run the desktop app (Vite + Tauri)                                                                |
| `pnpm web`                      | Run only the UI in a browser at http://localhost:1420 with mocked IPC (fast UI work, screenshots) |
| `pnpm build`                    | Production installers (`src-tauri/target/release/bundle`)                                         |
| `pnpm test` / `pnpm test:watch` | Vitest (projects: `engine` = node, `ui` = jsdom)                                                  |
| `pnpm fmt`                      | oxfmt (run before `pnpm check`)                                                                   |
| `pnpm check`                    | greenly: tsc, oxfmt check, oxlint, vitest, react-doctor, rustfmt, clippy, cargo test              |
| `pnpm db:generate`              | drizzle-kit migration from `src/core/db/schema` into `drizzle/`                                   |

Verification before calling work done: `pnpm fmt && pnpm check`.

## Architecture

```
React UI (Vite HMR, React Compiler)   src/app, src/modules/*, src/ui, src/routes
TS core                               src/core   db (Drizzle sqlite-proxy → tauri-plugin-sql), jobs, http cache, secrets, proc, events
TS engine (pure, no Tauri imports)    src/engine pm/spec/workspace/lockfile/npmrc/registry/outdated/manifest/apply/git/changelog/advisories/actions
Integrations                          src/integrations github, vercel, netlify, cloudflare, npm, ai
Sync                                  src/sync   provider registry, E2EE vault, HLC, Turso + Supabase providers
Rust (small, rarely changes)          src-tauri  proc spawn/stream/kill, fs, keychain, ports, tray, plugins
```

Rules:

- **`src/engine` never imports Tauri or React.** It receives an `Io` (`src/engine/io.ts`); tests pass fakes. Almost all logic should be testable in plain Node.
- **Modules are self-contained** (`src/modules/<id>/index.ts` exports `defineModule(...)`); the shell builds sidebar, palette commands, Home cards and background jobs from the registry.
- **Local-first**: views read SQLite through TanStack Query; jobs write to the DB and emit events; rendering never waits on the network.
- **Keep Rust thin.** Add a Rust command only for OS-level needs. Prefer official plugins. App commands are in `src-tauri/src/{proc,fs,secrets,ports,tray}.rs`.
- **Network** from the webview goes through `@tauri-apps/plugin-http` fetch (no CORS, CSP `connect-src` is IPC only).
- **Validation**: `@zod/mini`. Use `z.validate()` when only pass/fail + narrowing is needed; `safeParse()` only where the error is shown to the user; `z.compile()` hot schemas once at module level.
- **Secrets** only via `src/core/secrets.ts` (keychain). Never in SQLite, logs or the repo. They sync only inside the encrypted vault.
- **Sync providers** implement `SyncProvider` and register in `src/sync/registry.ts`; they move encrypted envelopes only and never touch crypto.

## Update engine facts (lessons from ripen)

- Package manager: `packageManager` → `devEngines.packageManager` → nearest lockfile walking up → npm.
- "Current" comes from the lockfile, not the range floor (floor is only a fallback, flagged `currentFromLockfile: false`).
- `workspace:` packages are never looked up on npm; `catalog:` ranges come from `pnpm-workspace.yaml`.
- Prerelease channel follows its dist-tag (`canary` → `canary`); `@types/node` is major-pinned by default.
- Respect `minimumReleaseAge` (needs full packument `time`; abbreviated metadata has no publish times).
- Never send the abbreviated Accept header to `/<pkg>/latest` (406).
- 0.x: minor bump is breaking; 0.0.x: patch bump is breaking.
- Writes keep formatting, range prefix, `saveExact`, and dependency field (devDependencies stay dev). Peer ranges are never rewritten.
- Catalog/override edits go through the `yaml` Document API to keep comments.
- Retry 429/5xx/network with backoff; always clear abort timers.

## Testing conventions

- Tests live in `tests/`, mirroring `src/` (`tests/engine/spec.test.ts` for `src/engine/spec.ts`). No tests inside `src`.
- `*.test.ts` → node env; `*.test.tsx` → jsdom with Testing Library.
- Engine tests use an in-memory `Io` (`tests/support/memory-io.ts`) and real-shaped fixtures (lockfiles, manifests, registry documents).
- Mock Tauri IPC with `mockIPC` from `@tauri-apps/api/mocks`.

## Progress

Implementation order from the plan; update this list as phases land.

- [x] 1. Scaffold: package.json, toolchain configs, Tauri config/capabilities, brand assets and icons
- [x] 2. Core
  - [x] Rust: `db.rs` (rusqlite, rows as arrays; replaced tauri-plugin-sql), proc, fs (+ `app_env`), secrets (keyring 3), ports, tray — clippy clean
  - [x] `src/core/db` (schema, sqlite-proxy client, migrations from `drizzle/`), `store.ts`, `scheduler.ts`, `native.ts` (Tauri Io, spawn, fetch), `secrets.ts`, `src/sync/hlc.ts` — tested
  - [x] integrations: `github.ts`, `npm.ts`, `deploy.ts` (Vercel/Netlify/Cloudflare registry), `ai.ts` (Vercel AI SDK: Anthropic + OpenAI-compatible)
  - [x] services (`src/services`): context, snapshot cache, projects, updates, changelogs, security, actions, github-feed, deploys, packages, toolchain, processes, ai, sync, notify, home, jobs
  - [x] sync: crypto, vault (Argon2id + AES-GCM, recovery key, connection code), engine (LWW by HLC, secrets included), Turso + Supabase providers — tested with two simulated devices
  - [x] preview mode: `src/preview` (sqlite-wasm driver, demo projects Io)
  - [x] UI kit, shell, routes for every module, settings, onboarding
- [x] 3. Engine: io, path, limit, spec, versions, npmrc, registry, lockfile, workspace, outdated, manifest, pm, git, apply, changelog, advisories, actions — all tested (`tests/engine`)
- [x] 4. Projects module (update → checks → commit; batch mode via `startBatch`, two projects at a time)
- [x] 5. Changelogs
- [x] 6. Security, Actions versions, Dependency search, Git overview
- [x] 7. GitHub: inbox, CI, bot PRs
- [x] 8. Deploys, My packages, Toolchain, Scripts and ports
- [x] 9. AI summary
- [x] 10. Sync (HLC, vault, Turso, Supabase)
- [x] 11. Home, palette, tray, notifications, hotkey, autostart, updater
- [x] CI and release workflows, AGPL-3.0 license
- [x] UI tests (`tests/ui`): controls, markdown sanitizing, dependency selection
- [ ] Split the six components React Doctor flags as complex (ProjectPage, Home, sync ConnectForm, Changelogs, UpdateRunDialog, ChangelogPanel)
- [ ] End-to-end run of the real app (`pnpm dev`) on throwaway repos, then `pnpm build` and install

## Release signing

The updater public key is in `src-tauri/tauri.conf.json`. The private key is **not** in the repo (author keeps it at `~/.tauri/tidra.key`, password protected). Locally, `pnpm build` loads `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` from a gitignored `.env.local` (see `.env.example`); CI reads the same names from repository secrets.
