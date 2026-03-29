# Plugin manifest

Every plugin ships a `plugin.json` file at the root of the plugin directory.

## Required fields

- `id`: stable plugin identifier. It must be a safe directory name.
- `name`: human-readable plugin name.
- `version`: plugin version string.
- `apiVersion`: must match the current plugin API version used by mLearn.
- `capabilities`: array of supported capability names.
- `permissions`: array of explicit permission names.

## Supported capability values

- `language`
- `ui-panel`
- `integration`

## Supported permission values

- `kv-store`
- `open-window`
- `http`

## Optional metadata

- `description`
- `author`
- `main`: JavaScript entry loaded by the plugin manager. If omitted, mLearn uses `dist/main.js`.
- `main` runs in the plugin manager and is loaded with Node `require()`, so authors may need a different build target than the browser-facing UI bundle.

## Language plugin fields

Use these when `capabilities` includes `language`:

- `languageId`: the language identifier exposed by the plugin.
- `pythonModuleDir`: relative directory that contains the Python module.
- `pythonModuleName`: Python module name to load from that directory.

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

- `schema` must be an object.
- `initialData` is optional and must be an object when provided.
- The plugin host merges `initialData` with runtime `context`, with runtime values taking precedence.

### Component mode

```json
{
  "ui": {
    "type": "component",
    "componentPath": "dist/main.js"
  }
}
```

- `componentPath` must be a non-empty relative path inside the plugin directory.
- mLearn resolves this path into a `plugin-ui://` URL before loading it in `plugin-host`.
- `componentPath` is loaded by the renderer with browser `import()`, so it may need a different build target than `main`.
- The current setup works best with a single precompiled module entry such as `dist/main.js`.
- More complex bundles that rely on relative chunk or asset resolution may need extra care under the current custom protocol setup.

## Trust and activation notes

- Permissions are explicit. Declare only what the plugin needs.
- A plugin that requests permissions stays pending until the user completes the grant flow.
- After the user grants permissions, mLearn can activate the plugin and call the exported `activate()` function from `main` when present.
