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
    MaterialWritten {
        outcome: MaterialWriteResult,
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
