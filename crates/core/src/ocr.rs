//! Source-aligned provider evidence and immutable OCR projections.
use crate::{AnalyzedToken, KnowledgeProjection};
use serde::{Deserialize, Serialize};

macro_rules! model {
    ($name:ident { $($field:ident : $ty:ty),* $(,)? }) => {
        #[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
        #[serde(rename_all = "camelCase")]
        #[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
        pub struct $name { $(pub $field: $ty),* }
    };
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum ImageFit {
    #[default]
    Contain,
    Width,
    Height,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum ImageDirection {
    #[default]
    Ltr,
    Rtl,
}

model!(ImageReaderSettings {
    fit: ImageFit,
    paired: bool,
    first_page_single: bool,
    collate: bool,
    direction: ImageDirection,
    show_overlay: bool,
    show_annotations: bool,
});
impl Default for ImageReaderSettings {
    fn default() -> Self {
        Self {
            fit: ImageFit::Contain,
            paired: false,
            first_page_single: true,
            collate: false,
            direction: ImageDirection::Ltr,
            show_overlay: true,
            show_annotations: true,
        }
    }
}

model!(ImagePageDescriptor {
    source_id: String,
    content_revision: String,
    page_index: u32,
    resource_id: String,
    position: crate::DocumentPosition,
});

model!(OcrPoint { x: f64, y: f64 });
model!(OcrQuad {
    top_left: OcrPoint,
    top_right: OcrPoint,
    bottom_right: OcrPoint,
    bottom_left: OcrPoint,
});
model!(OcrRect {
    x: f64,
    y: f64,
    width: f64,
    height: f64
});
model!(OcrCandidate { text: String, confidence: Option<f64> });

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum OcrAvailability {
    Ready,
    Unavailable,
}

model!(OcrProvider {
    id: String,
    label: String,
    revision: String,
    availability: OcrAvailability,
    languages: Vec<String>,
    scripts: Vec<String>,
    language_provenance: String,
    reason: Option<String>,
});
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct OcrRegion {
    pub id: String,
    pub text: String,
    pub quad: OcrQuad,
    pub candidates: Vec<OcrCandidate>,
    pub language: Option<String>,
    pub orientation: Option<String>,
    pub reading_of: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "typescript", ts(optional = nullable))]
    pub context_region_ids: Option<Vec<String>>,
}
model!(OcrRequest {
    request_id: String,
    source_id: String,
    content_revision: String,
    resource_id: String,
    provider_id: String,
    recognition_languages: Vec<String>,
    crop: Option<OcrRect>,
});
model!(OcrPlan {
    request_id: String,
    source_id: String,
    content_revision: String,
    resource_id: String,
    path: String,
    mime_type: String,
    page_index: Option<u32>,
    crop: Option<OcrRect>,
    provider_id: String,
    recognition_languages: Vec<String>,
});
model!(OcrStageEvidence {
    profile_revision: String,
    package_revision: String,
    detections: Vec<OcrQuad>,
    groups: Vec<Vec<u32>>,
    raw_recognition: Vec<String>,
});
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct OcrNativeResult {
    pub request_id: String,
    pub provider: OcrProvider,
    pub width: u32,
    pub height: u32,
    pub crop: Option<OcrRect>,
    pub regions: Vec<OcrRegion>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "typescript", ts(optional = nullable))]
    pub stage_evidence: Option<OcrStageEvidence>,
}
model!(OcrPage {
    source_id: String,
    content_revision: String,
    resource_id: String,
    ocr_revision: u32,
    provider: OcrProvider,
    width: u32,
    height: u32,
    crop: Option<OcrRect>,
    regions: Vec<OcrRegion>,
});
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum OcrRecovery {
    Unknown,
    Pending,
    Cancelled,
    Completed { page: Box<OcrPage> },
}
model!(ImagePageLocation {
    source_id: String,
    content_revision: String,
    resource_id: String,
    path: String,
    mime_type: String,
    page_index: Option<u32>,
});
model!(OcrCorrection {
    command_id: String,
    source_id: String,
    content_revision: String,
    resource_id: String,
    expected_revision: u32,
    region: OcrRegion,
});
model!(OcrPackageProjection {
    package_id: String,
    package_version: String,
    package_revision: String,
});
// Follow parent_revision to inspect the untouched provider observation separately
// from user corrections and package interpretation.
model!(OcrEvidence {
    source_id: String,
    resource_id: String,
    ocr_revision: u32,
    parent_revision: Option<u32>,
    request: Option<OcrRequest>,
    result: Option<OcrNativeResult>,
    correction: Option<OcrCorrection>,
    package: Option<OcrPackageProjection>,
});
model!(OcrAnalyzedRegion {
    region_id: String,
    text: String,
    tokens: Vec<AnalyzedToken>,
});
model!(OcrOccurrenceKnowledge {
    region_id: String,
    token_start: u32,
    status: String,
});
model!(OcrAnalysisBatch {
    source_id: String,
    content_revision: String,
    resource_id: String,
    ocr_revision: u32,
    package_id: String,
    package_version: String,
    package_revision: String,
    regions: Vec<OcrAnalyzedRegion>,
    knowledge: Vec<KnowledgeProjection>,
    annotations: Vec<OcrOccurrenceKnowledge>,
});
