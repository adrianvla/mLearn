# Plugins

This directory documents the current public plugin surface for mLearn.

## What exists today

- Plugins are discovered from a plugin folder containing `plugin.json`.
- Installation currently happens through the desktop Plugins settings tab or the existing `pluginInstallFromPath` bridge path.
- Plugins do not become trusted automatically. If a manifest requests permissions, mLearn installs it in a pending state until the user clicks `Grant permissions` in Settings.
- Once permissions are granted, the plugin manager can activate the plugin and load its `main` entry.

## Example plugins

- `examples/plugins/discord-activity/` is a packaged, installable example plugin in this repo. Install the folder directly from `examples/plugins/discord-activity/`; the checked-in manifest already points at `dist/main.cjs` and `dist/ui.js`. The maintainable source still starts from `src/main.ts`, but you do not need to bundle `src/main.ts` into separate runtime targets before installing the checked-in example. The example uses `Client ID: 1487871166633869342`.
- The Discord example is a real Discord Rich Presence integration, not just placeholder host-window scaffolding.
- Generic activity hooks exposed to plugins are documented in `docs/plugins/activity.md`.
- `examples/plugins/language-template/` shows the smallest manifest shape for a language plugin backed by a Python module.

## UI plugins

- Component UIs open in the existing `plugin-host` window.
- Active plugins with the `ui-panel` capability, a declared `ui` contribution, and the `open-window` permission show an `Open plugin window` action in Settings.
- The host resolves `ui.componentPath` into a `plugin-ui://<plugin-id>/...` URL and loads that module inside the host window.
- The host component receives `context` data plus a `host` API with `kvGet`, `kvSet`, `kvRemove`, and `closeWindow`.
- A plugin can request the host window through the existing `pluginOpenWindow` bridge call with `{ pluginId, context }`.
- For the Discord example in v1, config changes persist immediately when saved, but Discord Rich Presence updates apply only after you disable and re-enable the plugin.

## Permissions

- `open-window` gates `pluginOpenWindow`.
- `kv-store` gates the plugin KV helpers used by the host window.
- `http` is declared explicitly in the manifest for plugins that need network access.
- Permission grants are stored per plugin manifest so updating requested permissions requires the user to grant again.

## Language plugins

- The manifest schema currently accepts `capabilities: ["language"]` plus `languageId`, `pythonModuleDir`, and `pythonModuleName`.
- The current Python backend routes tokenization and translation through the active language module, but that active module is still loaded by the existing built-in runtime path in `src/root-of-app/config.py`.
- This worktree does not yet wire manifest-declared language plugins into Python module loading or registration.
- `examples/plugins/language-template/` is therefore a minimal author reference for manifest shape and backend hook naming, not a claim that manifest-driven language plugin loading is already enabled.

## Not documented as stable yet

- There is no published plugin SDK package yet.
- There is no separate command-line scaffolder yet.
- If more lifecycle hooks or backend registration steps are added later, document them as future work instead of assuming them today.
