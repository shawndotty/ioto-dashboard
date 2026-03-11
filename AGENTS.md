# IOTO Dashboard (Obsidian community plugin)

## Project overview

- Target: Obsidian Community Plugin (TypeScript → bundled JavaScript).
- Entry point: `src/main.ts` bundled to `main.js` (plugin root) and loaded by Obsidian.
- Release artifacts: `main.js`, `manifest.json`, and optional `styles.css`.

## Environment & tooling

- Node.js: use current LTS (CI uses Node 20/22).
- Package manager: npm (see `package.json` scripts).
- Bundler: esbuild (`esbuild.config.mjs`).
- Type checking: TypeScript (`tsc -noEmit`).
- Linting: ESLint flat config (`eslint.config.mts`) via `npm run lint`.

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

## Repository layout

- `src/main.ts`: plugin lifecycle, view registration, ribbon icons, commands.
- `src/settings.ts`: settings types/defaults + settings tab UI.
- `src/views/*`: `DashboardView`, `TaskView`, `NoteView` and their UI components.
- `src/ui/*`: reusable UI pieces (modals, pickers, tabbed settings).
- `src/lang/*`: i18n strings (`src/lang/locale/*`) and `t()` helper.
- `src/models/*`: shared constants/types for view IDs and data models.
- `src/services/*`: optional integrations (e.g., reads settings from the `ioto-settings` plugin on first run).

Notes:

- `tsconfig.json` sets `"baseUrl": "src"`, so imports like `ui/tabbed-settings` resolve from `src/`.
- `main.js` is generated and ignored by git; do not commit build outputs.

## Commands, views, and UX conventions

- View types live in `src/models/constants.ts` and are registered in `src/main.ts`.
- Keep command IDs stable; current IDs are registered in `src/main.ts`:
    - `open-ioto-dashboard`
    - `open-ioto-task-view`
    - `open-ioto-note-view`
    - `toggle-dashboard-quick-search`
- All user-facing strings should go through `t()` and be added to locale files.

## Settings conventions

- Persist settings using `this.loadData()` / `this.saveData()` in `src/main.ts`.
- Defaults are defined in `DEFAULT_SETTINGS` in `src/settings.ts`.
- Settings UI lives in `DashboardSettingTab` (`src/settings.ts`) and should call `plugin.saveSettings()` after changes.
- On a fresh install (no saved data), settings may be initialized from the `ioto-settings` plugin if present (`src/services/ioto-settings-services.ts`).

## Manifest & release

- `manifest.json` must keep a stable `id` (`ioto-dashboard`) and a valid SemVer `version`.
- `versions.json` maps plugin version → minimum Obsidian app version; update it when releasing.
- Release process:
    - Run `npm run build`.
    - Update `manifest.json` (and `versions.json`) and ensure the tag matches `manifest.json`’s `version` exactly (no leading `v`).
    - Optionally run `npm run version` to bump/stage `manifest.json` + `versions.json`.
    - Attach `main.js`, `manifest.json`, and `styles.css` (if present) to the GitHub release.

## Testing (manual)

- Ensure `main.js`, `manifest.json`, and `styles.css` (if any) are present under:
    ```
    <Vault>/.obsidian/plugins/ioto-dashboard/
    ```
- Reload Obsidian, then toggle the plugin in **Settings → Community plugins**.

## Security & privacy

- Default to local/offline operation. Avoid network calls unless essential and clearly disclosed.
- Never execute remote code or auto-update plugin code outside normal releases.
- Avoid logging sensitive vault content; keep logs minimal and user-relevant.
