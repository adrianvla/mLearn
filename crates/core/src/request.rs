use crate::{AuthoredMediaId, MediaCaptureRequest};
use crate::{
    CaptureExclusion, MaterialCaptureBatch, MaterialCreate, MaterialEdit, MaterialId,
    MaterialQuery, MaterialTarget,
};
use crate::{
    ClaimChange, InspectionTrigger, KnowledgeKey, PackageInstallCommand, SubtitleDirection,
    ThemeDocument,
};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum Request {
    Conversation {
        command: crate::ConversationCommand,
    },
    ImagePage {
        #[serde(rename = "sourceId")]
        source_id: String,
        #[serde(rename = "pageIndex")]
        page_index: u32,
    },
    ImageReaderSettings {
        #[serde(rename = "sourceId")]
        source_id: String,
    },
    SaveImageReaderSettings {
        #[serde(rename = "sourceId")]
        source_id: String,
        settings: crate::ImageReaderSettings,
    },
    ImportImageCollection {
        paths: Vec<String>,
        title: String,
        #[serde(rename = "packageId")]
        package_id: String,
    },
    ImagePageLocation {
        #[serde(rename = "sourceId")]
        source_id: String,
        #[serde(rename = "resourceId")]
        resource_id: String,
    },
    PlanOcr {
        request: crate::OcrRequest,
    },
    OcrRecovery {
        request: crate::OcrRequest,
    },
    CompleteOcr {
        result: crate::OcrNativeResult,
    },
    CancelOcr {
        #[serde(rename = "requestId")]
        request_id: String,
    },
    ReadOcr {
        #[serde(rename = "sourceId")]
        source_id: String,
        #[serde(rename = "resourceId")]
        resource_id: String,
        #[serde(rename = "ocrRevision")]
        ocr_revision: Option<u32>,
    },
    OcrEvidence {
        #[serde(rename = "sourceId")]
        source_id: String,
        #[serde(rename = "resourceId")]
        resource_id: String,
        #[serde(rename = "ocrRevision")]
        ocr_revision: u32,
    },
    CorrectOcr {
        correction: crate::OcrCorrection,
    },
    AnalyzeOcr {
        #[serde(rename = "sourceId")]
        source_id: String,
        #[serde(rename = "resourceId")]
        resource_id: String,
        #[serde(rename = "ocrRevision")]
        ocr_revision: u32,
        #[serde(rename = "regionIds")]
        region_ids: Vec<String>,
    },
    PostprocessOcr {
        #[serde(rename = "sourceId")]
        source_id: String,
        #[serde(rename = "resourceId")]
        resource_id: String,
        #[serde(rename = "ocrRevision")]
        ocr_revision: u32,
    },
    OpenDocument {
        path: String,
        #[serde(rename = "packageId")]
        package_id: String,
    },
    ResumeDocument {
        #[serde(rename = "sourceId")]
        source_id: String,
    },
    RecentDocuments,
    DocumentWindow {
        #[serde(rename = "sourceId")]
        source_id: String,
        position: Option<crate::DocumentPosition>,
    },
    DocumentContents {
        #[serde(rename = "sourceId")]
        source_id: String,
        after: Option<u32>,
    },
    SearchDocument {
        query: crate::DocumentSearchQuery,
    },
    ReturnSourceAnchor {
        anchor: crate::SourceAnchor,
    },
    CheckpointDocument {
        checkpoint: crate::DocumentCheckpoint,
    },
    SetDocumentLanguage {
        #[serde(rename = "sourceId")]
        source_id: String,
        #[serde(rename = "packageId")]
        package_id: String,
    },
    AnalyzeDocument {
        #[serde(rename = "sourceId")]
        source_id: String,
        position: Option<crate::DocumentPosition>,
    },
    DocumentResource {
        #[serde(rename = "sourceId")]
        source_id: String,
        #[serde(rename = "resourceId")]
        resource_id: String,
    },
    Review {
        command: crate::ReviewCommand,
    },
    ReviewSession {
        #[serde(rename = "sessionId")]
        session_id: crate::ReviewSessionId,
    },
    ReviewSessions,
    ReturnReviewSource {
        #[serde(rename = "sessionId")]
        session_id: crate::ReviewSessionId,
        #[serde(rename = "encounterId")]
        encounter_id: crate::ReviewEncounterId,
    },
    Snapshot,
    RecentSources,
    AvailablePackages,
    PlanMaterialMedia {
        request: MediaCaptureRequest,
    },
    MaterialMedia {
        id: AuthoredMediaId,
    },
    Materials {
        query: MaterialQuery,
    },
    Material {
        id: MaterialId,
    },
    MaterialProposals {
        query: crate::MaterialProposalQuery,
    },
    MaterialGeneration {
        id: crate::GenerationId,
    },
    MaterialGenerations {
        after: Option<crate::GenerationId>,
    },
    CollectMaterialGeneration {
        id: crate::GenerationId,
    },
    MaterialProposal {
        id: crate::MaterialProposalId,
    },
    SuggestMaterial {
        command: crate::MaterialSuggestion,
    },
    ReviewMaterialProposal {
        command: crate::MaterialProposalReview,
    },
    ReturnMaterialProposalSource {
        id: crate::MaterialProposalId,
    },
    CreateMaterial {
        command: MaterialCreate,
    },
    UpdateMaterial {
        command: MaterialEdit,
    },
    RemoveMaterial {
        command: crate::MaterialRemove,
    },
    MaterialBulk {
        command: crate::MaterialBulkCommand,
    },
    CaptureMaterials {
        batch: MaterialCaptureBatch,
    },
    MaterialEligibility {
        targets: Vec<MaterialTarget>,
    },
    SetCaptureExclusion {
        command: CaptureExclusion,
    },
    ReturnMaterialSource {
        id: MaterialId,
    },
    OpenSource {
        path: String,
        #[serde(rename = "packageId")]
        package_id: String,
    },
    ResumeSource {
        #[serde(rename = "sourceId")]
        source_id: String,
    },
    AttachSubtitles {
        #[serde(rename = "sourceId")]
        source_id: String,
        path: String,
    },
    SourceWindow {
        #[serde(rename = "sourceId")]
        source_id: String,
        #[serde(rename = "positionMs")]
        position_ms: u32,
    },
    Transcript {
        #[serde(rename = "sourceId")]
        source_id: String,
        #[serde(rename = "afterIndex")]
        after_index: Option<u32>,
        query: String,
    },
    CuePosition {
        #[serde(rename = "sourceId")]
        source_id: String,
        #[serde(rename = "subtitleRevision")]
        subtitle_revision: String,
        #[serde(rename = "cueIndex")]
        cue_index: u32,
    },
    SetSubtitleOffset {
        #[serde(rename = "sourceId")]
        source_id: String,
        #[serde(rename = "offsetMs")]
        offset_ms: i32,
    },
    AlignSubtitleOffset {
        #[serde(rename = "sourceId")]
        source_id: String,
        #[serde(rename = "subtitleRevision")]
        subtitle_revision: String,
        #[serde(rename = "expectedOffsetRevision")]
        expected_offset_revision: u32,
        #[serde(rename = "positionMs")]
        position_ms: u32,
        direction: SubtitleDirection,
    },
    SetPlaybackRate {
        #[serde(rename = "sourceId")]
        source_id: String,
        rate: f64,
    },
    SetInspectionTrigger {
        #[serde(rename = "sourceId")]
        source_id: String,
        trigger: InspectionTrigger,
    },
    SetSourceLanguage {
        #[serde(rename = "sourceId")]
        source_id: String,
        #[serde(rename = "packageId")]
        package_id: String,
    },
    SavePosition {
        #[serde(rename = "sourceId")]
        source_id: String,
        #[serde(rename = "positionMs")]
        position_ms: u32,
        #[serde(rename = "durationMs")]
        duration_ms: u32,
    },
    AnalyzeSource {
        #[serde(rename = "sourceId")]
        source_id: String,
        #[serde(rename = "positionMs")]
        position_ms: u32,
    },
    AnalyzeTranscript {
        #[serde(rename = "sourceId")]
        source_id: String,
        #[serde(rename = "afterIndex")]
        after_index: Option<u32>,
        query: String,
    },
    DescribeLanguage {
        #[serde(rename = "packageId")]
        package_id: String,
    },
    Collection {
        query: crate::CollectionQuery,
    },
    CreateCollectionSelection {
        command: crate::CollectionSelectionCreate,
    },
    CollectionSelection {
        id: crate::CollectionSelectionId,
    },
    CollectionSelections,
    CollectionSelectionMembership {
        id: crate::CollectionSelectionId,
        #[serde(rename = "packageId")]
        package_id: Option<String>,
        surface: crate::CollectionSurface,
        items: Vec<crate::CollectionItemId>,
    },
    CollectionSelectionPage {
        id: crate::CollectionSelectionId,
        after: Option<String>,
    },
    ReleaseCollectionSelection {
        id: crate::CollectionSelectionId,
    },
    PrepareCollection {
        command: crate::CollectionPreparationCommand,
    },
    CollectionPreparationStatus {
        #[serde(rename = "commandId")]
        command_id: Option<String>,
    },
    CancelCollectionPreparation {
        #[serde(rename = "commandId")]
        command_id: String,
    },
    InspectTarget {
        #[serde(rename = "packageId")]
        package_id: String,
        #[serde(rename = "targetId")]
        target_id: String,
        #[serde(rename = "expectedRevision")]
        expected_revision: Option<String>,
    },
    InspectTargets {
        #[serde(rename = "sourceId")]
        source_id: String,
        #[serde(rename = "subtitleRevision")]
        subtitle_revision: String,
        #[serde(rename = "packageRevision")]
        package_revision: String,
        #[serde(rename = "targetIds")]
        target_ids: Vec<String>,
    },
    Knowledge {
        keys: Vec<KnowledgeKey>,
    },
    ChangeClaim {
        change: ClaimChange,
    },
    SaveTheme {
        document: ThemeDocument,
        #[serde(rename = "expectedRevision")]
        expected_revision: u32,
        #[serde(rename = "commandId")]
        command_id: String,
    },
    SaveInlineLevelScale {
        #[serde(rename = "scaleId")]
        scale_id: Option<String>,
        #[serde(rename = "expectedRevision")]
        expected_revision: u32,
        #[serde(rename = "commandId")]
        command_id: String,
    },
    SaveStarCollapse {
        collapse: crate::StarCollapse,
        #[serde(rename = "expectedRevision")]
        expected_revision: u32,
        #[serde(rename = "commandId")]
        command_id: String,
    },
    InstallPlugin {
        #[serde(rename = "pluginId")]
        plugin_id: String,
    },
    InstallPackage {
        command: PackageInstallCommand,
    },
    PackageInstallStatus {
        #[serde(rename = "commandId")]
        command_id: String,
    },
    CurrentPackageInstall,
    CancelPackageInstall {
        #[serde(rename = "commandId")]
        command_id: String,
    },
    InvokePlugin {
        #[serde(rename = "pluginId")]
        plugin_id: String,
        capability: String,
        #[cfg_attr(feature = "typescript", ts(type = "unknown"))]
        input: serde_json::Value,
    },
}
