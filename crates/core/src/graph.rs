//! Package-owned linguistic relationships, separate from learner evidence.
use crate::{Capability, KnowledgeProjection, LinguisticLabel};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum RelationCategory {
    Identity,
    Property,
    Alternative,
    Support,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct GraphProperty {
    pub id: String,
    pub label: String,
    pub value: Value,
    pub attribution: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct LinguisticEntity {
    pub id: String,
    pub kind: LinguisticLabel,
    pub label: String,
    /// Only this explicit binding permits learner access. Shared labels,
    /// pronunciations, dictionary grouping and edges never imply a binding.
    pub target_id: Option<String>,
    pub capabilities: Vec<Capability>,
    pub properties: Vec<GraphProperty>,
    pub attribution: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct LinguisticRelation {
    pub id: String,
    pub category: RelationCategory,
    pub predicate: LinguisticLabel,
    pub from: String,
    pub to: String,
    pub qualifiers: Vec<GraphProperty>,
    pub attribution: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct GraphConnection {
    pub relation: LinguisticRelation,
    pub entity: LinguisticEntity,
}

/// One bounded package read. Parallel relations retain their own IDs and
/// qualifiers even when both endpoints are equal.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct GraphNeighborhood {
    pub entity: LinguisticEntity,
    pub connections: Vec<GraphConnection>,
    pub next: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct GraphCursor {
    pub identity: String,
    pub after: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct GraphQuery {
    pub package_id: String,
    pub target_id: String,
    pub expected_revision: Option<String>,
    pub after: Option<GraphCursor>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct GraphPage {
    pub package_id: String,
    pub package_version: String,
    pub package_revision: String,
    pub entity: LinguisticEntity,
    pub connections: Vec<GraphConnection>,
    pub knowledge: Vec<KnowledgeProjection>,
    pub next: Option<GraphCursor>,
}
