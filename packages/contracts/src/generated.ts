// Generated from mlearn-core. Run npm run codegen; do not edit.

export type SourceLocator = { "kind": "video", subtitleRevision: string | null, cueIndex: number | null, selectionStart: number, selectionEnd: number, positionMs: number, subtitleOffsetMs: number, playbackRate: number, };

export type SourceAnchor = { sourceId: string, contentRevision: string, packageId: string, packageVersion: string,
/**
 * Untouched source text; authored context edits do not rewrite coordinates.
 */
text: string, locator: SourceLocator, };

export type MaterialId = string;

export type AuthoredMediaId = string;

export type MaterialMediaKind = "image" | "audio" | "video";

export type MediaSegment = { sourceId: string, contentRevision: string, startMs: number, endMs: number, };

export type AuthoredMedia = { id: AuthoredMediaId, kind: MaterialMediaKind, name: string, mimeType: string, byteLength: number, };

export type MaterialAttachment = { mediaId: AuthoredMediaId,
/**
 * Origin belongs to this use of the bytes, not the shared asset.
 */
segment: MediaSegment | null, };

export type MediaCaptureSelection = { "kind": "frame", positionMs: number, } | { "kind": "audio", startMs: number, endMs: number, } | { "kind": "video", startMs: number, endMs: number, } | { "kind": "cue", subtitleRevision: string, cueIndex: number, mediaKind: MaterialMediaKind, };

export type MediaCaptureRequest = { sourceId: string, contentRevision: string, selection: MediaCaptureSelection, };

export type MediaCapturePlan = { sourceId: string, contentRevision: string, path: string, kind: MaterialMediaKind, startMs: number, endMs: number, };

export type CapturedMediaFile = { path: string, kind: MaterialMediaKind, name: string, segment: MediaSegment, };

export type MaterialMediaImport = { path: string, kind: MaterialMediaKind, name: string, segment: MediaSegment | null, };

export type MaterialMediaLocation = { media: AuthoredMedia, path: string, };

export type MaterialTarget = { packageId: string, targetId: string, };

export type MaterialContent = { packageId: string, targetId: string | null, packageRevision: string | null,
/**
 * The selected package-produced snapshot, not a positional linguistic ID.
 */
sense: LexicalSense | null, phrase: string, reading: string, meaning: string, context: string, notes: string, examples: Array<string>, source: SourceAnchor | null, attachments: Array<MaterialAttachment>, };

export type Material = { id: MaterialId, revision: number, excluded: boolean, content: MaterialContent, media: Array<AuthoredMedia>, };

export type MaterialCreate = { commandId: string, content: MaterialContent, distinct: boolean, mediaImports?: Array<MaterialMediaImport>, };

export type MaterialEdit = { commandId: string, id: MaterialId, expectedRevision: number, content: MaterialContent, excluded: boolean, mediaImports?: Array<MaterialMediaImport>, };

export type MaterialQuery = { after: MaterialId | null, query: string, sourceId: string | null, includeExcluded: boolean, };

export type MaterialPage = { items: Array<Material>, next: MaterialId | null, };

export type MaterialWriteResult = { "status": "saved", material: Material, reused: boolean, committedRevision: number, } | { "status": "duplicate", items: Array<Material>, };

export type CaptureAvailability = { "state": "eligible" } | { "state": "existing", materialId: MaterialId, excluded: boolean, } | { "state": "excluded" };

export type MaterialEligibility = { target: MaterialTarget, availability: CaptureAvailability, };

export type CaptureExclusion = { commandId: string, target: MaterialTarget, excluded: boolean, };

export type MaterialCaptureBatch = { packageId: string, commands: Array<MaterialCreate>, };

export type MaterialCaptureResult = { "state": "saved", commandId: string, materialId: MaterialId, committedRevision: number, reused: boolean, } | { "state": "duplicate", commandId: string, materialIds: Array<MaterialId>, } | { "state": "failed", commandId: string, message: string, };

export type ReadingSpan = { start: number, end: number, text: string, attribution: string, base?: string, };

export type LinguisticLabel = { id: string, label: string, color: string | null, attribution: string, };

export type ContourUnit = { text: string, height: number, };

export type PronunciationContour = { id: string, reading: string, units: Array<ContourUnit>, followingHeight: number | null, label: string, color: string | null, attribution: string, };

export type LinguisticPresentation = { readings: Array<ReadingSpan>, labels: Array<LinguisticLabel>, contours: Array<PronunciationContour>, };

export type AggregateClaim = "unavailable" | "untracked" | "claimed_known" | "claimed_unknown" | "mixed";

export type TargetKnowledge = { projections: Array<KnowledgeProjection>, claim: AggregateClaim, };

export type LexicalSummary = { targetId: string, headword: string, reading: string | null, summary: string, presentation: LinguisticPresentation | null, };

export type DictionaryResult = { "state": "available", summary: LexicalSummary, } | { "state": "unavailable", targetId: string, message: string, };

export type DictionaryBatch = { sourceId: string, subtitleRevision: string, packageId: string, packageVersion: string, packageRevision: string, items: Array<DictionaryResult>, };

export type SubtitleDirection = "previous" | "next";

export type OccurrenceKnowledge = { cueIndex: number, tokenStart: number, status: string, };

export type InspectionTrigger = "click" | "immediate" | "delayed" | "modifier";

export type SourceRecord = { id: string, title: string, mediaPath: string, mediaRevision: string, subtitlePath: string | null, subtitleRevision: string | null, packageId: string, packageVersion: string, positionMs: number, durationMs: number, subtitleOffsetMs: number, subtitleOffsetRevision: number, playbackRate: number, inspectionTrigger: InspectionTrigger, };

export type Cue = { index: number, startMs: number, endMs: number, text: string, };

export type SourceWindow = { source: SourceRecord, cues: Array<Cue>, totalCues: number, };

export type CuePosition = { sourceId: string, subtitleRevision: string, cueIndex: number, positionMs: number, };

export type TranscriptPage = { sourceId: string, subtitleRevision: string, cues: Array<Cue>, nextIndex: number | null, };

export type Capability = { id: string, label: string, };

export type LanguageDescription = { language: string, label: string, capabilities: Array<Capability>, annotationCapability: string, attribution: string, };

export type AnalyzedToken = { start: number, end: number, text: string, targets: Array<string>, presentation?: LinguisticPresentation, nearbyMeaning?: boolean, };

export type CueAnalysis = { cue: Cue, tokens: Array<AnalyzedToken>, };

export type AnalysisBatch = { sourceId: string, subtitleRevision: string, packageId: string, packageVersion: string, packageRevision: string, cues: Array<CueAnalysis>, knowledge: Array<KnowledgeProjection>, annotations: Array<OccurrenceKnowledge>, };

export type LexicalSense = { heading: string, labels: Array<string>, definitions: Array<string>, notes: Array<string>, };

export type LexicalEntry = { targetId: string, headword: string, reading: string | null, partOfSpeech: string, definition: string, summary: string | null, senses: Array<LexicalSense> | null, attribution: string, capabilities: Array<Capability>, presentation?: LinguisticPresentation, };

export type KnowledgeKey = { packageId: string, targetId: string, capability: string, };

export type KnowledgeProjection = { key: KnowledgeKey, claim: boolean | null, assessed: boolean | null, prediction: number | null, revision: number, status: string, };

export type ClaimChange = { key: KnowledgeKey, claim: boolean | null, commandId: string, };

export type ThemeColors = { background: string, surface: string, text: string, muted: string, accent: string, onAccent: string, border: string, };

export type ThemeDocument = { schemaVersion: number, id: string, name: string, colors: ThemeColors, radius: number, textScale: number, spacingScale: number, extensions: Record<string, unknown>, };

export type PluginSummary = { id: string, displayName?: string | null, version: string, capabilities: Array<string>, };

export type PackageIssue = { packageId: string, message: string, };

export type PackageInstallCommand = { pluginId: string, commandId: string, };

export type PackageInstallPhase = "downloading" | "validating" | "succeeded" | "failed" | "cancelled";

export type PackageInstallStatus = { command: PackageInstallCommand, phase: PackageInstallPhase, downloadedBytes: number, totalBytes: number | null, message: string | null, };

export type Snapshot = { protocolVersion: number, revision: number, theme: ThemeDocument, codePolicy: string, catalogConfigured: boolean, availablePlugins: Array<PluginSummary>, installedPlugins: Array<PluginSummary>, packageIssues?: Array<PackageIssue>, };

export type Request = { "type": "snapshot" } | { "type": "recent_sources" } | { "type": "available_packages" } | { "type": "plan_material_media", request: MediaCaptureRequest, } | { "type": "material_media", id: AuthoredMediaId, } | { "type": "materials", query: MaterialQuery, } | { "type": "material", id: MaterialId, } | { "type": "create_material", command: MaterialCreate, } | { "type": "update_material", command: MaterialEdit, } | { "type": "capture_materials", batch: MaterialCaptureBatch, } | { "type": "material_eligibility", targets: Array<MaterialTarget>, } | { "type": "set_capture_exclusion", command: CaptureExclusion, } | { "type": "return_material_source", id: MaterialId, } | { "type": "open_source", path: string, packageId: string, } | { "type": "resume_source", sourceId: string, } | { "type": "attach_subtitles", sourceId: string, path: string, } | { "type": "source_window", sourceId: string, positionMs: number, } | { "type": "transcript", sourceId: string, afterIndex: number | null, query: string, } | { "type": "cue_position", sourceId: string, subtitleRevision: string, cueIndex: number, } | { "type": "set_subtitle_offset", sourceId: string, offsetMs: number, } | { "type": "align_subtitle_offset", sourceId: string, subtitleRevision: string, expectedOffsetRevision: number, positionMs: number, direction: SubtitleDirection, } | { "type": "set_playback_rate", sourceId: string, rate: number, } | { "type": "set_inspection_trigger", sourceId: string, trigger: InspectionTrigger, } | { "type": "set_source_language", sourceId: string, packageId: string, } | { "type": "save_position", sourceId: string, positionMs: number, durationMs: number, } | { "type": "analyze_source", sourceId: string, positionMs: number, } | { "type": "analyze_transcript", sourceId: string, afterIndex: number | null, query: string, } | { "type": "describe_language", packageId: string, } | { "type": "inspect_target", packageId: string, targetId: string, expectedRevision: string | null, } | { "type": "inspect_targets", sourceId: string, subtitleRevision: string, packageRevision: string, targetIds: Array<string>, } | { "type": "knowledge", keys: Array<KnowledgeKey>, } | { "type": "change_claim", change: ClaimChange, } | { "type": "save_theme", document: ThemeDocument, expectedRevision: number, commandId: string, } | { "type": "install_plugin", pluginId: string, } | { "type": "install_package", command: PackageInstallCommand, } | { "type": "package_install_status", commandId: string, } | { "type": "current_package_install" } | { "type": "cancel_package_install", commandId: string, } | { "type": "invoke_plugin", pluginId: string, capability: string, input: unknown, };

export type Response = { "type": "material_media_plan", plan: MediaCapturePlan, } | { "type": "material_media", location: MaterialMediaLocation, } | { "type": "materials", page: MaterialPage, } | { "type": "material", material: Material, } | { "type": "material_written", outcome: MaterialWriteResult, } | { "type": "material_captured", results: Array<MaterialCaptureResult>, } | { "type": "material_eligibility", items: Array<MaterialEligibility>, } | { "type": "capture_exclusion_changed", item: MaterialEligibility, } | { "type": "material_source", window: SourceWindow, anchor: SourceAnchor, } | { "type": "snapshot", snapshot: Snapshot, } | { "type": "sources", sources: Array<SourceRecord>, } | { "type": "packages", plugins: Array<PluginSummary>, } | { "type": "source", window: SourceWindow, } | { "type": "transcript", page: TranscriptPage, } | { "type": "cue_position", position: CuePosition, } | { "type": "position_saved" } | { "type": "analysis", batch: AnalysisBatch, } | { "type": "language", description: LanguageDescription, } | { "type": "entry", entry: LexicalEntry, packageVersion: string, packageRevision: string, knowledge: TargetKnowledge, } | { "type": "dictionary", batch: DictionaryBatch, } | { "type": "knowledge", projections: Array<KnowledgeProjection>, } | { "type": "claim_changed", projection: KnowledgeProjection, } | { "type": "saved", revision: number, } | { "type": "installed", plugin: PluginSummary, } | { "type": "package_install_status", status: PackageInstallStatus | null, } | { "type": "plugin_result", output: unknown, } | { "type": "error", code: string, message: string, };
