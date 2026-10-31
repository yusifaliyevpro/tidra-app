<p align="center">
  <img src="assets/brand/wordmark.svg" alt="Tidra" height="72" />
</p>

<p align="center">Keep every project you maintain up to date, from one desktop app.</p>

---

Tidra watches the projects on your machine and tells you what needs attention: outdated dependencies, what changed upstream, security advisories, failing CI, pull requests waiting for you, and broken deploys. When it's time to update, it edits your manifests, installs, runs your checks and commits, without opening an editor.

> Status: early development. Not ready for daily use yet.

## Features

- **Projects**: add folders, see branch, local changes and outdated packages grouped by major / minor / patch. Pick updates, Tidra installs on a new branch, runs your `check` script (or typecheck / lint / test) and commits.
- **Changelogs**: release notes between the version you have installed and the latest, with breaking changes flagged.
- **Security**: advisories for your installed dependency tree, with a "would fail CI" badge that mirrors `pnpm audit --prod --audit-level high`, and one-click fixes.
- **GitHub Actions versions**: outdated `uses:` refs in your workflows, updated the same way as packages.
- **Dependency search**: which projects use a package, at which versions; align them in one go.
- **Git overview**, **GitHub inbox**, **CI status**, **Dependabot / Renovate PRs**.
- **Deploys** (Vercel, Netlify, Cloudflare Pages), **My packages** (npm downloads, stars, issues), **Toolchain** updates, **Scripts and ports**.
- **AI summaries** of breaking changes with your own API key (optional).
- **Sync** across devices through your own Turso or Supabase database, end-to-end encrypted with your vault password (optional).
- Tray icon, background checks, native notifications, global hotkey, Ctrl+K command palette.

Works with pnpm, npm, yarn (classic and berry) and bun projects, including workspaces and pnpm catalogs.

## Privacy

There is no Tidra server and no telemetry. Tokens you add are stored in your operating system's keychain. If you turn on sync, everything is encrypted on your device before it leaves; your database only ever sees ciphertext.

## Development

Requirements: Node 24+, pnpm 12, Rust (stable), and the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your OS.

```bash
pnpm install
pnpm dev        # desktop app with hot reload
pnpm web        # UI only, in the browser, with mocked native calls
pnpm test
pnpm fmt && pnpm check
```

See [AGENTS.md](AGENTS.md) for architecture and [STYLE.md](STYLE.md) for conventions.

## License

[AGPL-3.0-or-later](LICENSE)
