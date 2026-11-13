# IOTO Dashboard (Obsidian community plugin)

## Project overview

- Obsidian Community Plugin (TypeScript → bundled JavaScript), plugin id `ioto-dashboard`.
- Entry point: `src/main.ts` bundled to `main.js` (plugin root) and loaded by Obsidian.
- Release artifacts: `main.js`, `manifest.json`, and optional `styles.css`.
- UI languages: English, Simplified Chinese, Traditional Chinese (follows Obsidian's locale).

## Environment & tooling

- Node.js: use current LTS (CI matrix runs 20.x and 22.x).
- Package manager: npm (see `package.json` scripts).
- Bundler: esbuild 0.25 (`esbuild.config.mjs`): CJS output, `target: es2018`, `obsidian` / `electron` / `@codemirror/*` / `@lezer/*` / Node builtins externalized, inline sourcemap in dev, minified in production.
- Type checking: TypeScript 5.8 via `tsc -noEmit -skipLibCheck` (part of `npm run build`). `tsconfig.json` enables `strictNullChecks`, `noImplicitAny`, `noImplicitReturns`, `noUncheckedIndexedAccess`, `useUnknownInCatchVariables`, `isolatedModules`.
- Linting: ESLint 9 flat config (`eslint.config.mts`) with `eslint-plugin-obsidianmd` recommended rules.
- Unit tests: Node built-in test runner + `jiti` (loads `.ts` sources directly, no build step).

## Common commands

### Install

```bash
npm install
```

### Dev (watch)

Writes `main.js` to the plugin root with inline sourcemaps.

```bash
npm run dev
```

### Production build

Runs TypeScript typecheck then bundles/minifies to `main.js`.

```bash
npm run build
```

### Lint

```bash
npm run lint
```

### Test

```bash
npm test                                  # node --test tests/**/*.test.mjs
node --test tests/lang-helpers.test.mjs    # single file
```

### One-shot release (GitHub + Gitee)

```bash
npm run build:deploy -- --dry-run         # preview only, no side effects
npm run build:deploy                      # build + zip + tag + release on both hosts
npm run build:deploy -- --github-only     # skip Gitee
npm run build:deploy -- --notes "..."     # custom release note
npm run build:deploy -- --force           # overwrite existing tag/release
```

## Repository layout

- `src/main.ts`: plugin lifecycle, view registration, ribbon icons, commands, settings load/save.
- `src/settings.ts`: settings types/defaults, `SavedQuery` / `CustomFilter` models, `DashboardSettingTab` (tabbed UI).
- `src/views/DashboardView.ts`: three-column dashboard (Input / Output / Outcome).
- `src/views/TaskView.ts`: task-centric view (aggregates tasks from the task folder).
- `src/views/NoteView.ts`: note-centric view (Input / Output / Outcome notes only).
- `src/views/components/`: `LeftSidebar` (category nav / saved queries), `MiddleSection` (list, sort, group, pagination, quick search), `RightSidebar` (filters).
- `src/ui/`: reusable UI (modals, `pickers/` folder & property pickers, `tabbed-settings`).
- `src/lang/`: `helpers.ts` (`t()`) and `locale/` dictionaries (`en`, `zh-cn`, `zh-tw`).
- `src/models/`: `constants.ts` (view types) and `types.ts` (shared models + Obsidian module augmentation).
- `src/services/`: `ioto-settings-services.ts` (read-only bridge to the `ioto-settings` plugin).
- `tests/`: unit tests + `tests/stubs/obsidian.mjs` runtime stub.
- `scripts/deploy-release.mjs`: cross-plugin GitHub + Gitee release script.
- `.github/workflows/lint.yml`: CI (npm ci → build → lint on Node 20/22).
- `styles.css`: all plugin styling, scoped under `.ioto-dashboard-view`.
- `notes.md`: plain release-note text, passed explicitly via `npm run build:deploy -- --notes-file ./notes.md` (the script does not read it automatically; without a note it derives one from `git log`).

Notes:

- `tsconfig.json` sets `"baseUrl": "src"`, so bare imports like `ui/tabbed-settings` resolve from `src/` (esbuild honors the same `baseUrl`). The test setup must replicate this with a `'ui/'` alias because `jiti` ignores `tsconfig`.
- `main.js` and `data.json` are generated/ignored by git; do not commit build outputs or local settings.

## Architecture conventions

- View types are constants in `src/models/constants.ts` (`ioto-dashboard-view`, `ioto-task-view`, `ioto-note-view`) and must be used in `registerView` / `setViewState` — never hard-code the strings.
- The three views share the `LeftSidebar` / `MiddleSection` / `RightSidebar` components; pass callbacks in, do not let components reach back into the view.
- Data refresh: views react to `metadataCache.on("changed")` and `vault.on("delete")` through 500 ms debounced handlers that invalidate the project/status/subject caches before re-filtering.
- Task aggregation: tasks are collected from list items nested under the headings returned by `getTargetHeader()`. Heading text comes from the `ioto-settings` plugin (`LTDList{Input,Output,Outcome}SectionHeading`) and falls back to the localized `TDL_*_HEADING` strings.
- Task write-back is line-index based (`task.line`): toggle rewrites the `- [ ]` checkbox in place, delete splices the line. After toggling, update local state and re-filter — do **not** call `refreshFiles()`, because `metadataCache` updates asynchronously and would revert the UI.
- View state is persisted through `getState()` / `setState()`: `DashboardView` and `NoteView` keep category, tab, sort/group, active saved query and zen mode; `TaskView` keeps only zen mode and the active query. Call `workspace.requestSaveLayout()` after state-changing actions so the layout survives reload.
- Custom Dashboard storage (`src/dashboard/`): the `dashboardStore` namespace is `schemaVersion: 4` — `dashboards[]` (each with `pages[]` + `lastPageId`) is the top level, `queries[]` stays global. `normalize()` migrates by shape: legacy v3 `pages[]` → one default dashboard; v2 `dashboards[]` entries that only have `components` → an appended default dashboard. Loading migrates in memory only and must not write. Page methods take `pageId` first; `addPage` takes the target `dashboardId` first; `removePage` refuses to delete a dashboard's last page; `removeDashboard` refuses the last dashboard. `CustomDashboardView` keeps its own `leafDashboardId` + `leafPageId` and persists both via `getState()` / `setState()` (old `activePageId` state is still accepted), so two leaves can sit on different dashboards/pages. **One leaf = one fixed dashboard**: the binding is immutable for the leaf's lifetime, the toolbar title is plain text (no switcher), and `activeDashboard` matches `leafDashboardId` exactly; unbound/legacy leaves are resolved once by `resolveLeafTargets()` (leaf dashboard → dashboard owning the leaf page → global active) and the result is written back. All open entry points (`activateCustomDashboard` for the picker and per-dashboard commands, plus the manager modal) use open-or-focus via `workspace.iterateAllLeaves`: reveal an existing leaf bound to that id (across popouts), otherwise open a new tab. `newTab` no longer exists; `newWindow` still forces a fresh window. `isDashboardOpen` / `openDashboardCount` back the manager's "open" badge, and `closeDashboardLeaves(id, { except })` detaches other leaves when a dashboard is deleted. The repository broadcasts every successful write through `onChange(store)`; the view re-renders only when the dashboard/page id+name signature changed, and `main.ts` rebuilds the per-dashboard commands from it (debounced ~100ms).
- Per-dashboard commands (`src/dashboard/command-ids.ts`): `dashboardCommandId(id)` derives `open-ioto-canvas-<escaped id>` from the stable dashboard id only (never the name), so renaming keeps bound hotkeys. The prefix avoids the plugin id substring the lint rule forbids. `main.ts` keeps them in a `Map`, removes stale entries via `app.commands.removeCommand` (cast: not in the public typings), and rebuilds changed names.
- Quick search is toggled from a single command across all three views through `checkCallback`; each view exposes `toggleQuickSearch()`.
- Zen mode hides both side columns via the `zen-mode` grid class; panel collapse uses `usages-collapsed` / `right-collapsed`.

## Commands, views, and UX conventions

- Keep command IDs stable; current IDs are registered in `src/main.ts`:
    - `open-ioto-dashboard`
    - `open-ioto-task-view`
    - `open-ioto-note-view`
    - `open-ioto-custom-dashboard`
    - `open-ioto-canvas-picker` (dashboard picker)
    - `open-ioto-canvas-<slug>` (one per dashboard, generated from its id)
    - `toggle-dashboard-quick-search`
    - `toggle-ioto-canvas-zen-mode` (画布禅模式开关)
- `open-ioto-dashboard` intentionally keeps the plugin id inside its command id (historical); the lint rule is suppressed inline. Do not rename it — saved hotkeys reference command IDs.
- Ribbon icons: `columns-3` (dashboard), `check-square` (task view), `sticky-note` (note view). `Shift` opens a new window, `Alt` opens a new tab.
- All user-facing strings must go through `t()` and be added to every locale file.

## Settings conventions

- Persist settings with `this.loadData()` / `this.saveData()` (`loadSettings()` / `saveSettings()` in `src/main.ts`).
- Defaults live in `DEFAULT_SETTINGS` in `src/settings.ts` (7 keys: 4 folder paths, `pageSize`, `savedQueries`, `customFilters`).
- Folder defaults are produced by `t()` at module load, so they follow the active language.
- `pageSize` is clamped to 20–300 in the settings UI.
- The settings tab is built with `TabbedSettings` (`ui/tabbed-settings`): Basic + Custom Filters tabs. Call `plugin.saveSettings()` after each change.
- `savedQueries` are user-named filter snapshots (`category`, `tab`, `type`, `sortOption`, `sortOrder`, `groupOption`, `filters`); they are created/updated/deleted from the view sidebars, not the settings tab.
- `customFilters` are frontmatter-driven filters typed as `text | number | boolean | date | list` and targeted at `all | note | task`.
- On a fresh install **only** (no `data.json`), folder paths are seeded from the `ioto-settings` plugin when it is enabled (`src/services/ioto-settings-services.ts`). Never overwrite existing user settings.

## Inspector settings UI

Custom dashboard inspector (page settings + component settings, shared by the
right sidebar and the inline canvas host) follows one spacing/typography spec.
All spacing comes from three tokens defined on `.ioto-inspector`:

- `--ioto-inspector-space-inline` (4px): label ↔ control ↔ hint
- `--ioto-inspector-space-field` (14px): between settings in one section
- `--ioto-inspector-space-section` (16px): between sections

Rules for adding a setting:

1. One setting = one container: stacked `label → control → optional .ioto-inspector-hint` uses `.ioto-inspector-field`; a single toggle line uses `.ioto-inspector-field.is-inline`; compact stepper rows use `.ioto-inspector-row`.
2. Fixed structure: `label` → control → optional `.ioto-inspector-hint`. Hints state the non-obvious consequence, never restate the label.
3. Never write local spacing: no `margin` inside a field, no `margin-top` between fields — spacing comes from the three tokens.
4. Never group by blank lines or spacer divs. Need a semantic group? Create a collapsible `section`.
5. Only split a new section when there are ≥ 3 settings or the concern is genuinely different; do not make every setting its own section.
6. Colors and sizes must use Obsidian variables (`--text-*`, `--font-*`, `--background-modifier-border`); no hard-coded hex or px font sizes.
7. A hint must never match the label's size/weight/color — that two-level typography is what makes new settings readable.

## i18n conventions

- `t(key, args?)` resolves via `moment.locale()`, merges over `en` as fallback, and interpolates `{0}`, `{1}`, … .
- Locale files are `src/lang/locale/en.ts`, `zh-cn.ts`, `zh-tw.ts`; `en` is the key reference and currently declares 130 keys.
- Keys are `UPPER_SNAKE_CASE`, values are human-readable (never `key === value`).
- Keys must be identical across all locales; `tests/locale-key-alignment.test.mjs` enforces parity, non-empty string values, and real translations.

## Testing

- Framework: Node `node:test` + `assert/strict`, run with `node --test tests/**/*.test.mjs`.
- `.ts` sources are imported through `jiti` with `moduleCache: false`. The aliases required are:
    - `obsidian` → `tests/stubs/obsidian.mjs`
    - `ui/` → `src/ui/` (jiti does not honor `tsconfig` `baseUrl`)
- `tests/stubs/obsidian.mjs` re-exports the real `moment` and provides empty classes (`App`, `ItemView`, `Plugin`, `Modal`, `TFile`, …), `MarkdownRenderer`, `Platform`, `setIcon`, `debounce`, `normalizePath`, plus `window` / `activeDocument` fallbacks. Add stubs there when a new source file imports more of the API.
- Covered today: default settings shape and language-dependent folder defaults, `IotoSettingsService` availability paths, `t()` lookup/fallback/interpolation, locale key parity, and view-type constants (including asserting `main.ts` registers by constant).
- DOM/rendering behavior is not unit-tested: verify in a real vault (see below).

## CI

`.github/workflows/lint.yml` runs on every push and pull request, for Node 20.x and 22.x: `npm ci` → `npm run build --if-present` → `npm run lint`. Tests are not wired into CI yet; run them locally before committing.

## Manifest & release

- `manifest.json` must keep a stable `id` (`ioto-dashboard`) and a valid SemVer `version`; `versions.json` maps plugin version → minimum Obsidian app version.
- Version bump: use `npm version <x.y.z> --no-git-tag-version` (it sets `npm_package_version`, which `version-bump.mjs` reads to rewrite `manifest.json` + `versions.json`, then stages both).
    - Never run `node version-bump.mjs` directly: without `npm_package_version` it writes `version: undefined` and JSON.stringify drops the key.
- `npm run build:deploy` (preferred):
    - Requires `manifest.version === package.json.version`, a clean working tree, `gh` authenticated with repo scope, and `origin` pointing at the GitHub repo (the repo **name** drives the Gitee repo and zip name — not `manifest.id`).
    - Gitee needs `GITEE_TOKEN` or a local `.gitee-token`; both are gitignored.
    - Pushes `v<version>` annotated tags (never `--tags`), creates releases on GitHub and Gitee, and uploads `main.js`, `manifest.json`, `styles.css`, plus `<repo>.zip`.
    - `.npmrc` disables the npm tag prefix, so let the script own tag creation; do not also tag with `npm version`.
- Manual release (fallback): `npm run build`, ensure `manifest.json` / `versions.json` match the tag (no leading `v` in `manifest.version`), then attach `main.js`, `manifest.json`, `styles.css` to the GitHub release.

## Testing (manual, real vault)

- Ensure `main.js`, `manifest.json`, and `styles.css` are present under:
    ```
    <Vault>/.obsidian/plugins/ioto-dashboard/
    ```
- Reload Obsidian, then toggle the plugin in **Settings → Community plugins**.
- Check the three ribbon icons, all four commands, and that saved queries, filters, sort/group and zen mode survive a workspace reload.

## Security & privacy

- Default to local/offline operation. Avoid network calls unless essential and clearly disclosed. The only outbound traffic is in the release script (`build:deploy`), never at plugin runtime.
- Never execute remote code or auto-update plugin code outside normal releases.
- Avoid logging sensitive vault content; keep logs minimal and user-relevant.
