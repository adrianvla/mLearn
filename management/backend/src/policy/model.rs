use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PolicyDocument {
    pub schema_version: u8,
    pub policy_version_id: String,
    pub active_group_id: String,
    pub ancestry: Vec<PolicyAncestryEntry>,
    pub settings: BTreeMap<String, SettingRule>,
    pub features: BTreeMap<String, FeatureRule>,
    pub llm: LlmPolicy,
    pub issued_at: String,
    pub expires_at: String,
    pub key_id: String,
    pub signature: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PolicyAncestryEntry {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SettingRule {
    pub value: Value,
    pub source_group_id: String,
    pub source_group_name: String,
    pub locked: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FeatureRule {
    pub enabled: bool,
    pub source_group_id: String,
    pub hard: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LlmPolicy {
    pub enabled: bool,
    pub allowed_providers: Vec<String>,
    pub allowed_models: Vec<String>,
    pub prompt_profile_id: Option<String>,
    pub quotas: Vec<QuotaRule>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QuotaRule {
    pub metric: QuotaMetric,
    pub limit: u64,
    pub period: QuotaPeriod,
    pub source_group_id: String,
    pub hard: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum QuotaMetric {
    Requests,
    InputTokens,
    OutputTokens,
    TotalTokens,
    CostMicros,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum QuotaPeriod {
    Daily,
    Weekly,
    Monthly,
    Term,
}
