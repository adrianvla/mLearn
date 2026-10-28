//! Bounded management selections. Package catalogs describe targets; they do
//! not contain learner state. Filters and frozen membership are native-owned.
use crate::{
    Capability, InlineLevel, KnowledgeProjection, LexicalSummary, LinguisticLabel, Material,
    MaterialId,
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct CollectionDescription {
    pub capabilities: Vec<Capability>,
    pub kinds: Vec<LinguisticLabel>,
    pub scopes: Vec<LinguisticLabel>,
    pub levels: Vec<InlineLevel>,
}

impl CollectionDescription {
    pub fn validate(&self, package: &str) -> Result<(), String> {
        let text = |value: &str, limit: usize| !value.is_empty() && value.len() <= limit;
        let namespace = format!("{package}:");
        let qualified = |id: &str| text(id, 512) && id.starts_with(&namespace);
        if !text(package, 512)
            || self.capabilities.is_empty()
            || self.capabilities.len() > 32
            || self.kinds.is_empty()
            || self.kinds.len() > 64
            || self.scopes.len() > 128
            || self.levels.len() > 256
        {
            return Err("Catalog metadata exceeds bounds".into());
        }
        let mut capabilities = BTreeSet::new();
        for capability in &self.capabilities {
            if !qualified(&capability.id)
                || !text(&capability.label, 256)
                || !capabilities.insert(&capability.id)
            {
                return Err("Invalid or duplicate catalog capability".into());
            }
        }
        for choices in [&self.kinds, &self.scopes] {
            let mut ids = BTreeSet::new();
            for choice in choices {
                if !qualified(&choice.id)
                    || !text(&choice.label, 256)
                    || !text(&choice.attribution, 2048)
                    || choice.color.as_ref().is_some_and(|color| !text(color, 64))
                    || !ids.insert(&choice.id)
                {
                    return Err("Invalid or duplicate catalog choice".into());
                }
            }
        }
        let mut levels = BTreeSet::new();
        for level in &self.levels {
            if !qualified(&level.scale_id)
                || !text(&level.level, 128)
                || !text(&level.label, 256)
                || !text(&level.attribution, 2048)
                || !levels.insert((&level.scale_id, &level.level))
            {
                return Err("Invalid or duplicate catalog level".into());
            }
        }
        if serde_json::to_vec(self)
            .map_err(|error| error.to_string())?
            .len()
            > 65536
        {
            return Err("Catalog metadata exceeds byte budget".into());
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct CollectionLevelMembership {
    pub scale_id: String,
    pub level: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct CollectionTarget {
    pub summary: LexicalSummary,
    pub kind: String,
    pub capabilities: Vec<String>,
    pub scopes: Vec<String>,
    /// Full source memberships, separate from the selected inline display level.
    pub levels: Vec<CollectionLevelMembership>,
    #[serde(default)]
    #[cfg_attr(feature = "typescript", ts(type = "Record<string, unknown>"))]
    pub extensions: BTreeMap<String, serde_json::Value>,
}

/// A package's immutable catalog window, addressed by an opaque package cursor.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct CollectionCatalogPage {
    pub items: Vec<CollectionTarget>,
    pub next: Option<String>,
    pub total: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CollectionCatalogRequest {
    pub after: Option<String>,
    pub limit: u32,
}
impl CollectionCatalogRequest {
    pub fn validate(&self) -> Result<(), String> {
        if !(1..=64).contains(&self.limit)
            || self
                .after
                .as_ref()
                .is_some_and(|cursor| cursor.is_empty() || cursor.len() > 4096)
        {
            return Err("Invalid package catalog window".into());
        }
        Ok(())
    }
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
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct CollectionPreparationCommand {
    pub command_id: String,
    pub package_id: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum CollectionPreparationPhase {
    Preparing,
    Cancelling,
    Succeeded,
    Cancelled,
    Failed,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct CollectionPreparationStatus {
    pub command: CollectionPreparationCommand,
    pub phase: CollectionPreparationPhase,
    pub processed: u32,
    pub total: Option<u32>,
    pub message: Option<String>,
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

/// Frozen identity and edit preconditions, not a live query projection.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct CollectionSelectionEntry {
    pub item: CollectionItemId,
    pub package_id: String,
    pub package_revision: Option<String>,
    pub material_revision: Option<u32>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct CollectionSelectionPage {
    pub items: Vec<CollectionSelectionEntry>,
    pub next: Option<String>,
}
