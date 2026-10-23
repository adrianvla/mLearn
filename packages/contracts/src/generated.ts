// Generated from mlearn-core. Run npm run codegen; do not edit.

export type ImageFit = "contain" | "width" | "height";

export type ImageDirection = "ltr" | "rtl";

export type ImageReaderSettings = { fit: ImageFit, paired: boolean, firstPageSingle: boolean, collate: boolean, direction: ImageDirection, showOverlay: boolean, showAnnotations: boolean, };

export type ImagePageDescriptor = { sourceId: string, contentRevision: string, pageIndex: number, resourceId: string, position: DocumentPosition, };

export type OcrPoint = { x: number, y: number, };

export type OcrQuad = { topLeft: OcrPoint, topRight: OcrPoint, bottomRight: OcrPoint, bottomLeft: OcrPoint, };

export type OcrRect = { x: number, y: number, width: number, height: number, };

export type OcrCandidate = { text: string, confidence: number | null, };

export type OcrAvailability = "ready" | "unavailable";

export type OcrProvider = { id: string, label: string, revision: string, availability: OcrAvailability, languages: Array<string>, scripts: Array<string>, languageProvenance: string, reason: string | null, };

export type OcrRegion = { id: string, text: string, quad: OcrQuad, candidates: Array<OcrCandidate>, language: string | null, orientation: string | null, readingOf: string | null, contextRegionIds?: Array<string> | null, };

export type OcrRequest = { requestId: string, sourceId: string, contentRevision: string, resourceId: string, providerId: string, recognitionLanguages: Array<string>, crop: OcrRect | null, };

export type OcrPlan = { requestId: string, sourceId: string, contentRevision: string, resourceId: string, path: string, mimeType: string, pageIndex: number | null, crop: OcrRect | null, providerId: string, recognitionLanguages: Array<string>, };

export type OcrStageEvidence = { profileRevision: string, packageRevision: string, detections: Array<OcrQuad>, groups: Array<Array<number>>, rawRecognition: Array<string>, };

export type OcrNativeResult = { requestId: string, provider: OcrProvider, width: number, height: number, crop: OcrRect | null, regions: Array<OcrRegion>, stageEvidence?: OcrStageEvidence | null, };

export type OcrPage = { sourceId: string, contentRevision: string, resourceId: string, ocrRevision: number, provider: OcrProvider, width: number, height: number, crop: OcrRect | null, regions: Array<OcrRegion>, };

export type OcrRecovery = { "state": "unknown" } | { "state": "pending" } | { "state": "cancelled" } | { "state": "completed", page: OcrPage, };

export type ImagePageLocation = { sourceId: string, contentRevision: string, resourceId: string, path: string, mimeType: string, pageIndex: number | null, };

export type OcrCorrection = { commandId: string, sourceId: string, contentRevision: string, resourceId: string, expectedRevision: number, region: OcrRegion, };

export type OcrPackageProjection = { packageId: string, packageVersion: string, packageRevision: string, };

export type OcrEvidence = { sourceId: string, resourceId: string, ocrRevision: number, parentRevision: number | null, request: OcrRequest | null, result: OcrNativeResult | null, correction: OcrCorrection | null, package: OcrPackageProjection | null, };

export type OcrAnalyzedRegion = { regionId: string, text: string, tokens: Array<AnalyzedToken>, };

export type OcrOccurrenceKnowledge = { regionId: string, tokenStart: number, status: string, };

export type OcrAnalysisBatch = { sourceId: string, contentRevision: string, resourceId: string, ocrRevision: number, packageId: string, packageVersion: string, packageRevision: string, regions: Array<OcrAnalyzedRegion>, knowledge: Array<KnowledgeProjection>, annotations: Array<OcrOccurrenceKnowledge>, };

export type DocumentFormat = "text" | "epub" | "pdf" | "images";

export type DocumentWritingMode = "auto" | "horizontal" | "vertical";

export type DocumentFlow = "horizontal-tb" | "vertical-rl" | "vertical-lr";

export type DocumentFont = "source" | "serif" | "sans";

export type DocumentAppearance = { writingMode: DocumentWritingMode, font: DocumentFont, fontSize: number, lineHeight: number, letterSpacing: number, };

export type DocumentPosition = { parserRevision: string, resource: string, blockId: string, offset: number, };

export type SourceReading = { start: number, end: number, text: string, };

export type DocumentImage = { resourceId: string, alt: string, };

export type DocumentBlock = { resource: string, id: string, kind: string, text: string, readings: Array<SourceReading>, image: DocumentImage | null, page: number | null, writingMode: DocumentFlow | null, };

export type DocumentRecord = { id: string, title: string, documentPath: string, contentRevision: string, parserRevision: string, format: DocumentFormat, packageId: string, packageVersion: string, position: DocumentPosition | null, appearance: DocumentAppearance, progression: string | null, totalBlocks: number, totalPages: number, fidelity: Array<string>, };

export type DocumentNavigation = { label: string, position: DocumentPosition, };

export type DocumentWindow = { source: DocumentRecord, blocks: Array<DocumentBlock>, previous: DocumentPosition | null, next: DocumentPosition | null, };

export type DocumentContentsPage = { sourceId: string, parserRevision: string, items: Array<DocumentNavigation>, nextOffset: number | null, };

export type DocumentCheckpoint = { sourceId: string, contentRevision: string, position: DocumentPosition, appearance: DocumentAppearance, };

export type DocumentResourceLocation = { sourceId: string, resourceId: string, path: string, mimeType: string, byteLength: number, };

export type DocumentAnalyzedBlock = { resource: string, blockId: string, start: number, text: string, tokens: Array<AnalyzedToken>, };

export type DocumentOccurrenceKnowledge = { resource: string, blockId: string, tokenStart: number, status: string, };

export type DocumentAnalysisBatch = { sourceId: string, contentRevision: string, parserRevision: string, packageId: string, packageVersion: string, packageRevision: string, blocks: Array<DocumentAnalyzedBlock>, knowledge: Array<KnowledgeProjection>, annotations: Array<DocumentOccurrenceKnowledge>, };

export type ReviewSessionId = string;

export type ReviewEncounterId = string;

export type ReviewAttemptId = string;

export type ReviewWorkId = string;

export type AttemptQuality = "missed" | "struggled" | "fluent";

export type ResponseMethod = "remembered" | "worked_out";

export type ReviewDirection = "written" | "focused" | "audio";

export type ReviewTarget = { id: string, label: string, mnemonic: string | null, key: KnowledgeKey | null, };

export type ReviewProbe = { id: string, contractVersion: number, direction: ReviewDirection, cue: string, answer: string, targets: Array<ReviewTarget>, supplied: Array<KnowledgeKey>, requiredMedia: AuthoredMediaId | null, };

export type PracticeItem = { materialId: MaterialId, source: SourceAnchor | null, };

export type ReviewMode = { "kind": "continuous" } | { "kind": "finite", limit: number, } | { "kind": "practice", items: Array<PracticeItem>, };

export type ReviewSessionState = "active" | "paused" | "complete" | "unavailable";

export type ReviewDelivery = "not_required" | "pending" | "started" | "completed" | "interrupted" | "failed";

export type ReviewAssistance = "inspector" | "source" | "prior_disclosure" | "repeated_exposure";

export type ReviewConditions = { revealed: boolean, exposureCount: number, assistance: Array<ReviewAssistance>, delivery: ReviewDelivery, };

export type ReviewEncounter = { id: ReviewEncounterId, workId: ReviewWorkId, materialId: MaterialId, materialRevision: number, packageId: string, packageVersion: string, packageRevision: string, probeId: string, probeContractVersion: number, direction: ReviewDirection, cue: string, answer: string | null, targets: Array<ReviewTarget>, supplied: Array<KnowledgeKey>, requiredMedia: AuthoredMediaId | null, source: SourceAnchor | null, conditions: ReviewConditions, correction: boolean, };

export type ReviewSession = { id: ReviewSessionId, revision: number, mode: ReviewMode, state: ReviewSessionState, completed: number, total: number | null, encounter: ReviewEncounter | null, canUndo: boolean, message: string | null, };

export type ReviewStart = { commandId: string, sessionId: ReviewSessionId, mode: ReviewMode, };

export type ReviewMutation = { commandId: string, sessionId: ReviewSessionId, expectedRevision: number, };

export type ReviewGrade = { targetId: string, quality: AttemptQuality | null, method: ResponseMethod, easy: boolean, };

export type ReviewResponse = { encounterId: ReviewEncounterId, grades: Array<ReviewGrade>, };

export type ReviewCommand = { "kind": "start", start: ReviewStart, } | { "kind": "next", mutation: ReviewMutation, } | { "kind": "reveal", mutation: ReviewMutation, encounterId: ReviewEncounterId, } | { "kind": "delivery", mutation: ReviewMutation, encounterId: ReviewEncounterId, delivery: ReviewDelivery, } | { "kind": "assistance", mutation: ReviewMutation, encounterId: ReviewEncounterId, assistance: ReviewAssistance, } | { "kind": "submit", mutation: ReviewMutation, response: ReviewResponse, } | { "kind": "undo", mutation: ReviewMutation, } | { "kind": "correct", mutation: ReviewMutation, response: ReviewResponse, } | { "kind": "pause", mutation: ReviewMutation, } | { "kind": "resume", mutation: ReviewMutation, };

export type ReviewCommit = { commandId: string, committedRevision: number, session: ReviewSession, };

export type ReviewSchedule = { dueAt: number, intervalSeconds: number, revision: number, ownerAttempt: ReviewAttemptId | null, };

export type SourceLocator = { "kind": "image", resourceId: string, pageIndex: number | null, ocrRevision: number, regionId: string, contextStart: number, selectionStart: number, selectionEnd: number, } | { "kind": "document", parserRevision: string, resource: string, blockId: string,
/**
 * Byte offset of SourceAnchor.text in the original canonical block.
 */
contextStart: number,
/**
 * UTF-8 selection offsets into SourceAnchor.text, not display geometry.
 */
selectionStart: number, selectionEnd: number, } | { "kind": "video", subtitleRevision: string | null, cueIndex: number | null, selectionStart: number, selectionEnd: number, positionMs: number, subtitleOffsetMs: number, playbackRate: number, };

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

export type MaterialAudioBinding = { packageId: string, targetId: string | null, phrase: string, };

export type MaterialAttachment = { mediaId: AuthoredMediaId,
/**
 * Origin belongs to this use of the bytes, not the shared asset.
 */
segment: MediaSegment | null,
/**
 * An explicit authored assertion, valid only for this exact target/phrase.
 */
audioBinding?: MaterialAudioBinding | null, };

export type MediaCaptureSelection = { "kind": "frame", positionMs: number, } | { "kind": "audio", startMs: number, endMs: number, } | { "kind": "video", startMs: number, endMs: number, } | { "kind": "cue", subtitleRevision: string, cueIndex: number, mediaKind: MaterialMediaKind, };

export type MediaCaptureRequest = { sourceId: string, contentRevision: string, selection: MediaCaptureSelection, };

export type MediaCapturePlan = { sourceId: string, contentRevision: string, path: string, kind: MaterialMediaKind, startMs: number, endMs: number, };

export type CapturedMediaFile = { path: string, kind: MaterialMediaKind, name: string, segment: MediaSegment, };

export type MaterialMediaImport = { path: string, kind: MaterialMediaKind, name: string, segment: MediaSegment | null, audioBinding?: MaterialAudioBinding | null, };

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

export type Request = { "type": "image_page", sourceId: string, pageIndex: number, } | { "type": "image_reader_settings", sourceId: string, } | { "type": "save_image_reader_settings", sourceId: string, settings: ImageReaderSettings, } | { "type": "import_image_collection", paths: Array<string>, title: string, packageId: string, } | { "type": "image_page_location", sourceId: string, resourceId: string, } | { "type": "plan_ocr", request: OcrRequest, } | { "type": "ocr_recovery", request: OcrRequest, } | { "type": "complete_ocr", result: OcrNativeResult, } | { "type": "cancel_ocr", requestId: string, } | { "type": "read_ocr", sourceId: string, resourceId: string, ocrRevision: number | null, } | { "type": "ocr_evidence", sourceId: string, resourceId: string, ocrRevision: number, } | { "type": "correct_ocr", correction: OcrCorrection, } | { "type": "analyze_ocr", sourceId: string, resourceId: string, ocrRevision: number, regionIds: Array<string>, } | { "type": "postprocess_ocr", sourceId: string, resourceId: string, ocrRevision: number, } | { "type": "open_document", path: string, packageId: string, } | { "type": "resume_document", sourceId: string, } | { "type": "recent_documents" } | { "type": "document_window", sourceId: string, position: DocumentPosition | null, } | { "type": "document_contents", sourceId: string, after: number | null, } | { "type": "checkpoint_document", checkpoint: DocumentCheckpoint, } | { "type": "set_document_language", sourceId: string, packageId: string, } | { "type": "analyze_document", sourceId: string, position: DocumentPosition | null, } | { "type": "document_resource", sourceId: string, resourceId: string, } | { "type": "review", command: ReviewCommand, } | { "type": "review_session", sessionId: ReviewSessionId, } | { "type": "review_sessions" } | { "type": "return_review_source", sessionId: ReviewSessionId, encounterId: ReviewEncounterId, } | { "type": "snapshot" } | { "type": "recent_sources" } | { "type": "available_packages" } | { "type": "plan_material_media", request: MediaCaptureRequest, } | { "type": "material_media", id: AuthoredMediaId, } | { "type": "materials", query: MaterialQuery, } | { "type": "material", id: MaterialId, } | { "type": "create_material", command: MaterialCreate, } | { "type": "update_material", command: MaterialEdit, } | { "type": "capture_materials", batch: MaterialCaptureBatch, } | { "type": "material_eligibility", targets: Array<MaterialTarget>, } | { "type": "set_capture_exclusion", command: CaptureExclusion, } | { "type": "return_material_source", id: MaterialId, } | { "type": "open_source", path: string, packageId: string, } | { "type": "resume_source", sourceId: string, } | { "type": "attach_subtitles", sourceId: string, path: string, } | { "type": "source_window", sourceId: string, positionMs: number, } | { "type": "transcript", sourceId: string, afterIndex: number | null, query: string, } | { "type": "cue_position", sourceId: string, subtitleRevision: string, cueIndex: number, } | { "type": "set_subtitle_offset", sourceId: string, offsetMs: number, } | { "type": "align_subtitle_offset", sourceId: string, subtitleRevision: string, expectedOffsetRevision: number, positionMs: number, direction: SubtitleDirection, } | { "type": "set_playback_rate", sourceId: string, rate: number, } | { "type": "set_inspection_trigger", sourceId: string, trigger: InspectionTrigger, } | { "type": "set_source_language", sourceId: string, packageId: string, } | { "type": "save_position", sourceId: string, positionMs: number, durationMs: number, } | { "type": "analyze_source", sourceId: string, positionMs: number, } | { "type": "analyze_transcript", sourceId: string, afterIndex: number | null, query: string, } | { "type": "describe_language", packageId: string, } | { "type": "inspect_target", packageId: string, targetId: string, expectedRevision: string | null, } | { "type": "inspect_targets", sourceId: string, subtitleRevision: string, packageRevision: string, targetIds: Array<string>, } | { "type": "knowledge", keys: Array<KnowledgeKey>, } | { "type": "change_claim", change: ClaimChange, } | { "type": "save_theme", document: ThemeDocument, expectedRevision: number, commandId: string, } | { "type": "install_plugin", pluginId: string, } | { "type": "install_package", command: PackageInstallCommand, } | { "type": "package_install_status", commandId: string, } | { "type": "current_package_install" } | { "type": "cancel_package_install", commandId: string, } | { "type": "invoke_plugin", pluginId: string, capability: string, input: unknown, };

export type Response = { "type": "image_page", page: ImagePageDescriptor, } | { "type": "image_reader_settings", sourceId: string, settings: ImageReaderSettings, } | { "type": "image_page_location", location: ImagePageLocation, } | { "type": "ocr_plan", plan: OcrPlan, } | { "type": "ocr_page", page: OcrPage, } | { "type": "ocr_cached", page: OcrPage | null, } | { "type": "ocr_recovery", recovery: OcrRecovery, } | { "type": "ocr_cancelled", requestId: string, } | { "type": "ocr_evidence", evidence: OcrEvidence, } | { "type": "ocr_analysis", batch: OcrAnalysisBatch, } | { "type": "image_material_source", window: DocumentWindow, page: OcrPage, anchor: SourceAnchor, } | { "type": "document", window: DocumentWindow, } | { "type": "documents", sources: Array<DocumentRecord>, } | { "type": "document_contents", page: DocumentContentsPage, } | { "type": "document_analysis", batch: DocumentAnalysisBatch, } | { "type": "document_resource", location: DocumentResourceLocation, } | { "type": "document_material_source", window: DocumentWindow, anchor: SourceAnchor, } | { "type": "review", commit: ReviewCommit, } | { "type": "review_session", session: ReviewSession, } | { "type": "review_sessions", sessions: Array<ReviewSession>, } | { "type": "material_media_plan", plan: MediaCapturePlan, } | { "type": "material_media", location: MaterialMediaLocation, } | { "type": "materials", page: MaterialPage, } | { "type": "material", material: Material, } | { "type": "material_written", outcome: MaterialWriteResult, } | { "type": "material_captured", results: Array<MaterialCaptureResult>, } | { "type": "material_eligibility", items: Array<MaterialEligibility>, } | { "type": "capture_exclusion_changed", item: MaterialEligibility, } | { "type": "material_source", window: SourceWindow, anchor: SourceAnchor, } | { "type": "snapshot", snapshot: Snapshot, } | { "type": "sources", sources: Array<SourceRecord>, } | { "type": "packages", plugins: Array<PluginSummary>, } | { "type": "source", window: SourceWindow, } | { "type": "transcript", page: TranscriptPage, } | { "type": "cue_position", position: CuePosition, } | { "type": "position_saved" } | { "type": "analysis", batch: AnalysisBatch, } | { "type": "language", description: LanguageDescription, } | { "type": "entry", entry: LexicalEntry, packageVersion: string, packageRevision: string, knowledge: TargetKnowledge, } | { "type": "dictionary", batch: DictionaryBatch, } | { "type": "knowledge", projections: Array<KnowledgeProjection>, } | { "type": "claim_changed", projection: KnowledgeProjection, } | { "type": "saved", revision: number, } | { "type": "installed", plugin: PluginSummary, } | { "type": "package_install_status", status: PackageInstallStatus | null, } | { "type": "plugin_result", output: unknown, } | { "type": "error", code: string, message: string, };
