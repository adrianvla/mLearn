// Generated from mlearn-core. Run npm run codegen; do not edit.

export type ThemeColors = { background: string, surface: string, text: string, muted: string, accent: string, onAccent: string, border: string, };

export type ThemeDocument = { schemaVersion: number, id: string, name: string, colors: ThemeColors, radius: number, textScale: number, extensions: Record<string, unknown>, };

export type PluginSummary = { id: string, version: string, capabilities: Array<string>, };

export type Snapshot = { protocolVersion: number, revision: number, theme: ThemeDocument, codePolicy: string, catalogConfigured: boolean, availablePlugins: Array<PluginSummary>, installedPlugins: Array<PluginSummary>, };

export type Request = { "type": "snapshot" } | { "type": "save_theme", document: ThemeDocument, expectedRevision: number, commandId: string, } | { "type": "install_plugin", pluginId: string, } | { "type": "invoke_plugin", pluginId: string, capability: string, input: unknown, };

export type Response = { "type": "snapshot", snapshot: Snapshot, } | { "type": "saved", revision: number, } | { "type": "installed", plugin: PluginSummary, } | { "type": "plugin_result", output: unknown, } | { "type": "error", code: string, message: string, };
