use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{Row, Sqlite, Transaction};

use crate::{
    error::AppError,
    policy::model::{
        default_max_concurrent_streams, default_requests_per_minute, FeatureRule, GovernancePolicy,
        LlmPolicy, PolicyAncestryEntry, PolicyDocument, QuotaRule, SettingRule,
    },
};

use super::service::{database_error, PolicyDraftDocument};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleProvenance {
    pub source_group_id: String,
    pub source_group_name: String,
    pub source_version_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompiledPolicy {
    pub document: PolicyDocument,
    pub provenance: BTreeMap<String, RuleProvenance>,
    pub parent_versions: Vec<String>,
}

struct ActiveDefinition {
    group_id: String,
    group_name: String,
    version_id: String,
    document: PolicyDraftDocument,
    created_at: i64,
}

pub(crate) struct CandidatePolicyVersion<'a> {
    pub policy_id: String,
    pub version_id: &'a str,
    pub document: &'a PolicyDraftDocument,
    pub created_at: i64,
}

pub(crate) async fn compile_in_transaction(
    transaction: &mut Transaction<'_, Sqlite>,
    group_id: &str,
) -> Result<CompiledPolicy, AppError> {
    compile_with_candidate_in_transaction(transaction, group_id, None).await
}

pub(crate) async fn compile_candidate_in_transaction(
    transaction: &mut Transaction<'_, Sqlite>,
    group_id: &str,
    candidate: CandidatePolicyVersion<'_>,
) -> Result<CompiledPolicy, AppError> {
    compile_with_candidate_in_transaction(transaction, group_id, Some(candidate)).await
}

async fn compile_with_candidate_in_transaction(
    transaction: &mut Transaction<'_, Sqlite>,
    group_id: &str,
    candidate: Option<CandidatePolicyVersion<'_>>,
) -> Result<CompiledPolicy, AppError> {
    let ancestor_rows = sqlx::query(
        "WITH RECURSIVE ancestors(id, parent_id, name, depth) AS (
            SELECT id, parent_id, name, 0 FROM groups WHERE id = ? AND status != 'archived'
            UNION ALL
            SELECT parent.id, parent.parent_id, parent.name, child.depth + 1
            FROM groups parent JOIN ancestors child ON child.parent_id = parent.id
            WHERE parent.status != 'archived'
        )
        SELECT id AS group_id, name AS group_name, depth FROM ancestors
        ORDER BY ancestors.depth DESC",
    )
    .bind(group_id)
    .fetch_all(&mut **transaction)
    .await
    .map_err(database_error)?;
    if ancestor_rows.is_empty() {
        return Err(AppError::BadRequest("group is missing or archived".into()));
    }

    let ancestry = ancestor_rows
        .iter()
        .map(|row| PolicyAncestryEntry {
            id: row.get("group_id"),
            name: row.get("group_name"),
        })
        .collect::<Vec<_>>();
    let rows = sqlx::query(
        "WITH RECURSIVE ancestors(id, parent_id, name, depth) AS (
            SELECT id, parent_id, name, 0 FROM groups WHERE id = ? AND status != 'archived'
            UNION ALL
            SELECT parent.id, parent.parent_id, parent.name, child.depth + 1
            FROM groups parent JOIN ancestors child ON child.parent_id = parent.id
            WHERE parent.status != 'archived'
        )
        SELECT ancestors.id AS group_id, ancestors.name AS group_name, policy.id AS policy_id,
               version.id AS version_id, version.document_json, version.created_at, policy.priority, ancestors.depth AS depth
        FROM ancestors JOIN policies policy ON policy.group_id = ancestors.id AND policy.enabled = 1
        JOIN policy_active_versions active ON active.policy_id = policy.id
        JOIN policy_versions version ON version.id = active.policy_version_id
        UNION ALL
        SELECT ancestors.id AS group_id, ancestors.name AS group_name, 'legacy-' || ancestors.id AS policy_id,
               version.id AS version_id, version.document_json, version.created_at, 0 AS priority, ancestors.depth AS depth
        FROM ancestors JOIN active_policies active ON active.group_id = ancestors.id
        JOIN policy_versions version ON version.id = active.policy_version_id
        WHERE NOT EXISTS (SELECT 1 FROM policy_active_versions named WHERE named.policy_version_id = version.id)
        ORDER BY depth DESC, priority ASC, policy_id ASC",
    )
    .bind(group_id)
    .fetch_all(&mut **transaction)
    .await
    .map_err(database_error)?;
    let mut definitions = Vec::new();
    for row in rows {
        let row_group_id: String = row.get("group_id");
        let group_name: String = row.get("group_name");
        let policy_id: String = row.get("policy_id");
        if candidate.as_ref().is_some_and(|candidate| row_group_id == group_id && candidate.policy_id == policy_id) {
            continue;
        }
        let version_id: String = row.get("version_id");
        let document_json: String = row.get("document_json");
        let document = serde_json::from_str(&document_json).map_err(|error| {
            AppError::Internal(format!("invalid stored policy version: {error}"))
        })?;
        definitions.push(ActiveDefinition {
            group_id: row_group_id,
            group_name,
            version_id,
            document,
            created_at: row.get("created_at"),
        });
    }
    if let Some(candidate) = candidate {
        let group_name = ancestry.last().map(|entry| entry.name.clone()).unwrap_or_default();
        definitions.push(ActiveDefinition {
            group_id: group_id.to_string(),
            group_name,
            version_id: candidate.version_id.to_string(),
            document: candidate.document.clone(),
            created_at: candidate.created_at,
        });
    }

    let mut settings = BTreeMap::new();
    let mut features = BTreeMap::new();
    let mut llm = LlmPolicy {
        enabled: false,
        requests_per_minute: default_requests_per_minute(),
        max_concurrent_streams: default_max_concurrent_streams(),
        allowed_providers: Vec::new(),
        allowed_models: Vec::new(),
        prompt_profile_id: None,
        quotas: Vec::new(),
    };
    let mut provider_limit = None::<BTreeSet<String>>;
    let mut model_limit = None::<BTreeSet<String>>;
    let mut quotas = BTreeMap::<String, QuotaRule>::new();
    let mut provenance = BTreeMap::new();
    let mut activity_retention_days = 90_u16;
    let mut conversation_retention_days = 90_u16;
    let mut teacher_analytics_export = None::<bool>;
    let mut teacher_conversation_export = None::<bool>;

    for definition in &definitions {
        for (key, rule) in &definition.document.settings {
            settings.insert(
                key.clone(),
                SettingRule {
                    value: rule.value.clone(),
                    source_group_id: definition.group_id.clone(),
                    source_group_name: definition.group_name.clone(),
                    locked: true,
                },
            );
            provenance.insert(format!("settings.{key}"), definition.provenance());
        }
        for (key, rule) in &definition.document.features {
            if features
                .get(key)
                .is_some_and(|inherited: &FeatureRule| inherited.hard && !inherited.enabled)
            {
                continue;
            }
            features.insert(
                key.clone(),
                FeatureRule {
                    enabled: rule.enabled,
                    source_group_id: definition.group_id.clone(),
                    hard: rule.hard,
                },
            );
            provenance.insert(format!("features.{key}"), definition.provenance());
        }
        if let Some(draft_llm) = &definition.document.llm {
            if let Some(enabled) = draft_llm.enabled {
                llm.enabled = enabled;
                provenance.insert("llm.enabled".into(), definition.provenance());
            }
            if let Some(limit) = draft_llm.requests_per_minute {
                llm.requests_per_minute = llm.requests_per_minute.min(limit);
                provenance.insert("llm.requestsPerMinute".into(), definition.provenance());
            }
            if let Some(limit) = draft_llm.max_concurrent_streams {
                llm.max_concurrent_streams = llm.max_concurrent_streams.min(limit);
                provenance.insert("llm.maxConcurrentStreams".into(), definition.provenance());
            }
            merge_allowlist(
                &mut provider_limit,
                draft_llm.allowed_providers.as_ref(),
                "llm.allowedProviders",
                definition,
                &mut provenance,
            );
            merge_allowlist(
                &mut model_limit,
                draft_llm.allowed_models.as_ref(),
                "llm.allowedModels",
                definition,
                &mut provenance,
            );
            if let Some(prompt_profile_id) = &draft_llm.prompt_profile_id {
                llm.prompt_profile_id = prompt_profile_id.clone();
                provenance.insert("llm.promptProfileId".into(), definition.provenance());
            }
            for quota in &draft_llm.quotas {
                let key = format!("{}:{}", quota.metric.as_str(), quota.period.as_str());
                let existing = quotas.get(&key);
                if existing.is_some_and(|current| current.limit <= quota.limit) {
                    continue;
                }
                let inherited_hard = existing.is_some_and(|current| current.hard);
                quotas.insert(
                    key.clone(),
                    QuotaRule {
                        metric: quota.metric,
                        limit: quota.limit,
                        period: quota.period,
                        source_group_id: definition.group_id.clone(),
                        hard: inherited_hard || quota.hard,
                    },
                );
                provenance.insert(format!("llm.quotas.{key}"), definition.provenance());
            }
        }
        if let Some(governance) = &definition.document.governance {
            if let Some(days) = governance.activity_retention_days {
                activity_retention_days = activity_retention_days.min(days);
                provenance.insert(
                    "governance.activityRetentionDays".into(),
                    definition.provenance(),
                );
            }
            if let Some(days) = governance.conversation_retention_days {
                conversation_retention_days = conversation_retention_days.min(days);
                provenance.insert(
                    "governance.conversationRetentionDays".into(),
                    definition.provenance(),
                );
            }
            if let Some(value) = governance.teacher_analytics_export {
                teacher_analytics_export =
                    Some(teacher_analytics_export.map_or(value, |inherited| inherited && value));
                provenance.insert(
                    "governance.teacherAnalyticsExport".into(),
                    definition.provenance(),
                );
            }
            if let Some(value) = governance.teacher_conversation_export {
                teacher_conversation_export =
                    Some(teacher_conversation_export.map_or(value, |inherited| inherited && value));
                provenance.insert(
                    "governance.teacherConversationExport".into(),
                    definition.provenance(),
                );
            }
        }
    }
    llm.allowed_providers = provider_limit.unwrap_or_default().into_iter().collect();
    llm.allowed_models = model_limit.unwrap_or_default().into_iter().collect();
    llm.quotas = quotas.into_values().collect();

    let version_ids = definitions
        .iter()
        .map(|definition| definition.version_id.as_str())
        .collect::<Vec<_>>();
    let policy_version_id = hex::encode(Sha256::digest(version_ids.join("\n").as_bytes()));
    let target_version = definitions
        .iter()
        .find(|definition| definition.group_id == group_id)
        .map(|definition| definition.version_id.as_str());
    let parent_versions = definitions
        .iter()
        .filter(|definition| Some(definition.version_id.as_str()) != target_version)
        .map(|definition| definition.version_id.clone())
        .collect();
    let issued_at = definitions
        .iter()
        .map(|definition| definition.created_at)
        .max()
        .unwrap_or_default()
        .to_string();

    Ok(CompiledPolicy {
        document: PolicyDocument {
            schema_version: 1,
            policy_version_id,
            active_group_id: group_id.to_string(),
            ancestry,
            settings,
            features,
            llm,
            governance: GovernancePolicy {
                activity_retention_days,
                conversation_retention_days,
                teacher_analytics_export: teacher_analytics_export.unwrap_or(false),
                teacher_conversation_export: teacher_conversation_export.unwrap_or(false),
            },
            issued_at,
            expires_at: String::new(),
            key_id: String::new(),
            signature: String::new(),
        },
        provenance,
        parent_versions,
    })
}

impl ActiveDefinition {
    fn provenance(&self) -> RuleProvenance {
        RuleProvenance {
            source_group_id: self.group_id.clone(),
            source_group_name: self.group_name.clone(),
            source_version_id: self.version_id.clone(),
        }
    }
}

fn merge_allowlist(
    current: &mut Option<BTreeSet<String>>,
    proposed: Option<&Vec<String>>,
    path: &str,
    definition: &ActiveDefinition,
    provenance: &mut BTreeMap<String, RuleProvenance>,
) {
    let Some(proposed) = proposed else { return };
    let proposed = proposed.iter().cloned().collect::<BTreeSet<_>>();
    let merged = current.as_ref().map_or_else(
        || proposed.clone(),
        |existing| existing.intersection(&proposed).cloned().collect(),
    );
    if current.as_ref() != Some(&merged) {
        provenance.insert(path.to_string(), definition.provenance());
    }
    *current = Some(merged);
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use sha2::Digest;

    use crate::{
        authorization::Capability, groups::tests::GroupFixture, policy::service::PolicyService,
    };

    async fn grant_policy_capabilities(fixture: &GroupFixture) {
        sqlx::query("INSERT INTO group_memberships (id, group_id, user_id, status, created_at) VALUES ('membership-policy-root', ?, ?, 'active', 1)")
            .bind(&fixture.german)
            .bind(&fixture.german_a_teacher.user_id)
            .execute(&fixture.pool)
            .await
            .unwrap();
        for capability in [
            Capability::PoliciesView,
            Capability::PoliciesEdit,
            Capability::PoliciesPublish,
        ] {
            sqlx::query(
                "INSERT INTO membership_capabilities (membership_id, capability) VALUES ('membership-policy-root', ?)",
            )
            .bind(capability.as_str())
            .execute(&fixture.pool)
            .await
            .unwrap();
        }
    }

    #[tokio::test]
    async fn child_specializes_language_but_cannot_weaken_parent_hard_deny() {
        let fixture = GroupFixture::german_tree().await;
        grant_policy_capabilities(&fixture).await;
        let service = PolicyService::new(fixture.pool.clone());

        service
            .save_draft(
                &fixture.german_a_teacher,
                &fixture.german,
                json!({"features":{"cloud_tts":{"enabled":false,"hard":true}}}),
            )
            .await
            .unwrap();
        service
            .publish(&fixture.german_a_teacher, &fixture.german, "deny cloud TTS")
            .await
            .unwrap();
        service
            .save_draft(
                &fixture.german_a_teacher,
                &fixture.german_a,
                json!({
                    "settings":{"language":{"value":"de","locked":true}},
                    "features":{"cloud_tts":{"enabled":true,"hard":false}}
                }),
            )
            .await
            .unwrap();
        service
            .publish(
                &fixture.german_a_teacher,
                &fixture.german_a,
                "set German profile",
            )
            .await
            .unwrap();

        let effective = service
            .effective_for_group(&fixture.german_a_teacher, &fixture.german_a)
            .await
            .unwrap();
        assert_eq!(effective.document.settings["language"].value, json!("de"));
        assert!(!effective.document.features["cloud_tts"].enabled);
        assert_eq!(
            effective.document.features["cloud_tts"].source_group_id,
            fixture.german
        );
    }

    #[tokio::test]
    async fn saved_child_draft_is_inert_until_published() {
        let fixture = GroupFixture::german_tree().await;
        grant_policy_capabilities(&fixture).await;
        let service = PolicyService::new(fixture.pool.clone());
        service
            .save_draft(
                &fixture.german_a_teacher,
                &fixture.german,
                json!({"features":{"cloud_tts":{"enabled":false,"hard":false}}}),
            )
            .await
            .unwrap();
        service
            .publish(&fixture.german_a_teacher, &fixture.german, "root policy")
            .await
            .unwrap();
        let before = service
            .effective_for_group(&fixture.german_a_teacher, &fixture.german_a)
            .await
            .unwrap();

        service
            .save_draft(
                &fixture.german_a_teacher,
                &fixture.german_a,
                json!({"features":{"cloud_tts":{"enabled":true}}}),
            )
            .await
            .unwrap();
        let after = service
            .effective_for_group(&fixture.german_a_teacher, &fixture.german_a)
            .await
            .unwrap();

        assert_eq!(before, after);
        assert!(!after.document.features["cloud_tts"].enabled);
    }

    #[tokio::test]
    async fn child_quota_can_tighten_but_not_raise_parent_maximum() {
        let fixture = GroupFixture::german_tree().await;
        grant_policy_capabilities(&fixture).await;
        let service = PolicyService::new(fixture.pool.clone());
        service
            .save_draft(
                &fixture.german_a_teacher,
                &fixture.german,
                json!({"llm":{"quotas":[{"metric":"requests","limit":100,"period":"daily","hard":true}]}}),
            )
            .await
            .unwrap();
        service
            .publish(&fixture.german_a_teacher, &fixture.german, "root quota")
            .await
            .unwrap();
        service
            .save_draft(
                &fixture.german_a_teacher,
                &fixture.german_a,
                json!({"llm":{"quotas":[{"metric":"requests","limit":200,"period":"daily"}]}}),
            )
            .await
            .unwrap();
        service
            .publish(
                &fixture.german_a_teacher,
                &fixture.german_a,
                "attempt wider quota",
            )
            .await
            .unwrap();

        let effective = service
            .effective_for_group(&fixture.german_a_teacher, &fixture.german_a)
            .await
            .unwrap();
        assert_eq!(effective.document.llm.quotas[0].limit, 100);
        assert_eq!(
            effective.document.llm.quotas[0].source_group_id,
            fixture.german
        );
        assert_eq!(
            effective.provenance["llm.quotas.requests:daily"].source_group_id,
            fixture.german
        );
    }

    #[tokio::test]
    async fn published_versions_are_immutable_and_audit_failure_rolls_back_activation() {
        let fixture = GroupFixture::german_tree().await;
        grant_policy_capabilities(&fixture).await;
        let service = PolicyService::new(fixture.pool.clone());
        service
            .save_draft(
                &fixture.german_a_teacher,
                &fixture.german_a,
                json!({"features":{"cloud_tts":{"enabled":false}}}),
            )
            .await
            .unwrap();
        let published = service
            .publish(
                &fixture.german_a_teacher,
                &fixture.german_a,
                "initial policy",
            )
            .await
            .unwrap();
        let history = service
            .history(&fixture.german_a_teacher, &fixture.german_a, None, 50)
            .await
            .unwrap();
        assert_eq!(
            history.items[0].document,
            json!({"features":{"cloud_tts":{"enabled":false,"hard":false}}})
        );
        assert!(sqlx::query("INSERT INTO active_policies (group_id, policy_version_id, activated_at) VALUES (?, ?, 1)")
            .bind(&fixture.project_1)
            .bind(&published.id)
            .execute(&fixture.pool)
            .await
            .is_err());
        assert!(
            sqlx::query("UPDATE policy_versions SET summary = 'changed' WHERE id = ?")
                .bind(&published.id)
                .execute(&fixture.pool)
                .await
                .is_err()
        );
        assert!(sqlx::query("DELETE FROM policy_versions WHERE id = ?")
            .bind(&published.id)
            .execute(&fixture.pool)
            .await
            .is_err());

        sqlx::query("CREATE TRIGGER fail_policy_publish_audit BEFORE INSERT ON audit_events WHEN NEW.action = 'policy.published' BEGIN SELECT RAISE(ABORT, 'injected audit failure'); END")
            .execute(&fixture.pool).await.unwrap();
        service
            .save_draft(
                &fixture.german_a_teacher,
                &fixture.project_1,
                json!({"features":{"cloud_tts":{"enabled":true}}}),
            )
            .await
            .unwrap();
        assert!(service
            .publish(
                &fixture.german_a_teacher,
                &fixture.project_1,
                "must roll back",
            )
            .await
            .is_err());
        let versions: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM policy_versions WHERE group_id = ?")
                .bind(&fixture.project_1)
                .fetch_one(&fixture.pool)
                .await
                .unwrap();
        let active: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM active_policies WHERE group_id = ?")
                .bind(&fixture.project_1)
                .fetch_one(&fixture.pool)
                .await
                .unwrap();
        assert_eq!((versions, active), (0, 0));
    }

    #[tokio::test]
    async fn publish_rejects_stored_draft_that_no_longer_passes_registry_validation() {
        let fixture = GroupFixture::german_tree().await;
        grant_policy_capabilities(&fixture).await;
        let service = PolicyService::new(fixture.pool.clone());
        service
            .save_draft(
                &fixture.german_a_teacher,
                &fixture.german_a,
                json!({"settings":{"language":{"value":"de","locked":true}}}),
            )
            .await
            .unwrap();
        sqlx::query("UPDATE policy_drafts SET document_json = ? WHERE group_id = ?")
            .bind(r#"{"settings":{"cloudAuthAccessToken":{"value":"secret","locked":true}}}"#)
            .bind(&fixture.german_a)
            .execute(&fixture.pool)
            .await
            .unwrap();

        assert!(service
            .publish(
                &fixture.german_a_teacher,
                &fixture.german_a,
                "must reject stale draft",
            )
            .await
            .is_err());
        let versions: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM policy_versions WHERE group_id = ?")
                .bind(&fixture.german_a)
                .fetch_one(&fixture.pool)
                .await
                .unwrap();
        assert_eq!(versions, 0);
    }

    #[tokio::test]
    async fn publish_rejects_unsafe_integer_even_when_stored_hash_matches() {
        let fixture = GroupFixture::german_tree().await;
        grant_policy_capabilities(&fixture).await;
        let service = PolicyService::new(fixture.pool.clone());
        service
            .save_draft(
                &fixture.german_a_teacher,
                &fixture.german_a,
                json!({"settings":{"subtitle_font_size":{"value":20.5,"locked":true}}}),
            )
            .await
            .unwrap();
        let unsafe_document =
            r#"{"settings":{"subtitle_font_size":{"value":9007199254740992,"locked":true}}}"#;
        let unsafe_hash = hex::encode(sha2::Sha256::digest(unsafe_document.as_bytes()));
        sqlx::query(
            "UPDATE policy_drafts SET document_json = ?, document_hash = ? WHERE group_id = ?",
        )
        .bind(unsafe_document)
        .bind(unsafe_hash)
        .bind(&fixture.german_a)
        .execute(&fixture.pool)
        .await
        .unwrap();

        assert!(service
            .publish(
                &fixture.german_a_teacher,
                &fixture.german_a,
                "must reject unsafe integer",
            )
            .await
            .is_err());
        let versions: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM policy_versions WHERE group_id = ?")
                .bind(&fixture.german_a)
                .fetch_one(&fixture.pool)
                .await
                .unwrap();
        assert_eq!(versions, 0);
    }

    #[tokio::test]
    async fn publish_rejects_stored_draft_hash_mismatch() {
        let fixture = GroupFixture::german_tree().await;
        grant_policy_capabilities(&fixture).await;
        let service = PolicyService::new(fixture.pool.clone());
        service
            .save_draft(
                &fixture.german_a_teacher,
                &fixture.german_a,
                json!({"features":{"cloud_tts":{"enabled":false}}}),
            )
            .await
            .unwrap();
        sqlx::query("UPDATE policy_drafts SET document_hash = 'stale' WHERE group_id = ?")
            .bind(&fixture.german_a)
            .execute(&fixture.pool)
            .await
            .unwrap();

        assert!(service
            .publish(
                &fixture.german_a_teacher,
                &fixture.german_a,
                "must reject stale hash",
            )
            .await
            .is_err());
    }

    #[tokio::test]
    async fn compiled_hash_attests_candidate_with_captured_parent_versions() {
        let fixture = GroupFixture::german_tree().await;
        grant_policy_capabilities(&fixture).await;
        let service = PolicyService::new(fixture.pool.clone());
        service
            .save_draft(
                &fixture.german_a_teacher,
                &fixture.german,
                json!({"settings":{"language":{"value":"en","locked":true}}}),
            )
            .await
            .unwrap();
        let first_parent = service
            .publish(&fixture.german_a_teacher, &fixture.german, "English")
            .await
            .unwrap();
        service
            .save_draft(
                &fixture.german_a_teacher,
                &fixture.german_a,
                json!({"features":{"cloud_tts":{"enabled":false}}}),
            )
            .await
            .unwrap();
        let first_child = service
            .publish(&fixture.german_a_teacher, &fixture.german_a, "child policy")
            .await
            .unwrap();

        service
            .save_draft(
                &fixture.german_a_teacher,
                &fixture.german,
                json!({"settings":{"language":{"value":"fr","locked":true}}}),
            )
            .await
            .unwrap();
        let second_parent = service
            .publish(&fixture.german_a_teacher, &fixture.german, "French")
            .await
            .unwrap();
        let second_child = service
            .publish(
                &fixture.german_a_teacher,
                &fixture.german_a,
                "same child policy",
            )
            .await
            .unwrap();

        assert_eq!(first_child.document_hash, second_child.document_hash);
        assert_ne!(first_child.compiled_hash, second_child.compiled_hash);
        assert_ne!(second_child.document_hash, second_child.compiled_hash);
        assert_eq!(first_child.parent_version_ids, vec![first_parent.id]);
        assert_eq!(second_child.parent_version_ids, vec![second_parent.id]);
        let effective = service
            .effective_for_group(&fixture.german_a_teacher, &fixture.german_a)
            .await
            .unwrap();
        let effective_hash = hex::encode(sha2::Sha256::digest(
            serde_json::to_vec(&effective).unwrap(),
        ));
        assert_eq!(second_child.compiled_hash, effective_hash);
        let metadata: String = sqlx::query_scalar(
            "SELECT metadata_json FROM audit_events WHERE action = 'policy.published' AND target_id = ?",
        )
        .bind(&second_child.id)
        .fetch_one(&fixture.pool)
        .await
        .unwrap();
        let metadata: serde_json::Value = serde_json::from_str(&metadata).unwrap();
        assert_eq!(metadata["compiledHash"], json!(second_child.compiled_hash));
    }

    #[tokio::test]
    async fn history_pages_same_timestamp_versions_by_created_at_and_id() {
        let fixture = GroupFixture::german_tree().await;
        grant_policy_capabilities(&fixture).await;
        let service = PolicyService::new(fixture.pool.clone());
        service
            .save_draft(
                &fixture.german_a_teacher,
                &fixture.german_a,
                json!({"features":{"cloud_tts":{"enabled":false}}}),
            )
            .await
            .unwrap();
        for summary in ["one", "two", "three"] {
            service
                .publish(&fixture.german_a_teacher, &fixture.german_a, summary)
                .await
                .unwrap();
        }

        let expected: Vec<String> = sqlx::query_scalar(
            "SELECT id FROM policy_versions WHERE group_id = ? ORDER BY created_at DESC, id DESC",
        )
        .bind(&fixture.german_a)
        .fetch_all(&fixture.pool)
        .await
        .unwrap();
        let same_timestamp_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM policy_versions WHERE group_id = ? AND created_at = (SELECT MAX(created_at) FROM policy_versions WHERE group_id = ?)",
        )
        .bind(&fixture.german_a)
        .bind(&fixture.german_a)
        .fetch_one(&fixture.pool)
        .await
        .unwrap();
        assert!(same_timestamp_count >= 2);

        let first = service
            .history(&fixture.german_a_teacher, &fixture.german_a, None, 2)
            .await
            .unwrap();
        let second = service
            .history(
                &fixture.german_a_teacher,
                &fixture.german_a,
                first.next_cursor.as_deref(),
                2,
            )
            .await
            .unwrap();
        let actual = first
            .items
            .iter()
            .chain(&second.items)
            .map(|version| version.id.clone())
            .collect::<Vec<_>>();

        assert_eq!(actual, expected);
        assert!(first.next_cursor.is_some());
        assert!(second.next_cursor.is_none());
        let clamped = service
            .history(&fixture.german_a_teacher, &fixture.german_a, None, 0)
            .await
            .unwrap();
        assert_eq!(clamped.items.len(), 1);
    }

    #[tokio::test]
    async fn legacy_parent_hard_enabled_rule_does_not_block_child_deny() {
        let fixture = GroupFixture::german_tree().await;
        grant_policy_capabilities(&fixture).await;
        let service = PolicyService::new(fixture.pool.clone());
        sqlx::query("INSERT INTO policy_versions (id, group_id, document_json, document_hash, compiled_hash, author_user_id, summary, parent_version_ids_json, created_at) VALUES ('legacy-hard-enable', ?, ?, 'legacy-local', 'legacy-compiled', ?, 'legacy', '[]', 1)")
            .bind(&fixture.german)
            .bind(r#"{"features":{"cloud_tts":{"enabled":true,"hard":true}}}"#)
            .bind(&fixture.german_a_teacher.user_id)
            .execute(&fixture.pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO active_policies (group_id, policy_version_id, activated_at) VALUES (?, 'legacy-hard-enable', 1)")
            .bind(&fixture.german)
            .execute(&fixture.pool)
            .await
            .unwrap();
        service
            .save_draft(
                &fixture.german_a_teacher,
                &fixture.german_a,
                json!({"features":{"cloud_tts":{"enabled":false}}}),
            )
            .await
            .unwrap();
        service
            .publish(
                &fixture.german_a_teacher,
                &fixture.german_a,
                "tighten legacy rule",
            )
            .await
            .unwrap();

        let effective = service
            .effective_for_group(&fixture.german_a_teacher, &fixture.german_a)
            .await
            .unwrap();
        assert!(!effective.document.features["cloud_tts"].enabled);
        assert_eq!(
            effective.document.features["cloud_tts"].source_group_id,
            fixture.german_a
        );
    }
}
