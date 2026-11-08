# STYLE.md

Tidra's design system. Tidra is a calm instrument: you open it, it tells you what needs you, you fix it without leaving the row, and you close it. It should feel like a well-made native tool, quiet until something matters and instant when you touch it.

Tokens live in `src/styles/app.css` (`@theme`). Dark is the default; `:root[data-theme="light"]` overrides the same names. Use the Tailwind names (`bg-canvas`, `text-faint`, `rounded-lg`), never raw colors.

## Principles

1. **One question per screen.** Home: what needs me? Projects: which project? Project: what do I do here? If a screen needs a sentence to explain itself, change the layout, not the copy.
2. **Act where you look.** Every row has its actions on hover, in its right-click menu and in the palette. Select several and the bulk bar acts on all of them. Output opens in place. Nothing says "go to another screen".
3. **Keyboard first.** Everything the mouse does, the keyboard does: j/k, x to check, Space to peek, Enter to open, Ctrl+K for anything. Shortcuts show in menus and tooltips, so they teach themselves.
4. **Quiet by default, loud on purpose.** Neutral surfaces, one accent, status color only where it means something. A zero is a ghost. A red number is a problem.
5. **Instant, then smooth.** Clicks respond in under 100 ms with optimistic state; motion only explains what changed. No page transitions.

## Voice

- Sentence case, short, literal. Buttons are verbs with their object: "Update 3 packages", "Sync", "Open in VS Code".
- No subtitles, no helper lines, no marketing, no "Oops", no exclamation marks, no emoji.
- Errors say what to do next: "The working tree has uncommitted changes. Commit or stash them first."
- Empty states are a title plus, at most, one button: "Nothing watched" · Watch packages.
- Setting descriptions only when they change the decision, in a few words ("Matches your CI's audit level"). Prefer no hint over an obvious one.
- Not a website: no hero headers, "Open →" links or cards that only say "all good". Lists and rows.

## Color

| Token                                                   | Dark       | Light     | Use                                                                                              |
| ------------------------------------------------------- | ---------- | --------- | ------------------------------------------------------------------------------------------------ |
| `bg`                                                    | `#09090b`  | `#f2f2f4` | Window ground behind the sidebar; Mica tints through it on Windows                               |
| `canvas`                                                | `#111114`  | `#ffffff` | Inset panel every screen sits on                                                                 |
| `surface`                                               | `#17171b`  | `#ffffff` | Inputs, summary cells, properties panel                                                          |
| `raised`                                                | `#1d1d22`  | `#ffffff` | Menus, palette, dialogs, toasts, bulk bar; always with `line-strong` and a shadow                |
| `hover`                                                 | white 4.5% | ink 4%    | Hover on rows, nav, menu items, quiet buttons. Translucent, so it works on any layer             |
| `selected`                                              | white 8%   | ink 6.5%  | Cursor row, active nav item, pressed filter                                                      |
| `line`                                                  | white 6.5% | ink 7.5%  | Row dividers, header rule, canvas edge                                                           |
| `line-strong`                                           | white 11%  | ink 13%   | Control and floating-layer borders                                                               |
| `fg`                                                    | `#ededf0`  | `#1a1a1f` | Primary text                                                                                     |
| `muted`                                                 | `#9d9da7`  | `#5d5d68` | Secondary text, column headers, inactive nav                                                     |
| `faint`                                                 | `#85858f`  | `#6e6e79` | Meta: repo names, times, counts (≥4.5:1)                                                         |
| `ghost`                                                 | `#3f3f47`  | `#c4c4cc` | Zeros, idle icons. Never text a person must read                                                 |
| `accent`                                                | `#4565e8`  | `#4565e8` | User-configurable. Primary button, checked boxes, selection count. One accent element per screen |
| `accent-hover`, `accent-fg`, `accent-text`, `accent-bg` |            |           | Button hover, text on accent, links, checked rows and review counts (derived with `color-mix`)   |
| `focus`                                                 |            |           | 2px ring, 1px offset, ≥3:1 on every surface                                                      |
| `ok`                                                    | `#4cc38a`  | `#1a7f4e` | Patch, passing CI, up to date                                                                    |
| `warn`                                                  | `#e8ad42`  | `#9a6100` | Minor, moderate advisories, uncommitted work                                                     |
| `bad`                                                   | `#f26b67`  | `#cc3633` | Major, high/critical advisories, failing CI, destructive actions                                 |
| `info`                                                  | `#71a9ff`  | `#2d68d4` | Prereleases, commits ahead, running jobs                                                         |
| `log`                                                   | `#0b0b0d`  | `#f7f7f9` | Terminal output                                                                                  |
| `scrim`                                                 | black 55%  | ink 28%   | Behind dialogs and the palette                                                                   |

- Layers: `bg` → `canvas` → `surface`; `raised` floats above.
- Status colors get a tint for badges (`bg-bad/13` and so on). Status always ships with a word or a shape, never color alone.
- No gradients, glows or decorative color.

## Type

- Geist Variable for everything; Geist Mono Variable with tabular figures for versions, branches, hashes, ports and logs.
- Weights are variable: 420 regular, 540 emphasis (row names), 600 titles. Never 700.

| Style       | Size / line | Weight       | Use                              |
| ----------- | ----------- | ------------ | -------------------------------- |
| display     | 22 / 28     | 600, -0.02em | Project name, once per screen    |
| figure      | 20 / 24     | 560, -0.01em | Home summary numbers, tabular    |
| title       | 14 / 20     | 560          | Header title, dialog title       |
| body        | 13 / 20     | 420          | Rows, buttons, menus, settings   |
| body-strong | 13 / 20     | 540          | Row names, group headers         |
| small       | 12 / 16     | 420          | Meta, chips, column headers      |
| micro       | 11 / 14     | 520          | Badges, counts, kbd              |
| mono        | 12 / 18     | 420          | Versions, branches, hashes, logs |

## Space, shape, size

- Spacing steps 2, 4, 6, 8, 12, 16, 20, 32px: 4 icon-to-count, 6 icon-to-label, 8 between header actions and canvas inset, 12 between row cells, 16 dialog padding, 20 canvas gutter, 32 between Home sections.
- Radius: `sm` 4 (badges, kbd, checkboxes), `md` 6 (buttons, inputs, chips, nav, menu items), `lg` 8 (menus, toasts, panels), `xl` 12 (canvas, dialogs, palette), `full` (glyphs, switches, bars).
- Sizes: controls 28px (24px inside rows and the header), rows 36px, header 44px, toolbar 40px, sidebar 224px (52px collapsed), peek 400px.
- Shadows: `shadow-canvas` (light only), `shadow-pop` (menus, toasts, bulk bar), `shadow-dialog` (dialogs, palette). Nothing bigger.

## Layout

- **Shell:** the sidebar sits on `bg`; every screen lives on the canvas, inset 8px with `rounded-xl`. No separate title bar: the canvas header is the drag region and holds the window buttons.
- **Sidebar:** mark, notifications, Search (Ctrl+K); Home, Projects, Repos, Security, Changelogs, Pull requests; Pinned projects with their status glyph; Tools (Deploys, Packages, Toolchain, Scripts), always shown; Settings at the bottom. Ctrl+B collapses it to icons. Counts only when actionable: `bad` pill for urgent, `accent` for reviews waiting, plain `faint` for routine.
- **Header (44px):** title on the left, or a breadcrumb on detail pages ("Projects / web"). No subtitles. Right side: status pill when relevant (Offline, GitHub limit), view options, secondary actions, the one primary action, window buttons. A 2px progress line runs along its bottom edge during background work; the current job's name shows in the middle.
- **Toolbar (40px):** filter field and filter chips. Chips with zero matches hide. Filter, chip and selection live in the URL.
- **Rows:** 36px, `line` dividers, name in body-strong, one `faint` qualifier, numbers in fixed right-aligned columns. Cursor row `selected`; checked rows `accent-bg`.
- **Peek:** Space opens a 400px panel on the right with the row's detail; arrows keep moving through the list while it stays open.
- **Project page:** breadcrumb, status glyph and name, tabs (Dependencies, Git, Scripts, History, Settings) in the main area, and a properties panel on the right (branch switcher, changes, CI, package manager, checked, remote, Open in VS Code, Open folder, Run checks).

## Motion

| Token   | Duration | Use                                                                       |
| ------- | -------- | ------------------------------------------------------------------------- |
| instant | 80ms     | Hover and pressed fills                                                   |
| fast    | 140ms    | Menus in, toasts, chip toggles, checkbox (`animate-pop-in`)               |
| base    | 200ms    | Dialogs, palette, peek, bulk bar (`animate-dialog-in`, `animate-rise-in`) |
| slow    | 320ms    | Number ticks, bar widths, a row fading out after an update                |

- `ease-out` for anything entering or moving; `ease-in` for exits, at about 70% of the entrance time; `ease-spring` only for switch thumbs and checkbox ticks.
- Menus scale from 0.96 at their trigger's corner; dialogs and the palette fade in from 0.98 and 4px lower; the bulk bar rises 8px. Lists never animate on load.
- Spinners and skeletons wait 250 ms (`appear-late`), so quick loads never flash.
- `prefers-reduced-motion`: keep opacity, drop scale and translate.

## Iconography

- lucide at 16px, stroke 1.5. Idle icons `ghost` (sidebar) or `muted` (buttons); active `fg`.
- Brand marks lucide lacks (VS Code) are one-color inline SVGs in `src/ui` using `currentColor`.
- The Tidra mark is a chevron over a wave, in `fg` and `accent`.

## Components

- **Button:** primary (accent fill) is the action the screen exists for; secondary (surface + border) for everything else; quiet for chrome, Cancel and icon buttons; danger for destructive, always confirmed. Loading keeps the label and width, a spinner replaces the icon. Disabled is 45% opacity and says why in its tooltip. Icon buttons always have `aria-label` and a tooltip. A primary with alternatives is a split button ("Commit & Push" ▾ Commit, Push, Commit to new branch…).
- **Badge:** bumps major `bad`, minor `warn`, patch `ok`, prerelease `info` (shows the channel). Severity critical/high `bad`, moderate `warn`, low neutral. Count pills never show zero. `Kbd` for shortcuts.
- **Status glyph** (`src/ui/status-glyph.tsx`, 14px): one ring whose shape changes with risk, so state reads without color. Up to date: filled `ok` disc with a check. Minor or patch: `warn` ring, half filled. Major: `bad` ring, three quarters filled. Checking: dashed `info` ring, turning. Not checked or no git: `ghost` ring with a slash. It leads every project row, pinned project and peek header, and always has an `aria-label` and tooltip. On Projects it shows update state only; advisories are their own column.
- **List:** j/k move, x checks, Shift+click checks a range, Space peeks, Enter opens, Esc clears. Group headers (repo) are sticky and collapsible with a count. Row actions appear on hover and on the cursor row; the full set is in the right-click menu and ⋯. Wrap each row in `ErrorBoundary`; virtualize past ~200 rows.
- **Bulk bar:** appears when rows are checked, bottom centre of the canvas: count, the primary action named for the selection ("Update 3 projects"), secondary actions, clear (Esc). Shows "2 of 3 done" while it runs.
- **Menu** (`Popover` + `MenuItem`, `src/ui/popover.tsx`): on `raised` with `line-strong` and `shadow-pop`, from ⋯, a split button's chevron or a right click (same items for the same row). 30px items, `muted` icons, shortcuts right-aligned, groups split by a hairline, destructive items last in `bad`. Closes on Esc, outside click, scroll, resize. Popovers flip and shift to stay inside the window.
- **Dialog:** confirmations, short forms and live output, opened where the action started. Title is the question with its count; body says what is and isn't affected in one or two lines; the confirm button repeats the verb, Cancel is quiet. Output dialogs (update, checks, scripts) hold a `Log` and end with the next step in place ("Commit & Push"). A dialog for running work can be closed and brought back from where it started.
- **Toast:** bottom centre, for errors and results out of sight, never for something the screen already shows. Reversible actions get Undo for 6 s; errors stay until dismissed; others fade after 4 s, paused on hover. A full plain sentence.
- **Palette:** Ctrl+K (configurable) opens one box for screens, projects, packages and actions for the current context. A package shows where it is used, with "Update everywhere". Enter runs, Esc closes.
- **Settings rows** (`SettingsGroup` + `SettingRow`, `src/modules/settings/rows.tsx`): label left, control right, hairlines, one pane per category. Controls: Input, Select, Segmented (2–4 exclusive options), Switch, Checkbox, ShortcutInput (recorded, never typed). Settings apply the moment they change; errors replace the description in `bad` and keep the typed value.

## Screens

- **Home:** a summary strip of four numbers (Outdated, Advisories, CI failing, Reviews), each a link, zeros ghosted; then **Needs you**, one row per task ranked by urgency (critical advisories, failing CI, major updates, unpushed work, new major releases of watched packages), each with its verb as a button. Empty: "All clear" and the last check time.
- **Projects:** rows grouped by repo: glyph, name, branch, updates by bump, advisories, time. Filter chips (All, Updates, Advisories, Uncommitted, Unpushed). x checks, the bulk bar acts; Space peeks the outdated packages with an Update button.
- **Project:** dependencies grouped by bump (Major, Minor, Patch), each with its own select-all; rows show `current → latest` in mono with release notes beside the list.
- **Repos:** one row per repository: branch, ahead/behind, uncommitted, CI, outdated actions. Sync on hover; branches from the row menu.
- **Security:** "Fails CI" in `bad` or nothing. Update and override finish where they start, with Commit & Push right there. Dismiss is immediate with Undo.
- **Changelogs:** feeds on the left, notes on the right, selection in the URL. One "Watch" action in the header.
- **Pull requests:** chips Yours, Review requests, Bots, Notifications. Rows show checks, review state and age.
- **First run:** one screen, pick or drop a folder; projects stream in and are checked as they arrive. GitHub and Sync are offered later.

## States

Design every list for all five.

- **Loading:** first load shows skeleton rows at real height after 250 ms; headers and the toolbar render at once. A refresh keeps the old data and uses the header progress line; rows being re-checked show the glyph's dashed ring. Never replace content with a spinner.
- **Empty:** a title centred in the list area, one button only when there is exactly one next step ("No projects" · Add projects; "No matches" · Clear filter). Empty because all is fine says "All clear" once.
- **Error:** screen-level, one `bad` row on top with the message and Retry, last good data below. Row-level, the reason in its tooltip and peek. A failed action keeps its dialog or form open with input kept and toasts the error. Offline or rate-limited is a pill in the header; background work pauses, user actions still try.
- **Success:** visible in place: counts change, the glyph changes, a row that no longer matches the filter fades out. Toast only when the result is out of sight or reversible.
- **Undo and confirm:** reversible (dismiss advisory, unwatch, unpin, hide notification) means no confirm and a 6 s Undo. Irreversible (delete branches, discard changes, delete all data) confirms in a dialog naming what is and isn't affected.
- **Long content:** names truncate with an ellipsis and the full text in a tooltip; branches truncate in the middle; versions never truncate. Logs and notes scroll inside their panel.

## Native behaviour

- Arrow cursor on every control; the I-beam only in text fields. No pointer hands.
- Scroll stops dead at the ends (no rubber-band). Text is selectable only in fields, code, logs and `[data-selectable]`.
- No flashes: the window appears after the first painted frame, and data the first frame needs is prefetched.
- Mouse back/forward and Alt+arrows navigate. Esc closes the top layer, then clears the filter, then goes back.
- Right click on any row opens the same menu as its ⋯ button.
- Dialogs, the palette and menus close on Esc and on a click outside.
- `g` + a letter jumps to a screen.

## Accessibility

- Text meets 4.5:1 on its surface in both themes (3:1 for large text, control borders, focus rings and icons); `ghost` is never text.
- Status always has a shape or a word, not only color.
- Pointer targets at least 24×24; every interactive element is reachable by keyboard, has a visible focus ring and an accessible name.
