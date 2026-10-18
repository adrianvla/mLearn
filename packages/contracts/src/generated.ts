// Generated from mlearn-core. Run npm run codegen; do not edit.

export type OccurrenceKnowledge = { cueIndex: number, tokenStart: number, status: string, };

export type SourceRecord = { id: string, title: string, mediaPath: string, mediaRevision: string, subtitlePath: string | null, subtitleRevision: string | null, packageId: string, packageVersion: string, positionMs: number, durationMs: number, };

export type Cue = { index: number, startMs: number, endMs: number, text: string, };

export type SourceWindow = { source: SourceRecord, cues: Array<Cue>, totalCues: number, };

export type Capability = { id: string, label: string, };

export type LanguageDescription = { language: string, label: string, capabilities: Array<Capability>, annotationCapability: string, attribution: string, };

export type AnalyzedToken = { start: number, end: number, text: string, targets: Array<string>, };

export type CueAnalysis = { cue: Cue, tokens: Array<AnalyzedToken>, };

export type AnalysisBatch = { sourceId: string, subtitleRevision: string, packageId: string, packageVersion: string, cues: Array<CueAnalysis>, knowledge: Array<KnowledgeProjection>, annotations: Array<OccurrenceKnowledge>, };

export type LexicalSense = { heading: string, labels: Array<string>, definitions: Array<string>, notes: Array<string>, };

export type LexicalEntry = { targetId: string, headword: string, reading: string | null, partOfSpeech: string, definition: string, summary: string | null, senses: Array<LexicalSense> | null, attribution: string, capabilities: Array<Capability>, };

export type KnowledgeKey = { packageId: string, targetId: string, capability: string, };

export type KnowledgeProjection = { key: KnowledgeKey, claim: boolean | null, assessed: boolean | null, prediction: number | null, revision: number, status: string, };

export type ClaimChange = { key: KnowledgeKey, claim: boolean | null, commandId: string, };

export type ThemeColors = { background: string, surface: string, text: string, muted: string, accent: string, onAccent: string, border: string, };

export type ThemeDocument = { schemaVersion: number, id: string, name: string, colors: ThemeColors, radius: number, textScale: number, extensions: Record<string, unknown>, };

export type PluginSummary = { id: string, version: string, capabilities: Array<string>, };

export type Snapshot = { protocolVersion: number, revision: number, theme: ThemeDocument, codePolicy: string, catalogConfigured: boolean, availablePlugins: Array<PluginSummary>, installedPlugins: Array<PluginSummary>, };

export type Request = { "type": "snapshot" } | { "type": "recent_sources" } | { "type": "available_packages" } | { "type": "open_source", path: string, packageId: string, } | { "type": "resume_source", sourceId: string, } | { "type": "attach_subtitles", sourceId: string, path: string, } | { "type": "source_window", sourceId: string, positionMs: number, } | { "type": "save_position", sourceId: string, positionMs: number, durationMs: number, } | { "type": "analyze_source", sourceId: string, positionMs: number, } | { "type": "describe_language", packageId: string, } | { "type": "inspect_target", packageId: string, targetId: string, } | { "type": "knowledge", keys: Array<KnowledgeKey>, } | { "type": "change_claim", change: ClaimChange, } | { "type": "save_theme", document: ThemeDocument, expectedRevision: number, commandId: string, } | { "type": "install_plugin", pluginId: string, } | { "type": "invoke_plugin", pluginId: string, capability: string, input: unknown, };

export type Response = { "type": "snapshot", snapshot: Snapshot, } | { "type": "sources", sources: Array<SourceRecord>, } | { "type": "packages", plugins: Array<PluginSummary>, } | { "type": "source", window: SourceWindow, } | { "type": "position_saved" } | { "type": "analysis", batch: AnalysisBatch, } | { "type": "language", description: LanguageDescription, } | { "type": "entry", entry: LexicalEntry, } | { "type": "knowledge", projections: Array<KnowledgeProjection>, } | { "type": "claim_changed", projection: KnowledgeProjection, } | { "type": "saved", revision: number, } | { "type": "installed", plugin: PluginSummary, } | { "type": "plugin_result", output: unknown, } | { "type": "error", code: string, message: string, };
