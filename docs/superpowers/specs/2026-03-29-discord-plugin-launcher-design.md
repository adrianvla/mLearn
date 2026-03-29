# Discord Plugin Launcher And Integration Design

## Goal

Extend the current plugin system so that:

1. active `ui-panel` plugins can be opened directly from the existing Settings > Plugins card UI,
2. the bundled `discord-activity` example becomes a genuinely installable plugin package rather than source-only scaffolding, and
3. the Discord plugin performs real Discord Rich Presence integration instead of only showing a placeholder host window.

This work stays inside the current v1 plugin architecture. It does not add a first-class launcher outside Settings, and it does not redesign plugin capabilities, lifecycle, or trust boundaries.

## Context

The current branch already has:

- plugin discovery, install, uninstall, enable, disable, and permission grant flows,
- a `plugin-host` window with component and schema UI support,
- a Settings > Plugins tab for install/enable/disable/uninstall,
- a source-first `examples/plugins/discord-activity` example,
- no generic renderer-side action to open a plugin panel from the app UI,
- no runnable built outputs shipped with the Discord example,
- no real Discord RPC integration in the example plugin.

The current Discord example therefore installs successfully but cannot behave like a usable plugin because:

- its manifest points at `dist/main.cjs` and `dist/ui.js`,
- the example folder only contains `src/main.ts`,
- nothing in the app currently invokes `pluginOpenWindow(...)` for installed plugins,
- the plugin code does not talk to Discord yet.

## Non-Goals

- No new launcher entry in the main sidebar, header, or other first-class app chrome.
- No generalized multi-action plugin command framework.
- No attempt to add plugin sandboxing beyond the existing trusted-plugin model.
- No full plugin SDK package or scaffolder in this change.
- No automatic derivation of detailed user study activity from every mLearn screen.

## User Experience

### Settings Launcher

In Settings > Plugins, each plugin card may expose an `Open plugin window` action.

The action is shown only when all of the following are true:

- the plugin is `active`,
- the plugin has capability `ui-panel`,
- the plugin state includes a `ui` contribution.

Behavior:

- Clicking the button calls `bridge.plugins.pluginOpenWindow({ pluginId })`.
- If the host window opens, no extra toast is required.
- If opening fails, the existing error surface for the Plugins tab is used (inline error + existing toast/error patterns if appropriate).
- The button is disabled while that specific plugin action is already in flight.

This keeps plugin launching discoverable without introducing new global navigation.

### Discord Plugin Window

The Discord plugin window becomes the plugin's control surface.

It should allow the user to:

- see whether Discord RPC is connected,
- enable or disable Rich Presence,
- set the visible activity text or template,
- optionally toggle a timestamp if the implementation supports it cleanly,
- save changes and immediately apply them,
- see clear error or disconnected states.

If Discord is not running or the connection cannot be established, the window must explain that state instead of silently doing nothing.

## Architecture

## 1. Settings Plugin Launcher

### Renderer changes

Update `src/renderer/windows/settings/tabs/PluginsTab.tsx`:

- add an `Open plugin window` button to card actions,
- compute `canOpenWindow` from `status === 'active'`, `capabilities.includes('ui-panel')`, and `ui` presence,
- route clicks through `bridge.plugins.pluginOpenWindow({ pluginId: plugin.id })`,
- keep the action local to each card and reuse the existing busy-state and error-state patterns.

Localization updates should add a single new label for the action.

### Why this shape

This is the smallest coherent extension of the current Settings plugin manager. It avoids creating a new app-wide navigation path while making the existing `plugin-host` actually reachable by users.

## 2. Runnable Discord Plugin Packaging

The repo must ship an installable example plugin directory, not just source.

### Required output structure

`examples/plugins/discord-activity/` should include:

- `plugin.json`
- `dist/main.cjs` - Node-loadable plugin entry for activation/runtime logic
- `dist/ui.js` - renderer-loadable host window UI entry
- optional source files retained for maintainability if desired

The manifest should reference those built files exactly.

### Build strategy

The design allows either of these, with preference for the first:

1. commit the built example artifacts directly in `examples/plugins/discord-activity/dist/`, or
2. add a repo-local example build step and document clearly that packaged artifacts must be generated before installation.

Recommended default: commit the built artifacts for this example plugin so that install-from-folder works immediately for people testing the repo.

Reason:

- the feature goal is a real working example,
- current installer copies files as-is,
- users should not have to discover a separate example build pipeline before the plugin works.

## 3. Real Discord Integration

### Runtime split

The Discord plugin has two distinct runtime targets:

- `main.cjs`: plugin activation/runtime integration logic, loaded by the Electron main process plugin manager,
- `ui.js`: plugin host window UI, loaded in the renderer through `plugin-ui://`.

These targets must remain separate. The example should not imply that one JS file serves both Node `require()` and browser `import()`.

### Main runtime responsibilities

The main plugin entry should:

- initialize plugin runtime state on activation,
- connect to Discord Rich Presence via a Discord RPC library,
- load persisted plugin config,
- apply presence when enabled,
- expose a small internal API for updating config and connection state,
- clear presence and disconnect on disable if a disable hook is available, or at minimum on next activation/reconfiguration path where the runtime manages its connection.

Because the current plugin system has no explicit unload lifecycle, the implementation should be conservative and design around the current enable/disable semantics rather than inventing a new branch-wide lifecycle model in this change.

### UI responsibilities

The plugin host UI should:

- display current saved settings,
- show connection status fetched from plugin-managed state,
- let the user update the displayed activity text/template,
- persist configuration through plugin KV,
- trigger runtime refresh so Discord presence changes without restart when feasible.

### Data model

Persist plugin settings in plugin KV under a stable key namespace, for example:

- `discord-activity:enabled`
- `discord-activity:details`
- `discord-activity:state`
- `discord-activity:showTimestamp`

If a separate runtime status blob is needed, keep it distinct from user config.

### RPC behavior

V1 behavior should be intentionally simple:

- one configurable presence record,
- user-editable text fields,
- optional timestamp,
- explicit enabled/disabled state.

Do not attempt to infer every possible mLearn activity. If later work wants dynamic route-aware presence, that should be a separate spec.

## Error Handling

### Settings launcher failures

If `pluginOpenWindow(...)` returns `false` or throws:

- surface a clear error in the Plugins tab,
- do not silently no-op.

### Discord runtime failures

If Discord RPC cannot connect:

- log a plugin-scoped message,
- store enough status for the UI to present `Disconnected` / `Failed to connect`,
- keep the plugin usable so the user can adjust settings and retry.

### Missing build artifacts

For bundled repo examples, missing `dist/` artifacts should be treated as a packaging/test failure during development, not as an acceptable runtime surprise for users.

## Testing Strategy

### Settings launcher

Add renderer tests to verify:

- `Open plugin window` appears only for active `ui-panel` plugins with `ui`,
- clicking the button calls `pluginOpenWindow` with the correct payload,
- failures surface through the tab error state.

### Discord example packaging

Add checks that verify:

- the example manifest references the built files actually present in the example directory,
- the example remains manifest-valid,
- the expected built entries exist.

### Discord integration runtime

Add focused tests around:

- loading persisted config,
- enabling/disabling presence,
- RPC client update calls,
- handling disconnected/unavailable Discord states.

Use a mocked Discord RPC client in tests rather than requiring a live Discord process.

### Existing integration verification

Retain verification for:

- plugin host window open path,
- plugin UI component loading,
- KV persistence,
- typecheck and build.

## Files Likely Affected

Core app:

- `src/renderer/windows/settings/tabs/PluginsTab.tsx`
- `src/renderer/windows/settings/tabs/PluginsTab.test.ts`
- plugin-tab styles and locale files as needed

Discord example plugin:

- `examples/plugins/discord-activity/plugin.json`
- `examples/plugins/discord-activity/dist/main.cjs`
- `examples/plugins/discord-activity/dist/ui.js`
- optional maintained source files for the example build

Docs/tests:

- `docs/plugins/README.md`
- example validation tests
- new Discord plugin runtime tests

## Tradeoffs

### Chosen tradeoff: Settings-only launcher

Pros:

- smallest coherent UX addition,
- immediately discoverable where plugin management already lives,
- no new app-wide navigation complexity.

Cons:

- launching plugin panels requires visiting Settings.

This is acceptable for v1 and matches the requested scope.

### Chosen tradeoff: simple configurable Rich Presence

Pros:

- real Discord integration without large app-wide event plumbing,
- testable,
- useful immediately.

Cons:

- not automatically synced to every exact mLearn state.

This is acceptable for the first working Discord plugin.

## Acceptance Criteria

This design is complete when:

1. Settings > Plugins shows an `Open plugin window` button for eligible active UI plugins.
2. Clicking that button opens the plugin's host window.
3. `examples/plugins/discord-activity` installs as a working plugin without requiring the user to manually build missing runtime files first.
4. The Discord plugin window allows user configuration and persistence.
5. The plugin performs real Discord Rich Presence integration with clear connected/error states.
6. Tests cover launcher visibility/click behavior, example packaging validity, and Discord runtime behavior.
7. Docs reflect the new launcher and the fact that the Discord example is now a real runnable plugin package.
