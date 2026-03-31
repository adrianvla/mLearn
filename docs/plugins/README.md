# Plugins

This directory documents the current public plugin surface for mLearn.

## What exists today

- Plugins are discovered from a `{userData}/plugins/` directory. Each subdirectory containing a `plugin.json` is a plugin.
- Installation happens through the desktop Plugins settings tab (folder or `.zip` picker via `pluginSelectAndInstall`) or programmatically via `pluginInstallFromPath`.
- ZIP archives are supported: the installer handles nested root detection, rejects symlinks, skips macOS metadata (`__MACOSX`, `.DS_Store`), and guards against path traversal.
- Plugins do not become trusted automatically. If a manifest requests permissions, mLearn installs it in a `pending` state until the user clicks **Grant permissions** in Settings.
- Once permissions are granted (or if the manifest declares no permissions), the plugin manager activates the plugin and loads its `main` entry.

## Plugin lifecycle

A plugin moves through these statuses:

| Status | Meaning |
|--------|---------|
| `pending` | Installed and awaiting activation. Transitions to `active` when permissions are granted (or if none are required). |
| `active` | Running. The `activate()` export has been called (if present). |
| `disabled` | User-disabled via Settings. The `deactivate()` export was called on transition. |
| `error` | Activation failed. `errorMessage` on `PluginState` contains details. |

### Lifecycle flow

```
install → discover → pending
          ↓                 ↓ (permissions granted or none required)
        disabled ←→ active ←→ error
          ↑                 ↓
        uninstall ← disable
```

### Lifecycle hooks

Plugin `main` entries may export these functions:

| Export | Signature | When called |
|--------|-----------|-------------|
| `activate` | `() => void \| Promise<void>` | When the plugin transitions to `active`. Called after `require()` loads the module. |
| `deactivate` | `() => void \| Promise<void>` | When the user disables the plugin. Called before the module reference is released. |

Both are optional. If `main` does not exist on disk, the plugin still becomes `active` (no-op activation).

### Module loading

- `main` is loaded with Node `require()` in the Electron main process.
- Before each activation, all cached `require` entries under the plugin directory are purged so re-enabling picks up changes.
- `main` must resolve to a path within the plugin directory (path traversal is rejected).
- Default `main` when omitted: `dist/main.js`.

## Example plugins

- `examples/plugins/discord-activity/` — A real Discord Rich Presence integration. The checked-in manifest points at `dist/main.cjs` and `dist/ui.js`. Uses `Client ID: 1487871166633869342`.
- The Discord example consumes the app-published channel `app.user.activity` through `getPluginValue('app.user.activity')` and `onPluginValue('app.user.activity', ...)`.
- `examples/plugins/language-template/` — The smallest manifest shape for a language plugin backed by a Python module.

## Plugin bus

Plugins read and write through one generic plugin bus. Two kinds of channels exist:

### Value channels

Store a JSON snapshot keyed by a string channel name. Subscribers are notified only when the value is **structurally different** (deep JSON comparison with sorted keys).

| Method | Signature | Description |
|--------|-----------|-------------|
| `getPluginValue(channel)` | `(channel: string) => Promise<PluginBusEnvelope>` | Returns the current envelope. `{ hasValue: false, value: null }` when no value has been published. |
| `setPluginValue(channel, value)` | `(channel: string, value: PluginBusJSONValue) => Promise<void>` | Publish a new value. Notifies listeners only if structurally different from previous. |
| `onPluginValue(channel, listener)` | `(channel: string, cb: (next: PluginBusEnvelope, prev: PluginBusEnvelope) => void) => () => void` | Subscribe to value changes. The listener is invoked **immediately** with the current value on subscribe. Returns an unsubscribe function. |

### Event channels

Fire-and-forget JSON payloads. Every call always notifies all listeners.

| Method | Signature | Description |
|--------|-----------|-------------|
| `emitPluginEvent(channel, payload)` | `(channel: string, payload: PluginBusJSONValue) => Promise<void>` | Emit an event to all listeners. |
| `onPluginEvent(channel, listener)` | `(channel: string, cb: (payload: PluginBusJSONValue) => void) => () => void` | Subscribe to events on a channel. Returns an unsubscribe function. |

### Channel ownership

| Prefix | Who can publish | Example |
|--------|----------------|---------|
| `app.*` | The app (Electron main process) | `app.user.activity` |
| `plugin.<pluginId>.*` | Only the plugin with that ID | `plugin.discord-activity.status` |
| `shared.*` | The app or any plugin | `shared.watch-party.state` |

Publishing to a channel outside your namespace throws an error.

### Envelope type

```typescript
type PluginBusEnvelope<T extends PluginBusJSONValue = PluginBusJSONValue> =
  | { hasValue: false; value: null }   // no value published yet
  | { hasValue: true; value: T }       // value is present
```

### PluginBusJSONValue

Any JSON-compatible value:

```typescript
type PluginBusJSONValue =
  | boolean | null | number | string
  | PluginBusJSONValue[]
  | { [key: string]: PluginBusJSONValue }
```

### Built-in channels

### Current channel inventory

This is the list of channels that are actually published by the app in production code today.

#### App-published value channels

| Channel | Type | Published by | Notes |
|--------|------|--------------|-------|
| `app.user.activity` | value | Reader route, video route, flashcards window | The active value comes from the most recently focused source. |

#### App-published event channels

There are currently no built-in `app.*` or `shared.*` event channels published by the app.

#### Plugin-defined namespaces

These namespaces are available to plugin authors, but the app does not pre-populate them with built-in channels today.

| Namespace | Kind | Who can publish |
|-----------|------|-----------------|
| `shared.*` | value or event | App or any plugin |
| `plugin.<pluginId>.*` | value or event | Only that plugin |

#### `app.user.activity`

Multi-source activity channel. The app publishes activity from whichever source window is focused (video player, reader, flashcard view). When multiple sources exist, the most recently focused one wins.

```typescript
type AppActivity =
  | { kind: 'idle' }
  | { kind: 'reader'; workName: string; currentPage: number; totalPages: number }
  | { kind: 'video'; workName: string; currentTimeSeconds: number; durationSeconds: number | null }
  | { kind: 'flashcards' }
```

- `currentPage` is 1-based.
- Video progress updates are throttled to one update per 15-second interval.
- When no source is focused or active, the envelope reads `{ hasValue: false, value: null }`.
- Current production sources are:
  - `reader-route` via the reader route activity sync helper
  - `video-route` via the video route activity sync helper
  - `flashcards-window` via the flashcards window activity sync helper

### Main-process global

Plugins loaded via `require()` in the main process can also access the bus through a global:

```typescript
globalThis.__mlearnPluginBus: {
  getPluginValue: (channel: string) => Promise<PluginBusEnvelope>
  onPluginValue: (channel: string, callback: (next: PluginBusEnvelope, prev: PluginBusEnvelope) => void) => () => void
}
```

## UI plugins

- Component UIs open in the `plugin-host` window (a dedicated Electron window type).
- Active plugins with the `ui-panel` capability, a declared `ui` contribution, and the `open-window` permission show an **Open plugin window** action in Settings.
- The host resolves `ui.componentPath` into a `plugin-ui://<plugin-id>/...` URL and loads that module inside the host window using browser `import()`.
- Opening is done through the bridge: `pluginOpenWindow({ pluginId, context })`.

### Plugin host API

The loaded component receives these props:

```typescript
type PluginComponentProps = {
  context: Record<string, unknown>;   // from PluginWindowPayload.context merged with ui.initialData
  host: {
    kvGet: (key: string) => Promise<string | null>;
    kvSet: (key: string, value: string) => Promise<void>;
    kvRemove: (key: string) => Promise<void>;
    closeWindow: () => void;
  };
};
```

The component is resolved from the module as `module.default ?? module.PluginWindow ?? module.PluginComponent`.

### Component vs Schema UI

- **Component mode**: `componentPath` is loaded via browser `import()`. Must be a browser-compatible module (different build target from `main` which runs in Node).
- **Schema mode**: mLearn auto-renders a form from the JSON schema. `initialData` is merged with runtime `context` (runtime values take precedence).

## Permissions

| Permission | Gates | Storage |
|------------|-------|---------|
| `kv-store` | `pluginKVGet`, `pluginKVSet`, `pluginKVRemove` | `{userData}/plugins/{pluginId}/.kv.json` |
| `open-window` | `pluginOpenWindow` | — |
| `http` | Declared for plugins that need network access | — |

- Permission grants are persisted as a hash of the sorted permission list per plugin.
- If a manifest update changes the requested permissions, the grant is invalidated and the user must re-approve.
- Persisted state is stored at `{userData}/plugin-state.json`:

```typescript
interface PersistedPluginState {
  disabled: string[];                         // plugin IDs the user has disabled
  permissionsGranted: Record<string, string>; // pluginId → hash of granted permissions
}
```

## Plugin management bridge

The full `PluginBridge` interface available to renderer code via `getBridge().plugins`:

| Method | Signature | Description |
|--------|-----------|-------------|
| `pluginGetList()` | `() => Promise<PluginState[]>` | List all discovered plugins. |
| `pluginEnable(pluginId)` | `(id: string) => Promise<PluginState \| null>` | Enable a disabled plugin. |
| `pluginDisable(pluginId)` | `(id: string) => Promise<PluginState \| null>` | Disable an active plugin. Calls `deactivate()`. |
| `pluginGrantPermissions(pluginId)` | `(id: string) => Promise<PluginState \| null>` | Grant permissions and activate if eligible. |
| `pluginInstallFromPath(path)` | `(path: string) => Promise<PluginInstallResult>` | Install from a folder or `.zip` path. |
| `pluginSelectAndInstall()` | `() => Promise<PluginInstallResult>` | Open a file picker and install the selection. |
| `pluginUninstall(pluginId)` | `(id: string) => Promise<boolean>` | Deactivate, remove from disk, and remove from registry. |
| `pluginKVGet(pluginId, key)` | `(id: string, key: string) => Promise<PluginKVGetResult>` | Read a KV store entry. Requires `kv-store` permission. |
| `pluginKVSet(pluginId, key, value)` | `(id: string, key: string, value: string) => Promise<void>` | Write a KV store entry. |
| `pluginKVRemove(pluginId, key)` | `(id: string, key: string) => Promise<void>` | Delete a KV store entry. |
| `pluginOpenWindow(payload)` | `(payload: PluginWindowPayload) => Promise<boolean>` | Open the plugin host window. Requires `open-window` permission. |
| `onPluginList(cb)` | `(cb: (plugins: PluginState[]) => void) => () => void` | Subscribe to full plugin list broadcasts. |
| `onPluginStatusUpdate(cb)` | `(cb: (plugin: PluginState) => void) => () => void` | Subscribe to individual plugin state changes. |
| `onPluginInstallResult(cb)` | `(cb: (result: PluginInstallResult) => void) => () => void` | Subscribe to install results. |

## Language plugins

- The manifest schema accepts `capabilities: ["language"]` plus `languageId`, `pythonModuleDir`, and `pythonModuleName`.
- The current Python backend routes tokenization and translation through the active language module, but that active module is still loaded by the existing built-in runtime path in `src/root-of-app/config.py`.
- This worktree does not yet wire manifest-declared language plugins into Python module loading or registration.
- `examples/plugins/language-template/` is a minimal author reference for manifest shape and backend hook naming, not a claim that manifest-driven language plugin loading is already enabled.

## Plugin directory structure

```
{userData}/plugins/
├── {pluginId}/
│   ├── plugin.json                 # Manifest (required)
│   ├── dist/
│   │   ├── main.js (or main.cjs)  # Node entry (activate/deactivate)
│   │   └── ui.js                   # Browser entry (if ui-panel)
│   └── .kv.json                    # KV store (auto-created, kv-store permission)
├── ...
{userData}/plugin-state.json        # Persisted disabled/grant state
```

## Custom protocols

| Protocol | Resolves to | Purpose |
|----------|-------------|---------|
| `plugin-ui://{pluginId}/{path}` | `{userData}/plugins/{pluginId}/{path}` | Serves plugin UI component files in the host window |

## IPC channels

All plugin IPC channels are defined in `src/shared/plugins/constants.ts` under `PLUGIN_IPC_CHANNELS`:

| Constant | Channel string | Direction |
|----------|---------------|-----------|
| `PLUGIN_LIST` | `plugin:list` | main → renderer (broadcast) |
| `PLUGIN_STATUS_UPDATE` | `plugin:status-update` | main → renderer (broadcast) |
| `PLUGIN_INSTALL_RESULT` | `plugin:install-result` | main → renderer (broadcast) |
| `PLUGIN_BUS_VALUE_CHANGED` | `plugin:bus-value-changed` | main → renderer (broadcast) |
| `PLUGIN_BUS_EVENT_EMITTED` | `plugin:bus-event-emitted` | main → renderer (broadcast) |
| `PLUGIN_GET_LIST` | `plugin:get-list` | renderer → main (invoke) |
| `PLUGIN_BUS_GET_VALUE` | `plugin:bus-get-value` | renderer → main (invoke) |
| `PLUGIN_BUS_GET_VALUE_SYNC` | `plugin:bus-get-value-sync` | renderer → main (sendSync) |
| `PLUGIN_BUS_SET_VALUE` | `plugin:bus-set-value` | renderer → main (invoke) |
| `PLUGIN_BUS_SET_SCOPED_VALUE` | `plugin:bus-set-scoped-value` | renderer → main (send) |
| `PLUGIN_BUS_EMIT_EVENT` | `plugin:bus-emit-event` | renderer → main (invoke) |
| `PLUGIN_ENABLE` | `plugin:enable` | renderer → main (invoke) |
| `PLUGIN_DISABLE` | `plugin:disable` | renderer → main (invoke) |
| `PLUGIN_GRANT_PERMISSIONS` | `plugin:grant-permissions` | renderer → main (invoke) |
| `PLUGIN_UNINSTALL` | `plugin:uninstall` | renderer → main (invoke) |
| `PLUGIN_INSTALL_FROM_PATH` | `plugin:install-from-path` | renderer → main (invoke) |
| `PLUGIN_SELECT_AND_INSTALL` | `plugin:select-and-install` | renderer → main (invoke) |
| `PLUGIN_KV_GET` | `plugin:kv-get` | renderer → main (invoke) |
| `PLUGIN_KV_SET` | `plugin:kv-set` | renderer → main (invoke) |
| `PLUGIN_KV_REMOVE` | `plugin:kv-remove` | renderer → main (invoke) |
| `PLUGIN_OPEN_WINDOW` | `plugin:open-window` | renderer → main (invoke) |

The current plugin API version is `1.0.0` (constant `PLUGIN_API_VERSION`).

## Not documented as stable yet

- There is no published plugin SDK package yet.
- There is no separate command-line scaffolder yet.
- If more lifecycle hooks or backend registration steps are added later, document them as future work instead of assuming them today.
