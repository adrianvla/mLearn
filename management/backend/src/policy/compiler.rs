use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{Row, Sqlite, Transaction};

use crate::{
    error::AppError,
    policy::model::{
        FeatureRule, LlmPolicy, PolicyAncestryEntry, PolicyDocument, QuotaRule, SettingRule,
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

pub(crate) async fn compile_in_transaction(
    transaction: &mut Transaction<'_, Sqlite>,
    group_id: &str,
) -> Result<CompiledPolicy, AppError> {
    let rows = sqlx::query(
        "WITH RECURSIVE ancestors(id, parent_id, name, depth) AS (
            SELECT id, parent_id, name, 0 FROM groups WHERE id = ? AND status != 'archived'
            UNION ALL
            SELECT parent.id, parent.parent_id, parent.name, child.depth + 1
            FROM groups parent JOIN ancestors child ON child.parent_id = parent.id
            WHERE parent.status != 'archived'
        )
        SELECT ancestors.id AS group_id, ancestors.name AS group_name,
               version.id AS version_id, version.document_json, version.created_at
        FROM ancestors
        LEFT JOIN active_policies active ON active.group_id = ancestors.id
        LEFT JOIN policy_versions version ON version.id = active.policy_version_id
        ORDER BY ancestors.depth DESC",
    )
    .bind(group_id)
    .fetch_all(&mut **transaction)
    .await
    .map_err(database_error)?;
    if rows.is_empty() {
        return Err(AppError::BadRequest("group is missing or archived".into()));
    }

    let ancestry = rows
        .iter()
        .map(|row| PolicyAncestryEntry {
            id: row.get("group_id"),
            name: row.get("group_name"),
        })
        .collect::<Vec<_>>();
    let definitions = rows
        .into_iter()
        .filter_map(|row| {
            let version_id = row.get::<Option<String>, _>("version_id")?;
            Some((row, version_id))
        })
        .map(|(row, version_id)| {
            let document_json: String = row.get("document_json");
            let document = serde_json::from_str(&document_json).map_err(|error| {
                AppError::Internal(format!("invalid stored policy version: {error}"))
            })?;
            Ok(ActiveDefinition {
                group_id: row.get("group_id"),
                group_name: row.get("group_name"),
                version_id,
                document,
                created_at: row.get("created_at"),
            })
        })
        .collect::<Result<Vec<_>, AppError>>()?;

    let mut settings = BTreeMap::new();
    let mut features = BTreeMap::new();
    let mut llm = LlmPolicy {
        enabled: false,
        allowed_providers: Vec::new(),
        allowed_models: Vec::new(),
        prompt_profile_id: None,
        quotas: Vec::new(),
    };
    let mut provider_limit = None::<BTreeSet<String>>;
    let mut model_limit = None::<BTreeSet<String>>;
    let mut quotas = BTreeMap::<String, QuotaRule>::new();
    let mut provenance = BTreeMap::new();

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
                .is_some_and(|inherited: &FeatureRule| inherited.hard)
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
                let key = format!("{:?}:{:?}", quota.metric, quota.period);
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
            effective.provenance["llm.quotas.Requests:Daily"].source_group_id,
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
            .history(&fixture.german_a_teacher, &fixture.german_a)
            .await
            .unwrap();
        assert_eq!(
            history[0].document,
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
}
