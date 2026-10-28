use crate::{
    AnalysisBatch, CuePosition, DictionaryBatch, KnowledgeProjection, LanguageDescription,
    LexicalEntry, PackageInstallStatus, PluginSummary, Snapshot, SourceRecord, SourceWindow,
    TargetKnowledge, TranscriptPage,
};
use crate::{
    Material, MaterialCaptureResult, MaterialEligibility, MaterialPage, MaterialWriteResult,
    SourceAnchor,
};
use crate::{MaterialMediaLocation, MediaCapturePlan};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum Response {
    Collection {
        result: crate::CollectionResult,
    },
    DocumentSearch {
        page: crate::DocumentSearchPage,
    },
    CollectionSelection {
        selection: crate::CollectionSelection,
    },
    CollectionSelections {
        selections: Vec<crate::CollectionSelection>,
    },
    CollectionSelectionMembership {
        id: crate::CollectionSelectionId,
        items: Vec<crate::CollectionSelectionMembership>,
    },
    CollectionSelectionPage {
        id: crate::CollectionSelectionId,
        page: crate::CollectionSelectionPage,
    },
    CollectionSelectionReleased {
        id: crate::CollectionSelectionId,
    },
    CollectionPreparation {
        status: Option<crate::CollectionPreparationStatus>,
    },
    Conversation {
        result: crate::ConversationResult,
    },
    ConversationMaterialSource {
        conversation: crate::Conversation,
        message: crate::ConversationMessage,
        anchor: SourceAnchor,
    },
    ImagePage {
        page: crate::ImagePageDescriptor,
    },
    ImageReaderSettings {
        #[serde(rename = "sourceId")]
        source_id: String,
        settings: crate::ImageReaderSettings,
    },
    ImagePageLocation {
        location: crate::ImagePageLocation,
    },
    OcrPlan {
        plan: crate::OcrPlan,
    },
    OcrPage {
        page: crate::OcrPage,
    },
    OcrCached {
        page: Option<crate::OcrPage>,
    },
    OcrRecovery {
        recovery: crate::OcrRecovery,
    },
    OcrCancelled {
        #[serde(rename = "requestId")]
        request_id: String,
    },
    OcrEvidence {
        evidence: crate::OcrEvidence,
    },
    OcrAnalysis {
        batch: crate::OcrAnalysisBatch,
    },
    ImageMaterialSource {
        window: crate::DocumentWindow,
        page: crate::OcrPage,
        anchor: SourceAnchor,
    },
    Document {
        window: crate::DocumentWindow,
    },
    Documents {
        sources: Vec<crate::DocumentRecord>,
    },
    DocumentContents {
        page: crate::DocumentContentsPage,
    },
    DocumentAnalysis {
        batch: crate::DocumentAnalysisBatch,
    },
    DocumentResource {
        location: crate::DocumentResourceLocation,
    },
    DocumentMaterialSource {
        window: crate::DocumentWindow,
        anchor: SourceAnchor,
    },
    Review {
        commit: crate::ReviewCommit,
    },
    ReviewSession {
        session: crate::ReviewSession,
    },
    ReviewSessions {
        sessions: Vec<crate::ReviewSession>,
    },
    MaterialMediaPlan {
        plan: MediaCapturePlan,
    },
    MaterialMedia {
        location: MaterialMediaLocation,
    },
    Materials {
        page: MaterialPage,
    },
    Material {
        material: Material,
    },
    MaterialProposals {
        page: crate::MaterialProposalPage,
    },
    MaterialGeneration {
        report: crate::MaterialGenerationReport,
    },
    MaterialGenerations {
        page: crate::MaterialGenerationPage,
    },
    MaterialProposal {
        proposal: crate::MaterialProposal,
    },
    MaterialProposalReviewed {
        receipt: crate::MaterialProposalReceipt,
    },
    MaterialWritten {
        outcome: MaterialWriteResult,
    },
    MaterialRemoved {
        outcome: crate::MaterialRemoval,
    },
    MaterialBulkStatus {
        status: crate::MaterialBulkStatus,
    },
    MaterialBulkJobs {
        jobs: Vec<crate::MaterialBulkStatus>,
    },
    MaterialBulkReleased {
        #[serde(rename = "commandId")]
        command_id: String,
    },
    MaterialBulkPage {
        #[serde(rename = "commandId")]
        command_id: String,
        page: crate::MaterialBulkPage,
    },
    MaterialCaptured {
        results: Vec<MaterialCaptureResult>,
    },
    MaterialEligibility {
        items: Vec<MaterialEligibility>,
    },
    CaptureExclusionChanged {
        item: MaterialEligibility,
    },
    MaterialSource {
        window: SourceWindow,
        anchor: SourceAnchor,
    },
    Snapshot {
        snapshot: Snapshot,
    },
    Sources {
        sources: Vec<SourceRecord>,
    },
    Packages {
        plugins: Vec<PluginSummary>,
    },
    Source {
        window: SourceWindow,
    },
    Transcript {
        page: TranscriptPage,
    },
    CuePosition {
        position: CuePosition,
    },
    PositionSaved,
    Analysis {
        batch: AnalysisBatch,
    },
    Language {
        description: LanguageDescription,
    },
    Entry {
        entry: LexicalEntry,
        #[serde(rename = "packageVersion")]
        package_version: String,
        #[serde(rename = "packageRevision")]
        package_revision: String,
        knowledge: TargetKnowledge,
    },
    Dictionary {
        batch: DictionaryBatch,
    },
    Knowledge {
        projections: Vec<KnowledgeProjection>,
    },
    ClaimChanged {
        projection: KnowledgeProjection,
    },
    Saved {
        revision: u32,
    },
    Installed {
        plugin: PluginSummary,
    },
    PackageInstallStatus {
        status: Option<PackageInstallStatus>,
    },
    PluginResult {
        #[cfg_attr(feature = "typescript", ts(type = "unknown"))]
        output: serde_json::Value,
    },
    Error {
        code: String,
        message: String,
    },
}
