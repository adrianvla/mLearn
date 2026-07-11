use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use sqlx::{Row, SqlitePool};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::{
    authorization::{AuthorizationService, Capability},
    error::AppError,
    identity::Principal,
    policy::{
        model::{QuotaMetric, QuotaPeriod},
        registry::validate_setting_rule,
    },
};

use super::compiler::{
    compile_candidate_in_transaction, compile_in_transaction, CandidatePolicyVersion,
    CompiledPolicy,
};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DraftSettingRule {
    pub value: Value,
    pub locked: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DraftFeatureRule {
    pub enabled: bool,
    #[serde(default)]
    pub hard: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DraftQuotaRule {
    pub metric: QuotaMetric,
    pub limit: u64,
    pub period: QuotaPeriod,
    #[serde(default)]
    pub hard: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DraftLlmPolicy {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub requests_per_minute: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_concurrent_streams: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub allowed_providers: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub allowed_models: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt_profile_id: Option<Option<String>>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub quotas: Vec<DraftQuotaRule>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PolicyDraftDocument {
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub settings: BTreeMap<String, DraftSettingRule>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub features: BTreeMap<String, DraftFeatureRule>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub llm: Option<DraftLlmPolicy>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub governance: Option<DraftGovernancePolicy>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DraftGovernancePolicy {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub activity_retention_days: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub conversation_retention_days: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub teacher_analytics_export: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub teacher_conversation_export: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyDraft {
    pub group_id: String,
    pub document: Value,
    pub document_hash: String,
    pub author_user_id: String,
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftValidation {
    pub valid: bool,
    pub document_hash: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyVersion {
    pub id: String,
    pub group_id: String,
    pub document: Value,
    pub document_hash: String,
    pub compiled_hash: String,
    pub author_user_id: String,
    pub summary: String,
    pub parent_version_ids: Vec<String>,
    pub created_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyHistoryPage {
    pub items: Vec<PolicyVersion>,
    pub next_cursor: Option<String>,
}

#[derive(Clone)]
pub struct PolicyService {
    pool: SqlitePool,
    authorization: AuthorizationService,
}

impl PolicyService {
    pub fn new(pool: SqlitePool) -> Self {
        Self {
            authorization: AuthorizationService::new(pool.clone()),
            pool,
        }
    }

    pub async fn get_draft(
        &self,
        principal: &Principal,
        group_id: &str,
    ) -> Result<Option<PolicyDraft>, AppError> {
        self.authorization
            .require(principal, group_id, Capability::PoliciesView)
            .await?;
        let row = sqlx::query("SELECT group_id, document_json, document_hash, author_user_id, updated_at FROM policy_drafts WHERE group_id = ?")
            .bind(group_id).fetch_optional(&self.pool).await.map_err(database_error)?;
        row.map(draft_from_row).transpose()
    }

    pub async fn save_draft(
        &self,
        principal: &Principal,
        group_id: &str,
        document: Value,
    ) -> Result<PolicyDraft, AppError> {
        require_human(principal)?;
        let (typed, normalized, hash) = normalize_and_validate(document)?;
        drop(typed);
        let now = now();
        let mut transaction = self.pool.begin().await.map_err(database_error)?;
        self.authorization
            .require_in_transaction(
                &mut transaction,
                principal,
                group_id,
                Capability::PoliciesEdit,
            )
            .await?;
        sqlx::query("INSERT INTO policy_drafts (group_id, document_json, document_hash, author_user_id, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(group_id) DO UPDATE SET document_json = excluded.document_json, document_hash = excluded.document_hash, author_user_id = excluded.author_user_id, updated_at = excluded.updated_at")
            .bind(group_id).bind(&normalized).bind(&hash).bind(&principal.user_id).bind(now)
            .execute(&mut *transaction).await.map_err(database_error)?;
        transaction.commit().await.map_err(database_error)?;
        Ok(PolicyDraft {
            group_id: group_id.to_string(),
            document: serde_json::from_str(&normalized).map_err(json_error)?,
            document_hash: hash,
            author_user_id: principal.user_id.clone(),
            updated_at: now,
        })
    }

    pub async fn validate_draft(
        &self,
        principal: &Principal,
        group_id: &str,
    ) -> Result<DraftValidation, AppError> {
        self.authorization
            .require(principal, group_id, Capability::PoliciesEdit)
            .await?;
        let row = sqlx::query("SELECT document_json FROM policy_drafts WHERE group_id = ?")
            .bind(group_id)
            .fetch_optional(&self.pool)
            .await
            .map_err(database_error)?
            .ok_or_else(|| AppError::BadRequest("policy draft does not exist".into()))?;
        let document = serde_json::from_str(row.get("document_json")).map_err(json_error)?;
        let (_, _, document_hash) = normalize_and_validate(document)?;
        Ok(DraftValidation {
            valid: true,
            document_hash,
        })
    }

    pub async fn publish(
        &self,
        principal: &Principal,
        group_id: &str,
        summary: &str,
    ) -> Result<PolicyVersion, AppError> {
        require_human(principal)?;
        if summary.trim().is_empty() {
            return Err(AppError::BadRequest(
                "publish summary must not be empty".into(),
            ));
        }
        let mut transaction = self
            .pool
            .begin_with("BEGIN IMMEDIATE")
            .await
            .map_err(database_error)?;
        self.authorization
            .require_in_transaction(
                &mut transaction,
                principal,
                group_id,
                Capability::PoliciesPublish,
            )
            .await?;
        let draft = sqlx::query(
            "SELECT document_json, document_hash FROM policy_drafts WHERE group_id = ?",
        )
        .bind(group_id)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(database_error)?
        .ok_or_else(|| AppError::BadRequest("policy draft does not exist".into()))?;
        let stored_document_json: String = draft.get("document_json");
        let stored_document_hash: String = draft.get("document_hash");
        let stored_document: Value =
            serde_json::from_str(&stored_document_json).map_err(|error| {
                AppError::BadRequest(format!("invalid stored policy draft: {error}"))
            })?;
        let (document, document_json, document_hash) = normalize_and_validate(stored_document)?;
        if document_json != stored_document_json || document_hash != stored_document_hash {
            return Err(AppError::Conflict(
                "stored policy draft failed canonical integrity verification".into(),
            ));
        }
        let id = Uuid::now_v7().to_string();
        let created_at = now();
        let compiled = compile_candidate_in_transaction(
            &mut transaction,
            group_id,
            CandidatePolicyVersion {
                version_id: &id,
                document: &document,
                created_at,
            },
        )
        .await?;
        let compiled_hash = hex::encode(Sha256::digest(
            serde_json::to_vec(&compiled).map_err(json_error)?,
        ));
        let parent_version_ids = compiled.parent_versions;
        let parent_json = serde_json::to_string(&parent_version_ids).map_err(json_error)?;
        sqlx::query("INSERT INTO policy_versions (id, group_id, document_json, document_hash, compiled_hash, author_user_id, summary, parent_version_ids_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
            .bind(&id).bind(group_id).bind(&document_json).bind(&document_hash).bind(&compiled_hash)
            .bind(&principal.user_id).bind(summary.trim()).bind(&parent_json).bind(created_at)
            .execute(&mut *transaction).await.map_err(database_error)?;
        sqlx::query("INSERT INTO active_policies (group_id, policy_version_id, activated_at) VALUES (?, ?, ?) ON CONFLICT(group_id) DO UPDATE SET policy_version_id = excluded.policy_version_id, activated_at = excluded.activated_at")
            .bind(group_id).bind(&id).bind(created_at)
            .execute(&mut *transaction).await.map_err(database_error)?;
        let metadata = serde_json::to_string(&serde_json::json!({
            "summary": summary.trim(), "documentHash": document_hash, "compiledHash": compiled_hash,
            "parentVersionIds": parent_version_ids,
        }))
        .map_err(json_error)?;
        sqlx::query("INSERT INTO audit_events (id, actor_user_id, action, target_type, target_id, metadata_json, created_at, authorized_group_id, request_id) VALUES (?, ?, 'policy.published', 'policy_version', ?, ?, ?, ?, NULL)")
            .bind(Uuid::now_v7().to_string()).bind(&principal.user_id).bind(&id)
            .bind(metadata).bind(created_at).bind(group_id)
            .execute(&mut *transaction).await.map_err(database_error)?;
        transaction.commit().await.map_err(database_error)?;
        Ok(PolicyVersion {
            id,
            group_id: group_id.to_string(),
            document: serde_json::from_str(&document_json).map_err(json_error)?,
            document_hash,
            compiled_hash,
            author_user_id: principal.user_id.clone(),
            summary: summary.trim().to_string(),
            parent_version_ids,
            created_at,
        })
    }

    pub async fn history(
        &self,
        principal: &Principal,
        group_id: &str,
        cursor: Option<&str>,
        limit: usize,
    ) -> Result<PolicyHistoryPage, AppError> {
        self.authorization
            .require(principal, group_id, Capability::PoliciesView)
            .await?;
        let cursor = cursor.map(parse_history_cursor).transpose()?;
        let cursor_created_at = cursor.as_ref().map(|cursor| cursor.0);
        let cursor_id = cursor.as_ref().map(|cursor| cursor.1.as_str());
        let limit = limit.clamp(1, 100);
        let rows = sqlx::query("SELECT id, group_id, document_json, document_hash, compiled_hash, author_user_id, summary, parent_version_ids_json, created_at FROM policy_versions WHERE group_id = ? AND (? IS NULL OR created_at < ? OR (created_at = ? AND id < ?)) ORDER BY created_at DESC, id DESC LIMIT ?")
            .bind(group_id)
            .bind(cursor_created_at)
            .bind(cursor_created_at)
            .bind(cursor_created_at)
            .bind(cursor_id)
            .bind((limit + 1) as i64)
            .fetch_all(&self.pool).await.map_err(database_error)?;
        let mut items = rows
            .into_iter()
            .map(version_from_row)
            .collect::<Result<Vec<_>, _>>()?;
        let has_more = items.len() > limit;
        items.truncate(limit);
        let next_cursor = has_more.then(|| items.last().map(history_cursor)).flatten();
        Ok(PolicyHistoryPage { items, next_cursor })
    }

    pub async fn effective_for_group(
        &self,
        principal: &Principal,
        group_id: &str,
    ) -> Result<CompiledPolicy, AppError> {
        let mut transaction = self.pool.begin().await.map_err(database_error)?;
        self.authorization
            .require_in_transaction(
                &mut transaction,
                principal,
                group_id,
                Capability::PoliciesView,
            )
            .await?;
        let compiled = compile_in_transaction(&mut transaction, group_id).await?;
        transaction.commit().await.map_err(database_error)?;
        Ok(compiled)
    }
}

fn normalize_and_validate(
    document: Value,
) -> Result<(PolicyDraftDocument, String, String), AppError> {
    let mut document: PolicyDraftDocument = serde_json::from_value(document)
        .map_err(|error| AppError::BadRequest(format!("invalid policy draft: {error}")))?;
    validate_draft_document(&document)?;
    if let Some(llm) = &mut document.llm {
        for values in [&mut llm.allowed_providers, &mut llm.allowed_models]
            .into_iter()
            .flatten()
        {
            values.sort();
            values.dedup();
        }
        llm.quotas
            .sort_by_key(|quota| (quota.metric.as_str(), quota.period.as_str()));
    }
    let normalized = serde_json::to_string(&document).map_err(json_error)?;
    let hash = hex::encode(Sha256::digest(normalized.as_bytes()));
    Ok((document, normalized, hash))
}

fn validate_draft_document(document: &PolicyDraftDocument) -> Result<(), AppError> {
    for (key, rule) in &document.settings {
        validate_setting_rule(key, &rule.value).map_err(AppError::BadRequest)?;
        if !rule.locked {
            return Err(AppError::BadRequest(format!(
                "managed setting `{key}` must be locked"
            )));
        }
    }
    for (key, rule) in &document.features {
        require_safe_identifier("feature", key)?;
        if rule.hard && rule.enabled {
            return Err(AppError::BadRequest(format!(
                "hard feature rule `{key}` must be a deny"
            )));
        }
    }
    if let Some(llm) = &document.llm {
        if llm
            .requests_per_minute
            .is_some_and(|value| value == 0 || value > 10_000)
        {
            return Err(AppError::BadRequest(
                "LLM requestsPerMinute must be within 1..10000".into(),
            ));
        }
        if llm
            .max_concurrent_streams
            .is_some_and(|value| value == 0 || value > 1_000)
        {
            return Err(AppError::BadRequest(
                "LLM maxConcurrentStreams must be within 1..1000".into(),
            ));
        }
        if let Some(providers) = &llm.allowed_providers {
            for provider in providers {
                require_safe_identifier("LLM provider", provider)?;
            }
        }
        if let Some(models) = &llm.allowed_models {
            for model in models {
                if model.trim().is_empty() {
                    return Err(AppError::BadRequest("LLM model must not be empty".into()));
                }
            }
        }
        if let Some(Some(prompt)) = &llm.prompt_profile_id {
            require_safe_identifier("prompt profile", prompt)?;
        }
        let mut quota_keys = std::collections::BTreeSet::new();
        for quota in &llm.quotas {
            if quota.limit > 9_007_199_254_740_991 {
                return Err(AppError::BadRequest(
                    "LLM quota exceeds JavaScript's safe integer maximum".into(),
                ));
            }
            let key = (quota.metric.as_str(), quota.period.as_str());
            if !quota_keys.insert(key) {
                return Err(AppError::BadRequest(format!(
                    "duplicate LLM quota {}:{}",
                    key.0, key.1
                )));
            }
        }
    }
    if let Some(governance) = &document.governance {
        for days in [
            governance.activity_retention_days,
            governance.conversation_retention_days,
        ]
        .into_iter()
        .flatten()
        {
            if !(1..=90).contains(&days) {
                return Err(AppError::BadRequest(
                    "governance retention must be within 1..90 days".into(),
                ));
            }
        }
    }
    Ok(())
}

fn require_safe_identifier(kind: &str, value: &str) -> Result<(), AppError> {
    if value.trim().is_empty() || matches!(value, "__proto__" | "constructor" | "prototype") {
        Err(AppError::BadRequest(format!("unsafe {kind} identifier")))
    } else {
        Ok(())
    }
}

fn require_human(principal: &Principal) -> Result<(), AppError> {
    if principal.service_key_id.is_some() {
        Err(AppError::Forbidden(
            "policy mutations require a human actor".into(),
        ))
    } else {
        Ok(())
    }
}

fn draft_from_row(row: sqlx::sqlite::SqliteRow) -> Result<PolicyDraft, AppError> {
    let document_json: String = row.get("document_json");
    Ok(PolicyDraft {
        group_id: row.get("group_id"),
        document: serde_json::from_str(&document_json).map_err(json_error)?,
        document_hash: row.get("document_hash"),
        author_user_id: row.get("author_user_id"),
        updated_at: row.get("updated_at"),
    })
}

fn version_from_row(row: sqlx::sqlite::SqliteRow) -> Result<PolicyVersion, AppError> {
    let parent_json: String = row.get("parent_version_ids_json");
    let document_json: String = row.get("document_json");
    Ok(PolicyVersion {
        id: row.get("id"),
        group_id: row.get("group_id"),
        document: serde_json::from_str(&document_json).map_err(json_error)?,
        document_hash: row.get("document_hash"),
        compiled_hash: row.get("compiled_hash"),
        author_user_id: row.get("author_user_id"),
        summary: row.get("summary"),
        parent_version_ids: serde_json::from_str(&parent_json).map_err(json_error)?,
        created_at: row.get("created_at"),
    })
}

fn now() -> i64 {
    OffsetDateTime::now_utc().unix_timestamp()
}

fn parse_history_cursor(cursor: &str) -> Result<(i64, String), AppError> {
    let (created_at, id) = cursor
        .split_once(':')
        .ok_or_else(|| AppError::BadRequest("invalid policy history cursor".into()))?;
    let created_at = created_at
        .parse()
        .map_err(|_| AppError::BadRequest("invalid policy history cursor".into()))?;
    if id.is_empty() {
        return Err(AppError::BadRequest("invalid policy history cursor".into()));
    }
    Ok((created_at, id.to_string()))
}

fn history_cursor(version: &PolicyVersion) -> String {
    format!("{}:{}", version.created_at, version.id)
}
pub(crate) fn database_error(error: sqlx::Error) -> AppError {
    AppError::Internal(format!("database error: {error}"))
}
fn json_error(error: serde_json::Error) -> AppError {
    AppError::Internal(format!("JSON error: {error}"))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::normalize_and_validate;

    #[test]
    fn canonicalization_sorts_sets_and_quotas_for_stable_hashes() {
        let first = json!({"llm": {
            "allowedProviders": ["ollama", "builtin", "ollama"],
            "allowedModels": ["z-model", "a-model", "z-model"],
            "quotas": [
                {"metric":"totalTokens", "limit":20, "period":"monthly"},
                {"metric":"requests", "limit":10, "period":"daily"}
            ]
        }});
        let second = json!({"llm": {
            "allowedProviders": ["builtin", "ollama"],
            "allowedModels": ["a-model", "z-model"],
            "quotas": [
                {"metric":"requests", "limit":10, "period":"daily"},
                {"metric":"totalTokens", "limit":20, "period":"monthly"}
            ]
        }});

        let (_, first_json, first_hash) = normalize_and_validate(first).unwrap();
        let (_, second_json, second_hash) = normalize_and_validate(second).unwrap();

        assert_eq!(first_json, second_json);
        assert_eq!(first_hash, second_hash);
        assert!(first_json.contains(r#""allowedProviders":["builtin","ollama"]"#));
        assert!(first_json.contains(r#""allowedModels":["a-model","z-model"]"#));
    }

    #[test]
    fn duplicate_quota_metric_and_period_is_rejected() {
        let result = normalize_and_validate(json!({"llm":{"quotas":[
            {"metric":"requests", "limit":10, "period":"daily"},
            {"metric":"requests", "limit":20, "period":"daily"}
        ]}}));

        assert!(result.is_err());
    }

    #[test]
    fn hard_enabled_feature_is_rejected() {
        let result =
            normalize_and_validate(json!({"features":{"cloud_tts":{"enabled":true,"hard":true}}}));

        assert!(result.is_err());
    }
}
