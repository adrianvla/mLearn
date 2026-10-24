//! Authored content is not learner evidence or a Knowledge claim.
use crate::{AuthoredMedia, LexicalSense, MaterialAttachment, MaterialMediaImport, SourceAnchor};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(transparent)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct MaterialId(pub String);

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct MaterialTarget {
    pub package_id: String,
    pub target_id: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct MaterialContent {
    pub package_id: String,
    pub target_id: Option<String>,
    pub package_revision: Option<String>,
    /// The selected package-produced snapshot, not a positional linguistic ID.
    pub sense: Option<LexicalSense>,
    pub phrase: String,
    pub reading: String,
    pub meaning: String,
    pub context: String,
    pub notes: String,
    pub examples: Vec<String>,
    pub source: Option<SourceAnchor>,
    pub attachments: Vec<MaterialAttachment>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct Material {
    pub id: MaterialId,
    pub revision: u32,
    pub excluded: bool,
    pub content: MaterialContent,
    pub media: Vec<AuthoredMedia>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct MaterialCreate {
    pub command_id: String,
    pub content: MaterialContent,
    pub distinct: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub media_imports: Vec<MaterialMediaImport>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct MaterialEdit {
    pub command_id: String,
    pub id: MaterialId,
    pub expected_revision: u32,
    pub content: MaterialContent,
    pub excluded: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub media_imports: Vec<MaterialMediaImport>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct MaterialQuery {
    pub after: Option<MaterialId>,
    pub query: String,
    pub source_id: Option<String>,
    pub include_excluded: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct MaterialPage {
    pub items: Vec<Material>,
    pub next: Option<MaterialId>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum MaterialWriteResult {
    Saved {
        material: Box<Material>,
        reused: bool,
        #[serde(rename = "committedRevision")]
        committed_revision: u32,
    },
    Duplicate {
        items: Vec<Material>,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum CaptureAvailability {
    Eligible,
    Existing {
        #[serde(rename = "materialId")]
        material_id: MaterialId,
        excluded: bool,
    },
    Excluded,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct MaterialEligibility {
    pub target: MaterialTarget,
    pub availability: CaptureAvailability,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct CaptureExclusion {
    pub command_id: String,
    pub target: MaterialTarget,
    pub excluded: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct MaterialCaptureBatch {
    pub package_id: String,
    pub commands: Vec<MaterialCreate>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum MaterialCaptureResult {
    Saved {
        #[serde(rename = "commandId")]
        command_id: String,
        #[serde(rename = "materialId")]
        material_id: MaterialId,
        #[serde(rename = "committedRevision")]
        committed_revision: u32,
        reused: bool,
    },
    Duplicate {
        #[serde(rename = "commandId")]
        command_id: String,
        #[serde(rename = "materialIds")]
        material_ids: Vec<MaterialId>,
    },
    Failed {
        #[serde(rename = "commandId")]
        command_id: String,
        message: String,
    },
}
