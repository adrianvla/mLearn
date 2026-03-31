# Plugin manifest

Every plugin ships a `plugin.json` file at the root of the plugin directory.

## Required fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Stable plugin identifier. Must be a safe directory name (no `/`, `\`, `..`, reserved Windows device names, or trailing `.`). |
| `name` | `string` | Human-readable display name. |
| `version` | `string` | Plugin version (e.g. `"0.1.0"`). |
| `apiVersion` | `string` | Must be `"1.0.0"` (current `PLUGIN_API_VERSION`). |
| `capabilities` | `PluginCapability[]` | Array of supported capability names. |
| `permissions` | `PluginPermission[]` | Array of explicit permission names. |

## Supported capability values

| Capability | Purpose | Additional requirements |
|------------|---------|------------------------|
| `language` | Provides a language module for tokenization/translation | Must also set `languageId`, `pythonModuleDir`, `pythonModuleName` |
| `ui-panel` | Provides a user-facing UI panel | Must declare `ui` field and request `open-window` permission |
| `integration` | Integrates with external services/APIs | — |

## Supported permission values

| Permission | Gates | Description |
|------------|-------|-------------|
| `kv-store` | `pluginKVGet`, `pluginKVSet`, `pluginKVRemove` | Access to per-plugin key-value storage at `{userData}/plugins/{pluginId}/.kv.json` |
| `open-window` | `pluginOpenWindow` | Can open the plugin host window |
| `http` | — | Declared for plugins that need network access. Currently advisory. |

## Optional metadata

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `description` | `string` | — | Short plugin description. |
| `author` | `string` | — | Plugin author name. |
| `main` | `string` | `"dist/main.js"` | JavaScript entry loaded by the plugin manager with Node `require()`. Authors may need a different build target than the browser-facing UI bundle. |

## Language plugin fields

Use these when `capabilities` includes `language`:

| Field | Type | Description |
|-------|------|-------------|
| `languageId` | `string` | The language identifier exposed by the plugin. |
| `pythonModuleDir` | `string` | Relative directory that contains the Python module. |
| `pythonModuleName` | `string` | Python module name to load from that directory. |

Example:

```json
{
  "id": "language-template",
  "name": "Language Template",
  "version": "0.1.0",
  "apiVersion": "1.0.0",
  "capabilities": ["language"],
  "permissions": [],
  "languageId": "python-template",
  "pythonModuleDir": "python",
  "pythonModuleName": "template_lang"
}
```

## UI field

`ui` is optional. When present, it must be one of the following shapes.

### Schema mode

```json
{
  "ui": {
    "type": "schema",
    "schema": {
      "title": "Example",
      "type": "object"
    },
    "initialData": {
      "note": "Optional initial values"
    }
  }
}
```

- `schema` must be an object (intended for JSON Schema form generation).
- `initialData` is optional and must be an object when provided.
- The plugin host merges `initialData` with runtime `context`, with runtime values taking precedence.

### Component mode

```json
{
  "ui": {
    "type": "component",
    "componentPath": "dist/ui.js"
  }
}
```

- `componentPath` must be a non-empty relative path inside the plugin directory.
- mLearn resolves this path into a `plugin-ui://<pluginId>/<path>` URL before loading it in `plugin-host`.
- `componentPath` is loaded by the renderer with browser `import()`, so it must be a browser-compatible module. This is typically a different build target than `main`.
- The current setup works best with a single precompiled module entry such as `dist/ui.js`.
- More complex bundles that rely on relative chunk or asset resolution may need extra care under the current custom protocol setup.
- The loaded component is resolved as `module.default ?? module.PluginWindow ?? module.PluginComponent`.

## TypeScript reference

```typescript
interface PluginManifest {
  id: string;
  name: string;
  version: string;
  apiVersion: string;
  description?: string;
  author?: string;
  main?: string;
  languageId?: string;
  pythonModuleDir?: string;
  pythonModuleName?: string;
  capabilities: PluginCapability[];
  permissions: PluginPermission[];
  ui?: PluginUIContribution;
}

type PluginCapability = 'language' | 'ui-panel' | 'integration';
type PluginPermission = 'kv-store' | 'open-window' | 'http';

type PluginUIContribution =
  | { type: 'schema'; schema: Record<string, unknown>; initialData?: Record<string, unknown> }
  | { type: 'component'; componentPath: string; componentUrl?: string };
```

## Related types

```typescript
type PluginStatus = 'disabled' | 'active' | 'error' | 'pending';

interface PluginState {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  capabilities: PluginCapability[];
  permissions: PluginPermission[];
  status: PluginStatus;
  errorMessage?: string;
  pluginPath: string;
  permissionsGranted: boolean;
  ui?: PluginUIContribution;
}

interface PluginInstallResult {
  success: boolean;
  pluginId?: string;
  error?: string;
}

interface PluginKVGetResult {
  value: string | null;
}

interface PluginWindowPayload {
  pluginId: string;
  context?: Record<string, unknown>;
}

interface PluginHostContext {
  pluginId: string;
  pluginName: string;
  ui: PluginUIContribution;
  initialContext?: Record<string, unknown>;
}
```

## Trust and activation notes

- Permissions are explicit. Declare only what the plugin needs.
- A plugin that requests permissions stays `pending` until the user completes the grant flow.
- After the user grants permissions, mLearn activates the plugin and calls the exported `activate()` function from `main` when present.
- If the manifest permissions change on update, the previous grant is invalidated and the user must re-approve.
- Permission grants are persisted as a sorted JSON hash of the permission array, so even reordering the array does not invalidate the grant.
