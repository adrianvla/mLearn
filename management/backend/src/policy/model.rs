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
    pub governance: GovernancePolicy,
    pub issued_at: String,
    pub expires_at: String,
    pub key_id: String,
    pub signature: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GovernancePolicy {
    pub activity_retention_days: u16,
    pub conversation_retention_days: u16,
    pub teacher_analytics_export: bool,
    pub teacher_conversation_export: bool,
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
    #[serde(default = "default_requests_per_minute")]
    pub requests_per_minute: u32,
    #[serde(default = "default_max_concurrent_streams")]
    pub max_concurrent_streams: u16,
    pub allowed_providers: Vec<String>,
    pub allowed_models: Vec<String>,
    pub prompt_profile_id: Option<String>,
    pub quotas: Vec<QuotaRule>,
}

pub const fn default_requests_per_minute() -> u32 {
    60
}

pub const fn default_max_concurrent_streams() -> u16 {
    4
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum QuotaMetric {
    Requests,
    InputTokens,
    OutputTokens,
    TotalTokens,
    CostMicros,
}

impl QuotaMetric {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Requests => "requests",
            Self::InputTokens => "inputTokens",
            Self::OutputTokens => "outputTokens",
            Self::TotalTokens => "totalTokens",
            Self::CostMicros => "costMicros",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum QuotaPeriod {
    Daily,
    Weekly,
    Monthly,
    Term,
}

impl QuotaPeriod {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Daily => "daily",
            Self::Weekly => "weekly",
            Self::Monthly => "monthly",
            Self::Term => "term",
        }
    }
}

#[cfg(test)]
mod wire_identifier_tests {
    use super::{QuotaMetric, QuotaPeriod};

    #[test]
    fn quota_wire_identifiers_match_serde_names() {
        for metric in [
            QuotaMetric::Requests,
            QuotaMetric::InputTokens,
            QuotaMetric::OutputTokens,
            QuotaMetric::TotalTokens,
            QuotaMetric::CostMicros,
        ] {
            assert_eq!(
                serde_json::to_string(&metric).unwrap(),
                format!(r#""{}""#, metric.as_str())
            );
        }
        for period in [
            QuotaPeriod::Daily,
            QuotaPeriod::Weekly,
            QuotaPeriod::Monthly,
            QuotaPeriod::Term,
        ] {
            assert_eq!(
                serde_json::to_string(&period).unwrap(),
                format!(r#""{}""#, period.as_str())
            );
        }
    }
}
