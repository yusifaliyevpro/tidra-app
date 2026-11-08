# Contributing

Thanks for helping with Tidra. Read [AGENTS.md](AGENTS.md) (architecture, rules, how to debug the running app) and [STYLE.md](STYLE.md) (design system and copy) first; they apply to people and coding agents alike.

## Reporting bugs and ideas

Open an issue on GitHub, or use **Report an issue** inside Tidra (Settings, the palette, or Ctrl+Shift+B), which files it through the GitHub CLI with screenshots attached. Say what you did, what you expected and what happened. Mark it as a bug, a regression (it used to work) or a feature.

## Setup

- Node 24+, pnpm (see `packageManager` in `package.json`), Rust stable, and the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your OS.
- `pnpm install`, then `pnpm dev` to run the desktop app.

The dev app uses the same database and keychain as an installed Tidra, so close the installed one first, and remember that anything you click there really runs (git, pnpm, GitHub).

## Making a change

1. Branch off `main`.
2. Bugs are test-first: write a test that reproduces it, watch it fail, then fix. Features are code-first, then covered by tests. Tests live in `tests/`, mirroring `src/`.
3. Verify in the real app with `pnpm dev` (and `pnpm cdp` to inspect it), never only in `pnpm web` or a browser.
4. While working, run the narrow checks you need (`pnpm tsc`, `pnpm lint`, `pnpm test <file>`). Before you push: `pnpm fmt && pnpm check`.
5. Open a pull request with a short description of what changed and why. Keep one topic per PR.

## Conventions

- `pnpm` / `pnpx` only, never npm / npx. Dependencies are pinned exact.
- Commit messages follow Conventional Commits (`fix:`, `feat:`, `chore(deps):`).
- No personal data, tokens, paths or default projects in the repo; secrets live in the OS keychain.
- Schema changes are new numbered migrations (`pnpm db:generate --name <what>`).

## License

By contributing you agree that your work is licensed under AGPL-3.0-or-later, like the rest of Tidra.
