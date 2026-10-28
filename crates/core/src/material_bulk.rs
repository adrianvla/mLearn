use crate::{CollectionSelectionEntry, CollectionSelectionId, MaterialId};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct MaterialBulkPatch {
    pub phrase: Option<String>,
    pub reading: Option<String>,
    pub meaning: Option<String>,
    pub context: Option<String>,
    pub notes: Option<String>,
    pub examples: Option<Vec<String>>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum MaterialBulkAction {
    Add { distinct: bool },
    Edit { patch: MaterialBulkPatch },
    Exclude { excluded: bool },
    Remove,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct MaterialBulkStart {
    pub command_id: String,
    pub selection_id: CollectionSelectionId,
    pub action: MaterialBulkAction,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum MaterialBulkPhase {
    Running,
    Completed,
    Failed,
    Cancelled,
    Interrupted,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct MaterialBulkStatus {
    pub command: MaterialBulkStart,
    pub phase: MaterialBulkPhase,
    pub total: u32,
    pub processed: u32,
    pub succeeded: u32,
    pub duplicates: u32,
    pub failed: u32,
    pub results_available: bool,
    pub message: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum MaterialBulkOutcome {
    Saved {
        #[serde(rename = "materialId")]
        material_id: MaterialId,
        #[serde(rename = "committedRevision")]
        committed_revision: u32,
        reused: bool,
    },
    Removed {
        #[serde(rename = "materialId")]
        material_id: MaterialId,
        #[serde(rename = "committedRevision")]
        committed_revision: u32,
    },
    Duplicate {
        #[serde(rename = "materialIds")]
        material_ids: Vec<MaterialId>,
    },
    Failed {
        message: String,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct MaterialBulkItem {
    pub entry: CollectionSelectionEntry,
    pub label: String,
    pub outcome: Option<MaterialBulkOutcome>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct MaterialBulkPage {
    pub items: Vec<MaterialBulkItem>,
    pub next: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum MaterialBulkCommand {
    Start {
        command: MaterialBulkStart,
    },
    Retry {
        #[serde(rename = "commandId")]
        command_id: String,
    },
    Status {
        #[serde(rename = "commandId")]
        command_id: String,
    },
    Jobs,
    Cancel {
        #[serde(rename = "commandId")]
        command_id: String,
    },
    Results {
        #[serde(rename = "commandId")]
        command_id: String,
        after: Option<String>,
    },
    Release {
        #[serde(rename = "commandId")]
        command_id: String,
    },
}
