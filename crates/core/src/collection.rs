//! Bounded management selections. Package catalogs describe targets; they do
//! not contain learner state. Filters and frozen membership are native-owned.
use crate::{
    Capability, InlineLevel, KnowledgeProjection, LexicalSummary, LinguisticLabel, Material,
    MaterialId,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct CollectionDescription {
    pub capabilities: Vec<Capability>,
    pub kinds: Vec<LinguisticLabel>,
    pub scopes: Vec<LinguisticLabel>,
    pub levels: Vec<InlineLevel>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct CollectionTarget {
    pub summary: LexicalSummary,
    pub kind: String,
    pub capabilities: Vec<String>,
    pub scopes: Vec<String>,
    #[serde(default)]
    #[cfg_attr(feature = "typescript", ts(type = "Record<string, unknown>"))]
    pub extensions: BTreeMap<String, serde_json::Value>,
}

/// A package's immutable catalog window, addressed by entry offset.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct CollectionCatalogPage {
    pub items: Vec<CollectionTarget>,
    pub next: Option<u32>,
    pub total: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum CollectionSurface {
    Knowledge,
    Material,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum CollectionSort {
    #[default]
    Default,
    LabelAscending,
    LabelDescending,
    DueAscending,
    DueDescending,
}

/// These are the existing native projection states, not new thresholds.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum CollectionKnowledgeState {
    Untracked,
    ClaimedKnown,
    ClaimedUnknown,
    AssessedKnown,
    AssessedUnknown,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum CollectionMaterialState {
    Saved,
    Unsaved,
    Excluded,
    NotExcluded,
}

/// Boolean composition preserves the reference filter builder's conjunctions,
/// alternatives and negation. The native boundary bounds depth and node count.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum CollectionFilter {
    All {
        filters: Vec<CollectionFilter>,
    },
    Any {
        filters: Vec<CollectionFilter>,
    },
    Not {
        filter: Box<CollectionFilter>,
    },
    Text {
        text: String,
    },
    Scope {
        id: String,
    },
    Level {
        #[serde(rename = "scaleId")]
        scale_id: String,
        level: String,
    },
    Capability {
        capability: String,
        states: Vec<CollectionKnowledgeState>,
    },
    Material {
        state: CollectionMaterialState,
    },
    Source {
        #[serde(rename = "sourceId")]
        source_id: String,
    },
    EntityKind {
        id: String,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct CollectionQuery {
    /// None browses Material across packages; Knowledge requires one package.
    pub package_id: Option<String>,
    pub surface: CollectionSurface,
    pub filter: CollectionFilter,
    pub sort: CollectionSort,
    /// Opaque, query- and revision-bound cursor; never a renderer array offset.
    pub after: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum CollectionItem {
    Target {
        target: CollectionTarget,
        knowledge: Vec<KnowledgeProjection>,
        #[serde(rename = "materialCount")]
        material_count: u32,
    },
    Material {
        material: Box<Material>,
        target: Option<CollectionTarget>,
        knowledge: Vec<KnowledgeProjection>,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct CollectionPage {
    pub items: Vec<CollectionItem>,
    pub count: u32,
    pub next: Option<String>,
    /// Absent for readable saved Material without an available package catalog.
    pub package_revision: Option<String>,
    pub knowledge_revision: u32,
    pub material_revision: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum CollectionResult {
    Ready { page: CollectionPage },
    Preparing { processed: u32, total: u32 },
    Unavailable { message: String },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(transparent)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct CollectionSelectionId(pub String);

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum CollectionItemId {
    Target {
        #[serde(rename = "targetId")]
        target_id: String,
    },
    Material {
        id: MaterialId,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum CollectionSelectionSource {
    Matching {
        query: CollectionQuery,
    },
    Items {
        query: CollectionQuery,
        items: Vec<CollectionItemId>,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct CollectionSelectionCreate {
    pub command_id: String,
    pub source: CollectionSelectionSource,
}

/// Membership is retained natively until released; refresh does not reselect it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct CollectionSelection {
    pub id: CollectionSelectionId,
    pub package_id: Option<String>,
    pub package_revision: Option<String>,
    pub target_count: u32,
    pub material_count: u32,
}
