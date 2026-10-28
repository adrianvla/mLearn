//! Reviewable authored drafts. Neither a proposal nor its acceptance is learner evidence.
use crate::{GenerationId, MaterialBulkPatch, MaterialContent, MaterialId};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(transparent)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct MaterialProposalId(pub String);

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct MaterialReference {
    pub id: MaterialId,
    pub revision: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "state",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum MaterialProposalAcceptance {
    Saved {
        material_id: MaterialId,
        committed_revision: u32,
        reused: bool,
    },
    Duplicate {
        material_ids: Vec<MaterialId>,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "state",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum MaterialProposalState {
    Pending,
    Accepted {
        material_id: MaterialId,
        committed_revision: u32,
    },
    Rejected,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct MaterialProposal {
    pub id: MaterialProposalId,
    pub revision: u32,
    /// Text-only draft. Existing authored media is preserved by the replacement owner.
    pub content: MaterialContent,
    pub replaces: Option<MaterialReference>,
    pub generation_id: Option<GenerationId>,
    pub state: MaterialProposalState,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct MaterialSuggestion {
    pub command_id: String,
    pub content: MaterialContent,
    pub replaces: Option<MaterialReference>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum MaterialProposalDecision {
    Edit { patch: MaterialBulkPatch },
    Accept { distinct: bool },
    Reject,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct MaterialProposalReview {
    pub command_id: String,
    pub id: MaterialProposalId,
    pub expected_revision: u32,
    pub decision: MaterialProposalDecision,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct MaterialProposalReceipt {
    pub command_id: String,
    pub proposal: MaterialProposal,
    pub committed_revision: u32,
    pub acceptance: Option<MaterialProposalAcceptance>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct MaterialProposalQuery {
    pub after: Option<MaterialProposalId>,
    pub package_id: Option<String>,
    pub pending_only: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct MaterialProposalPage {
    pub items: Vec<MaterialProposal>,
    pub next: Option<MaterialProposalId>,
}
