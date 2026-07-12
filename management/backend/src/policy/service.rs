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
    pub policy_id: String,
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
    pub policy_id: String,
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicySummary {
    pub id: String,
    pub group_id: String,
    pub group_name: String,
    pub name: String,
    pub description: String,
    pub enabled: bool,
    pub priority: i64,
    pub revision: i64,
    pub inherited: bool,
    pub active_version_id: Option<String>,
    pub draft_hash: Option<String>,
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyCollection {
    pub local: Vec<PolicySummary>,
    pub inherited: Vec<PolicySummary>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreatePolicy {
    pub name: String,
    #[serde(default)]
    pub description: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdatePolicy {
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub enabled: bool,
    pub expected_revision: i64,
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
        let row = sqlx::query("SELECT policy_id, group_id, document_json, document_hash, author_user_id, updated_at FROM policy_drafts WHERE policy_id = ?")
            .bind(legacy_policy_id(group_id)).fetch_optional(&self.pool).await.map_err(database_error)?;
        row.map(draft_from_row).transpose()
    }

    pub async fn list_policies(
        &self,
        principal: &Principal,
        group_id: &str,
    ) -> Result<PolicyCollection, AppError> {
        self.authorization
            .require(principal, group_id, Capability::PoliciesView)
            .await?;
        let rows = sqlx::query(
            "WITH RECURSIVE ancestors(id,parent_id,name,depth) AS (
                SELECT id,parent_id,name,0 FROM groups WHERE id=? AND status!='archived'
                UNION ALL
                SELECT parent.id,parent.parent_id,parent.name,child.depth+1
                FROM groups parent JOIN ancestors child ON child.parent_id=parent.id
                WHERE parent.status!='archived'
            )
            SELECT policy.id,policy.group_id,ancestors.name AS group_name,policy.name,policy.description,
                   policy.enabled,policy.priority,policy.revision,policy.updated_at,ancestors.depth,
                   active.policy_version_id,draft.document_hash
            FROM ancestors JOIN policies policy ON policy.group_id=ancestors.id
            LEFT JOIN policy_active_versions active ON active.policy_id=policy.id
            LEFT JOIN policy_drafts draft ON draft.policy_id=policy.id
            ORDER BY ancestors.depth DESC,policy.priority ASC,policy.id ASC",
        )
        .bind(group_id)
        .fetch_all(&self.pool)
        .await
        .map_err(database_error)?;
        let mut local = Vec::new();
        let mut inherited = Vec::new();
        for row in rows {
            let summary = policy_summary_from_row(row)?;
            if summary.group_id == group_id { local.push(summary); } else { inherited.push(summary); }
        }
        Ok(PolicyCollection { local, inherited })
    }

    pub async fn create_policy(
        &self,
        principal: &Principal,
        group_id: &str,
        input: CreatePolicy,
    ) -> Result<PolicySummary, AppError> {
        require_human(principal)?;
        let name = normalize_policy_name(&input.name)?;
        if input.description.len() > 1_000 {
            return Err(AppError::BadRequest("policy description must be at most 1000 characters".into()));
        }
        let now = now();
        let id = Uuid::now_v7().to_string();
        let mut transaction = self.pool.begin().await.map_err(database_error)?;
        self.authorization.require_in_transaction(&mut transaction, principal, group_id, Capability::PoliciesEdit).await?;
        let priority: i64 = sqlx::query_scalar("SELECT COALESCE(MAX(priority),-1)+1 FROM policies WHERE group_id=?")
            .bind(group_id).fetch_one(&mut *transaction).await.map_err(database_error)?;
        sqlx::query("INSERT INTO policies(id,group_id,name,description,enabled,priority,created_by_user_id,created_at,updated_at,revision) VALUES(?,?,?,?,1,?,?,?, ?,1)")
            .bind(&id).bind(group_id).bind(&name).bind(input.description.trim()).bind(priority).bind(&principal.user_id).bind(now).bind(now)
            .execute(&mut *transaction).await.map_err(database_error)?;
        insert_policy_audit(&mut transaction, principal, "policy.created", &id, group_id, serde_json::json!({"name":name})).await?;
        transaction.commit().await.map_err(database_error)?;
        Ok(PolicySummary { id, group_id: group_id.into(), group_name: String::new(), name, description: input.description.trim().into(), enabled: true, priority, revision: 1, inherited: false, active_version_id: None, draft_hash: None, updated_at: now })
    }

    pub async fn get_policy_draft(
        &self,
        principal: &Principal,
        policy_id: &str,
    ) -> Result<Option<PolicyDraft>, AppError> {
        let group_id = self.policy_group(principal, policy_id, Capability::PoliciesView).await?;
        let row = sqlx::query("SELECT policy_id,group_id,document_json,document_hash,author_user_id,updated_at FROM policy_drafts WHERE policy_id=?")
            .bind(policy_id).fetch_optional(&self.pool).await.map_err(database_error)?;
        let draft = row.map(draft_from_row).transpose()?;
        if draft.as_ref().is_some_and(|draft| draft.group_id != group_id) { return Err(AppError::Internal("policy draft ownership mismatch".into())); }
        Ok(draft)
    }

    pub async fn save_policy_draft(
        &self,
        principal: &Principal,
        policy_id: &str,
        document: Value,
        expected_document_hash: Option<&str>,
    ) -> Result<PolicyDraft, AppError> {
        require_human(principal)?;
        let (_, normalized, hash) = normalize_and_validate(document)?;
        let now = now();
        let mut transaction = self.pool.begin().await.map_err(database_error)?;
        let group_id = self.policy_group_in_transaction(&mut transaction, principal, policy_id, Capability::PoliciesEdit).await?;
        let current = sqlx::query_scalar::<_, String>("SELECT document_hash FROM policy_drafts WHERE policy_id=?")
            .bind(policy_id).fetch_optional(&mut *transaction).await.map_err(database_error)?;
        if current.as_deref() != expected_document_hash {
            return Err(AppError::Conflict("policy draft changed by another administrator; reload before saving".into()));
        }
        sqlx::query("INSERT INTO policy_drafts(policy_id,group_id,document_json,document_hash,author_user_id,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(policy_id) DO UPDATE SET document_json=excluded.document_json,document_hash=excluded.document_hash,author_user_id=excluded.author_user_id,updated_at=excluded.updated_at")
            .bind(policy_id).bind(&group_id).bind(&normalized).bind(&hash).bind(&principal.user_id).bind(now)
            .execute(&mut *transaction).await.map_err(database_error)?;
        sqlx::query("DELETE FROM policy_draft_validations WHERE policy_id=? AND document_hash!=?").bind(policy_id).bind(&hash).execute(&mut *transaction).await.map_err(database_error)?;
        insert_policy_audit(&mut transaction, principal, "policy.draft_saved", policy_id, &group_id, serde_json::json!({"documentHash":hash})).await?;
        transaction.commit().await.map_err(database_error)?;
        Ok(PolicyDraft { policy_id: policy_id.into(), group_id, document: serde_json::from_str(&normalized).map_err(json_error)?, document_hash: hash, author_user_id: principal.user_id.clone(), updated_at: now })
    }

    pub async fn validate_policy_draft(
        &self,
        principal: &Principal,
        policy_id: &str,
    ) -> Result<DraftValidation, AppError> {
        require_human(principal)?;
        let group_id = self.policy_group(principal, policy_id, Capability::PoliciesEdit).await?;
        let row = sqlx::query("SELECT document_json,document_hash FROM policy_drafts WHERE policy_id=?")
            .bind(policy_id).fetch_optional(&self.pool).await.map_err(database_error)?
            .ok_or_else(|| AppError::BadRequest("policy draft does not exist".into()))?;
        let document: Value = serde_json::from_str(row.get::<String, _>("document_json").as_str()).map_err(json_error)?;
        let (_, _, document_hash) = normalize_and_validate(document)?;
        if document_hash != row.get::<String, _>("document_hash") {
            return Err(AppError::Conflict("stored policy draft failed canonical integrity verification".into()));
        }
        let now = now();
        sqlx::query("INSERT INTO policy_draft_validations(policy_id,document_hash,validated_by_user_id,validated_at) VALUES(?,?,?,?) ON CONFLICT(policy_id) DO UPDATE SET document_hash=excluded.document_hash,validated_by_user_id=excluded.validated_by_user_id,validated_at=excluded.validated_at")
            .bind(policy_id).bind(&document_hash).bind(&principal.user_id).bind(now).execute(&self.pool).await.map_err(database_error)?;
        let _ = group_id;
        Ok(DraftValidation { valid: true, document_hash })
    }

    pub async fn publish_policy(
        &self,
        principal: &Principal,
        policy_id: &str,
        summary: &str,
        validated_document_hash: &str,
    ) -> Result<PolicyVersion, AppError> {
        require_human(principal)?;
        if summary.trim().is_empty() { return Err(AppError::BadRequest("publish summary must not be empty".into())); }
        let mut transaction = self.pool.begin_with("BEGIN IMMEDIATE").await.map_err(database_error)?;
        let group_id = self.policy_group_in_transaction(&mut transaction, principal, policy_id, Capability::PoliciesPublish).await?;
        let draft = sqlx::query("SELECT document_json,document_hash FROM policy_drafts WHERE policy_id=?")
            .bind(policy_id).fetch_optional(&mut *transaction).await.map_err(database_error)?
            .ok_or_else(|| AppError::BadRequest("policy draft does not exist".into()))?;
        let stored_hash: String = draft.get("document_hash");
        if stored_hash != validated_document_hash { return Err(AppError::Conflict("save and validate the current draft before publishing".into())); }
        let validation: Option<String> = sqlx::query_scalar("SELECT document_hash FROM policy_draft_validations WHERE policy_id=?")
            .bind(policy_id).fetch_optional(&mut *transaction).await.map_err(database_error)?;
        if validation.as_deref() != Some(validated_document_hash) { return Err(AppError::Conflict("validate the current draft before publishing".into())); }
        let document: Value = serde_json::from_str(draft.get::<String, _>("document_json").as_str()).map_err(json_error)?;
        let (typed, normalized, hash) = normalize_and_validate(document)?;
        if hash != stored_hash { return Err(AppError::Conflict("stored policy draft failed canonical integrity verification".into())); }
        let id = Uuid::now_v7().to_string();
        let created_at = now();
        let compiled = compile_candidate_in_transaction(&mut transaction, &group_id, CandidatePolicyVersion { policy_id: policy_id.into(), version_id: &id, document: &typed, created_at }).await?;
        let compiled_hash = hex::encode(Sha256::digest(serde_json::to_vec(&compiled).map_err(json_error)?));
        let parent_version_ids = compiled.parent_versions;
        sqlx::query("INSERT INTO policy_versions(id,policy_id,group_id,document_json,document_hash,compiled_hash,author_user_id,summary,parent_version_ids_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
            .bind(&id).bind(policy_id).bind(&group_id).bind(&normalized).bind(&hash).bind(&compiled_hash).bind(&principal.user_id).bind(summary.trim()).bind(serde_json::to_string(&parent_version_ids).map_err(json_error)?).bind(created_at)
            .execute(&mut *transaction).await.map_err(database_error)?;
        sqlx::query("INSERT INTO policy_active_versions(policy_id,policy_version_id,activated_at) VALUES(?,?,?) ON CONFLICT(policy_id) DO UPDATE SET policy_version_id=excluded.policy_version_id,activated_at=excluded.activated_at")
            .bind(policy_id).bind(&id).bind(created_at).execute(&mut *transaction).await.map_err(database_error)?;
        insert_policy_audit(&mut transaction, principal, "policy.published", &id, &group_id, serde_json::json!({"policyId":policy_id,"summary":summary.trim(),"documentHash":hash,"compiledHash":compiled_hash})).await?;
        transaction.commit().await.map_err(database_error)?;
        Ok(PolicyVersion { id, policy_id: policy_id.into(), group_id, document: serde_json::from_str(&normalized).map_err(json_error)?, document_hash: hash, compiled_hash, author_user_id: principal.user_id.clone(), summary: summary.trim().into(), parent_version_ids, created_at })
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
        ensure_legacy_policy(&mut transaction, group_id, &principal.user_id, now).await?;
        let policy_id = legacy_policy_id(group_id);
        sqlx::query("INSERT INTO policy_drafts (policy_id, group_id, document_json, document_hash, author_user_id, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(policy_id) DO UPDATE SET document_json = excluded.document_json, document_hash = excluded.document_hash, author_user_id = excluded.author_user_id, updated_at = excluded.updated_at")
            .bind(&policy_id).bind(group_id).bind(&normalized).bind(&hash).bind(&principal.user_id).bind(now)
            .execute(&mut *transaction).await.map_err(database_error)?;
        transaction.commit().await.map_err(database_error)?;
        Ok(PolicyDraft {
            policy_id,
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
        let row = sqlx::query("SELECT document_json FROM policy_drafts WHERE policy_id = ?")
            .bind(legacy_policy_id(group_id))
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
            "SELECT document_json, document_hash FROM policy_drafts WHERE policy_id = ?",
        )
        .bind(legacy_policy_id(group_id))
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
        let policy_id = legacy_policy_id(group_id);
        let compiled = compile_candidate_in_transaction(
            &mut transaction,
            group_id,
            CandidatePolicyVersion {
                policy_id: policy_id.clone(),
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
        sqlx::query("INSERT INTO policy_versions (id, policy_id, group_id, document_json, document_hash, compiled_hash, author_user_id, summary, parent_version_ids_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
            .bind(&id).bind(&policy_id).bind(group_id).bind(&document_json).bind(&document_hash).bind(&compiled_hash)
            .bind(&principal.user_id).bind(summary.trim()).bind(&parent_json).bind(created_at)
            .execute(&mut *transaction).await.map_err(database_error)?;
        sqlx::query("INSERT INTO active_policies (group_id, policy_version_id, activated_at) VALUES (?, ?, ?) ON CONFLICT(group_id) DO UPDATE SET policy_version_id = excluded.policy_version_id, activated_at = excluded.activated_at")
            .bind(group_id).bind(&id).bind(created_at)
            .execute(&mut *transaction).await.map_err(database_error)?;
        sqlx::query("INSERT INTO policy_active_versions(policy_id,policy_version_id,activated_at) VALUES(?,?,?) ON CONFLICT(policy_id) DO UPDATE SET policy_version_id=excluded.policy_version_id,activated_at=excluded.activated_at")
            .bind(&policy_id).bind(&id).bind(created_at)
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
            policy_id,
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
        let rows = sqlx::query("SELECT id, policy_id, group_id, document_json, document_hash, compiled_hash, author_user_id, summary, parent_version_ids_json, created_at FROM policy_versions WHERE policy_id = ? AND (? IS NULL OR created_at < ? OR (created_at = ? AND id < ?)) ORDER BY created_at DESC, id DESC LIMIT ?")
            .bind(legacy_policy_id(group_id))
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

    async fn policy_group(
        &self,
        principal: &Principal,
        policy_id: &str,
        capability: Capability,
    ) -> Result<String, AppError> {
        let group_id: String = sqlx::query_scalar("SELECT group_id FROM policies WHERE id=?")
            .bind(policy_id).fetch_optional(&self.pool).await.map_err(database_error)?
            .ok_or_else(|| AppError::NotFound("policy not found".into()))?;
        self.authorization.require(principal, &group_id, capability).await?;
        Ok(group_id)
    }

    async fn policy_group_in_transaction(
        &self,
        transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
        principal: &Principal,
        policy_id: &str,
        capability: Capability,
    ) -> Result<String, AppError> {
        let group_id: String = sqlx::query_scalar("SELECT group_id FROM policies WHERE id=?")
            .bind(policy_id).fetch_optional(&mut **transaction).await.map_err(database_error)?
            .ok_or_else(|| AppError::NotFound("policy not found".into()))?;
        self.authorization.require_in_transaction(transaction, principal, &group_id, capability).await?;
        Ok(group_id)
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

fn normalize_policy_name(value: &str) -> Result<String, AppError> {
    let name = value.trim();
    if !(1..=120).contains(&name.chars().count()) {
        return Err(AppError::BadRequest("policy name must contain 1 to 120 characters".into()));
    }
    Ok(name.into())
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
        policy_id: row.get("policy_id"),
        group_id: row.get("group_id"),
        document: serde_json::from_str(&document_json).map_err(json_error)?,
        document_hash: row.get("document_hash"),
        author_user_id: row.get("author_user_id"),
        updated_at: row.get("updated_at"),
    })
}

fn policy_summary_from_row(row: sqlx::sqlite::SqliteRow) -> Result<PolicySummary, AppError> {
    let enabled: i64 = row.get("enabled");
    Ok(PolicySummary {
        id: row.get("id"),
        group_id: row.get("group_id"),
        group_name: row.get("group_name"),
        name: row.get("name"),
        description: row.get("description"),
        enabled: enabled != 0,
        priority: row.get("priority"),
        revision: row.get("revision"),
        inherited: row.get::<i64, _>("depth") != 0,
        active_version_id: row.get("policy_version_id"),
        draft_hash: row.get("document_hash"),
        updated_at: row.get("updated_at"),
    })
}

async fn insert_policy_audit(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    principal: &Principal,
    action: &str,
    policy_id: &str,
    group_id: &str,
    metadata: Value,
) -> Result<(), AppError> {
    sqlx::query("INSERT INTO audit_events(id,actor_user_id,action,target_type,target_id,metadata_json,created_at,authorized_group_id,request_id) VALUES(?,?,?,'policy',?,?,?, ?,NULL)")
        .bind(Uuid::now_v7().to_string()).bind(&principal.user_id).bind(action).bind(policy_id)
        .bind(serde_json::to_string(&metadata).map_err(json_error)?).bind(now()).bind(group_id)
        .execute(&mut **transaction).await.map_err(database_error)?;
    Ok(())
}

fn version_from_row(row: sqlx::sqlite::SqliteRow) -> Result<PolicyVersion, AppError> {
    let parent_json: String = row.get("parent_version_ids_json");
    let document_json: String = row.get("document_json");
    Ok(PolicyVersion {
        id: row.get("id"),
        policy_id: row.get("policy_id"),
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

fn legacy_policy_id(group_id: &str) -> String {
    format!("legacy-{group_id}")
}

async fn ensure_legacy_policy(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    group_id: &str,
    user_id: &str,
    timestamp: i64,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT OR IGNORE INTO policies(id,group_id,name,description,enabled,priority,created_by_user_id,created_at,updated_at,revision) SELECT ?,id,'Group policy','',1,0,?,?,?,1 FROM groups WHERE id=?",
    )
    .bind(legacy_policy_id(group_id))
    .bind(user_id)
    .bind(timestamp)
    .bind(timestamp)
    .bind(group_id)
    .execute(&mut **transaction)
    .await
    .map_err(database_error)?;
    Ok(())
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
