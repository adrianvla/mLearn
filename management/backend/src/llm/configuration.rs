use std::sync::Arc;

use serde::Serialize;
use sha2::{Digest, Sha256};
use sqlx::{Row, SqlitePool};
use time::OffsetDateTime;
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::{
    authorization::{AuthorizationService, Capability},
    crypto::{EncryptedSecret, SecretCipher},
    error::AppError,
    identity::Principal,
    policy::compiler::compile_in_transaction,
};

pub use super::endpoint::ProviderKind;
use super::endpoint::{validate_base_url, EndpointResolver, PinnedEndpoint, TokioEndpointResolver};

const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LlmProvider {
    pub id: String,
    pub group_id: String,
    pub name: String,
    pub provider_kind: ProviderKind,
    pub base_url: String,
    pub status: String,
    pub has_secret: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LlmModel {
    pub id: String,
    pub group_id: String,
    pub provider_id: String,
    pub model_key: String,
    pub upstream_model: String,
    pub status: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PromptProfile {
    pub id: String,
    pub group_id: String,
    pub name: String,
    pub system_prompt: String,
    pub status: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderPriceVersion {
    pub id: String,
    pub group_id: String,
    pub provider_id: String,
    pub model_id: Option<String>,
    pub currency: String,
    pub unit: String,
    pub input_cost_micros: i64,
    pub output_cost_micros: i64,
    pub created_at: i64,
}

#[allow(dead_code)] // Consumed by the streaming provider adapter in LLM Gateway Task 3.
pub(crate) struct ResolvedSecret(Zeroizing<String>);

#[allow(dead_code)] // Consumed by the streaming provider adapter in LLM Gateway Task 3.
impl ResolvedSecret {
    pub(crate) fn expose(&self) -> &str {
        self.0.as_str()
    }
}

#[allow(dead_code)] // Consumed by the streaming provider adapter in LLM Gateway Task 3.
pub(crate) struct ResolvedLlmRoute {
    pub(crate) policy_version_id: String,
    pub(crate) policy_compiled_hash: String,
    pub(crate) provider_id: String,
    pub(crate) model_id: String,
    pub(crate) provider_kind: ProviderKind,
    #[allow(dead_code)] // Consumed by the streaming provider adapter in LLM Gateway Task 3.
    pub(crate) secret: Option<ResolvedSecret>,
    pub(crate) model: String,
    pub(crate) prompt_profile_id: Option<String>,
    pub(crate) system_prompt: Option<String>,
    pub(crate) price_version: ProviderPriceVersion,
    #[allow(dead_code)] // Consumed by the streaming provider adapter in LLM Gateway Task 3.
    pub(crate) endpoint: PinnedEndpoint,
}

pub(crate) struct ResolvedLlmRouteConfig {
    pub(crate) policy_version_id: String,
    pub(crate) policy_compiled_hash: String,
    pub(crate) provider_id: String,
    pub(crate) model_id: String,
    pub(crate) provider_kind: ProviderKind,
    pub(crate) secret: Option<ResolvedSecret>,
    pub(crate) model: String,
    pub(crate) prompt_profile_id: Option<String>,
    pub(crate) system_prompt: Option<String>,
    pub(crate) price_version: ProviderPriceVersion,
    pub(crate) config_fingerprint: [u8; 32],
    pub(crate) requests_per_minute: u32,
    pub(crate) max_concurrent_streams: u16,
    base_url: String,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderHealth {
    pub provider_id: String,
    pub configuration_valid: bool,
    pub has_secret: bool,
    pub network_check_performed: bool,
}

#[derive(Clone)]
pub struct LlmConfigurationService {
    pool: SqlitePool,
    cipher: SecretCipher,
    authorization: AuthorizationService,
    #[allow(dead_code)] // Resolve-at-use contract is consumed by LLM Gateway Task 3.
    resolver: Arc<dyn EndpointResolver>,
}

impl LlmConfigurationService {
    pub fn new(pool: SqlitePool, cipher: SecretCipher) -> Self {
        Self {
            authorization: AuthorizationService::new(pool.clone()),
            pool,
            cipher,
            resolver: Arc::new(TokioEndpointResolver),
        }
    }

    pub(crate) fn with_resolver(
        pool: SqlitePool,
        cipher: SecretCipher,
        resolver: Arc<dyn EndpointResolver>,
    ) -> Self {
        Self {
            authorization: AuthorizationService::new(pool.clone()),
            pool,
            cipher,
            resolver,
        }
    }

    pub async fn create_provider(
        &self,
        principal: &Principal,
        group_id: &str,
        name: &str,
        kind: ProviderKind,
        base_url: &str,
        secret: Option<&str>,
        idempotency_key: &str,
    ) -> Result<LlmProvider, AppError> {
        require_human(principal)?;
        validate_label("provider name", name, 120)?;
        let base_url = validate_base_url(kind, base_url)?;
        validate_secret(secret)?;
        let payload_hash = self.cipher.idempotency_fingerprint(
            "llm.provider.create",
            &[
                group_id,
                name.trim(),
                kind.as_str(),
                &base_url,
                secret.unwrap_or(""),
            ],
        );
        let mut tx = self
            .pool
            .begin_with("BEGIN IMMEDIATE")
            .await
            .map_err(database_error)?;
        self.authorization
            .require_in_transaction(&mut tx, principal, group_id, Capability::LlmConfigure)
            .await?;
        if let Some(id) = mutation_replay(
            &mut tx,
            principal,
            group_id,
            "provider.create",
            idempotency_key,
            &payload_hash,
        )
        .await?
        {
            tx.commit().await.map_err(database_error)?;
            return self.provider(principal, &id).await;
        }
        let id = Uuid::now_v7().to_string();
        let envelope = secret
            .map(|value| {
                self.cipher
                    .encrypt(value.as_bytes(), &provider_secret_aad(&id))
            })
            .transpose()?;
        let now = now();
        sqlx::query("INSERT INTO llm_providers (id, group_id, name, provider_kind, base_url, secret_envelope, status, created_by_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)")
            .bind(&id).bind(group_id).bind(name.trim()).bind(kind.as_str()).bind(&base_url)
            .bind(envelope.as_ref().map(EncryptedSecret::as_persisted))
            .bind(&principal.user_id).bind(now).bind(now)
            .execute(&mut *tx).await.map_err(map_write_error)?;
        audit(
            &mut tx,
            principal,
            "llm.provider.created",
            "llm_provider",
            &id,
            group_id,
        )
        .await?;
        record_mutation(
            &mut tx,
            principal,
            group_id,
            "provider.create",
            idempotency_key,
            &payload_hash,
            &id,
        )
        .await?;
        tx.commit().await.map_err(database_error)?;
        self.provider(principal, &id).await
    }

    pub async fn update_provider_secret(
        &self,
        principal: &Principal,
        provider_id: &str,
        secret: Option<&str>,
        idempotency_key: &str,
    ) -> Result<LlmProvider, AppError> {
        require_human(principal)?;
        validate_secret(secret)?;
        let payload_hash = self.cipher.idempotency_fingerprint(
            "llm.provider.secret.rotate",
            &[provider_id, secret.unwrap_or("")],
        );
        let mut tx = self
            .pool
            .begin_with("BEGIN IMMEDIATE")
            .await
            .map_err(database_error)?;
        let group_id: String =
            sqlx::query_scalar("SELECT group_id FROM llm_providers WHERE id = ?")
                .bind(provider_id)
                .fetch_optional(&mut *tx)
                .await
                .map_err(database_error)?
                .ok_or_else(|| AppError::BadRequest("provider not found".into()))?;
        self.authorization
            .require_in_transaction(&mut tx, principal, &group_id, Capability::LlmConfigure)
            .await?;
        if mutation_replay(
            &mut tx,
            principal,
            &group_id,
            "provider.secret",
            idempotency_key,
            &payload_hash,
        )
        .await?
        .is_none()
        {
            let envelope = secret
                .map(|value| {
                    self.cipher
                        .encrypt(value.as_bytes(), &provider_secret_aad(provider_id))
                })
                .transpose()?;
            sqlx::query(
                "UPDATE llm_providers SET secret_envelope = ?, updated_at = ? WHERE id = ?",
            )
            .bind(envelope.as_ref().map(EncryptedSecret::as_persisted))
            .bind(now())
            .bind(provider_id)
            .execute(&mut *tx)
            .await
            .map_err(database_error)?;
            audit(
                &mut tx,
                principal,
                "llm.provider.secret_rotated",
                "llm_provider",
                provider_id,
                &group_id,
            )
            .await?;
            record_mutation(
                &mut tx,
                principal,
                &group_id,
                "provider.secret",
                idempotency_key,
                &payload_hash,
                provider_id,
            )
            .await?;
        }
        tx.commit().await.map_err(database_error)?;
        self.provider(principal, provider_id).await
    }

    pub async fn update_provider_metadata(
        &self,
        principal: &Principal,
        provider_id: &str,
        name: &str,
        kind: ProviderKind,
        base_url: &str,
        status: &str,
        idempotency_key: &str,
    ) -> Result<LlmProvider, AppError> {
        require_human(principal)?;
        validate_label("provider name", name, 120)?;
        validate_status(status)?;
        let base_url = validate_base_url(kind, base_url)?;
        let payload_hash =
            mutation_payload_hash(&[provider_id, name.trim(), kind.as_str(), &base_url, status]);
        let mut tx = self
            .pool
            .begin_with("BEGIN IMMEDIATE")
            .await
            .map_err(database_error)?;
        let group_id: String =
            sqlx::query_scalar("SELECT group_id FROM llm_providers WHERE id = ?")
                .bind(provider_id)
                .fetch_optional(&mut *tx)
                .await
                .map_err(database_error)?
                .ok_or_else(|| AppError::BadRequest("provider not found".into()))?;
        self.authorization
            .require_in_transaction(&mut tx, principal, &group_id, Capability::LlmConfigure)
            .await?;
        if mutation_replay(
            &mut tx,
            principal,
            &group_id,
            "provider.update",
            idempotency_key,
            &payload_hash,
        )
        .await?
        .is_none()
        {
            sqlx::query("UPDATE llm_providers SET name = ?, provider_kind = ?, base_url = ?, status = ?, updated_at = ? WHERE id = ?")
                .bind(name.trim()).bind(kind.as_str()).bind(&base_url).bind(status).bind(now()).bind(provider_id)
                .execute(&mut *tx).await.map_err(map_write_error)?;
            audit(
                &mut tx,
                principal,
                "llm.provider.updated",
                "llm_provider",
                provider_id,
                &group_id,
            )
            .await?;
            record_mutation(
                &mut tx,
                principal,
                &group_id,
                "provider.update",
                idempotency_key,
                &payload_hash,
                provider_id,
            )
            .await?;
        }
        tx.commit().await.map_err(database_error)?;
        self.provider(principal, provider_id).await
    }

    pub async fn provider(
        &self,
        principal: &Principal,
        provider_id: &str,
    ) -> Result<LlmProvider, AppError> {
        let row = sqlx::query("SELECT id, group_id, name, provider_kind, base_url, status, secret_envelope IS NOT NULL AS has_secret, created_at, updated_at FROM llm_providers WHERE id = ?")
            .bind(provider_id).fetch_optional(&self.pool).await.map_err(database_error)?
            .ok_or_else(|| AppError::BadRequest("provider not found".into()))?;
        let provider = provider_from_row(&row)?;
        self.authorization
            .require(principal, &provider.group_id, Capability::LlmConfigure)
            .await?;
        Ok(provider)
    }

    pub async fn list_providers(
        &self,
        principal: &Principal,
        group_id: &str,
    ) -> Result<Vec<LlmProvider>, AppError> {
        self.authorization
            .require(principal, group_id, Capability::LlmConfigure)
            .await?;
        let rows = sqlx::query("SELECT provider.id, provider.group_id, provider.name, provider.provider_kind, provider.base_url, provider.status, provider.secret_envelope IS NOT NULL AS has_secret, provider.created_at, provider.updated_at FROM llm_providers provider JOIN groups ON groups.id = provider.group_id WHERE provider.group_id = ? AND groups.status != 'archived' ORDER BY provider.name, provider.id")
            .bind(group_id).fetch_all(&self.pool).await.map_err(database_error)?;
        rows.iter().map(provider_from_row).collect()
    }

    pub async fn provider_health(
        &self,
        principal: &Principal,
        provider_id: &str,
    ) -> Result<ProviderHealth, AppError> {
        let row = sqlx::query("SELECT group_id, provider_kind, base_url, secret_envelope FROM llm_providers WHERE id = ?")
            .bind(provider_id).fetch_optional(&self.pool).await.map_err(database_error)?
            .ok_or_else(|| AppError::BadRequest("provider not found".into()))?;
        let group_id: String = row.get("group_id");
        self.authorization
            .require(principal, &group_id, Capability::LlmConfigure)
            .await?;
        let kind = ProviderKind::parse(row.get("provider_kind"))?;
        validate_base_url(kind, row.get("base_url"))?;
        let envelope: Option<String> = row.get("secret_envelope");
        if let Some(value) = envelope.as_ref() {
            let encrypted = EncryptedSecret::parse(value.clone())?;
            let _plaintext = self
                .cipher
                .decrypt(&encrypted, &provider_secret_aad(provider_id))?;
        }
        Ok(ProviderHealth {
            provider_id: provider_id.into(),
            configuration_valid: true,
            has_secret: envelope.is_some(),
            network_check_performed: false,
        })
    }

    pub async fn create_model(
        &self,
        principal: &Principal,
        group_id: &str,
        provider_id: &str,
        model_key: &str,
        upstream_model: &str,
        idempotency_key: &str,
    ) -> Result<LlmModel, AppError> {
        require_human(principal)?;
        validate_identifier("model key", model_key)?;
        validate_label("upstream model", upstream_model, 200)?;
        let payload_hash =
            mutation_payload_hash(&[group_id, provider_id, model_key, upstream_model.trim()]);
        let mut tx = self
            .pool
            .begin_with("BEGIN IMMEDIATE")
            .await
            .map_err(database_error)?;
        self.authorization
            .require_in_transaction(&mut tx, principal, group_id, Capability::LlmConfigure)
            .await?;
        if let Some(id) = mutation_replay(
            &mut tx,
            principal,
            group_id,
            "model.create",
            idempotency_key,
            &payload_hash,
        )
        .await?
        {
            tx.commit().await.map_err(database_error)?;
            return self.model(principal, &id).await;
        }
        let provider_group: Option<String> = sqlx::query_scalar(
            "SELECT group_id FROM llm_providers WHERE id = ? AND status = 'active'",
        )
        .bind(provider_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(database_error)?;
        if provider_group.as_deref() != Some(group_id) {
            return Err(AppError::BadRequest(
                "provider must be active in the same group".into(),
            ));
        }
        let id = Uuid::now_v7().to_string();
        let timestamp = now();
        sqlx::query("INSERT INTO llm_models (id, group_id, provider_id, model_key, upstream_model, status, created_by_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)")
            .bind(&id).bind(group_id).bind(provider_id).bind(model_key).bind(upstream_model.trim()).bind(&principal.user_id).bind(timestamp).bind(timestamp)
            .execute(&mut *tx).await.map_err(map_write_error)?;
        audit(
            &mut tx,
            principal,
            "llm.model.created",
            "llm_model",
            &id,
            group_id,
        )
        .await?;
        record_mutation(
            &mut tx,
            principal,
            group_id,
            "model.create",
            idempotency_key,
            &payload_hash,
            &id,
        )
        .await?;
        tx.commit().await.map_err(database_error)?;
        Ok(LlmModel {
            id,
            group_id: group_id.into(),
            provider_id: provider_id.into(),
            model_key: model_key.into(),
            upstream_model: upstream_model.trim().into(),
            status: "active".into(),
            created_at: timestamp,
            updated_at: timestamp,
        })
    }

    pub async fn update_model(
        &self,
        principal: &Principal,
        model_id: &str,
        model_key: &str,
        upstream_model: &str,
        status: &str,
        idempotency_key: &str,
    ) -> Result<LlmModel, AppError> {
        require_human(principal)?;
        validate_identifier("model key", model_key)?;
        validate_label("upstream model", upstream_model, 200)?;
        validate_status(status)?;
        let payload_hash =
            mutation_payload_hash(&[model_id, model_key, upstream_model.trim(), status]);
        let mut tx = self
            .pool
            .begin_with("BEGIN IMMEDIATE")
            .await
            .map_err(database_error)?;
        let group_id: String = sqlx::query_scalar("SELECT group_id FROM llm_models WHERE id = ?")
            .bind(model_id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(database_error)?
            .ok_or_else(|| AppError::BadRequest("model not found".into()))?;
        self.authorization
            .require_in_transaction(&mut tx, principal, &group_id, Capability::LlmConfigure)
            .await?;
        if mutation_replay(
            &mut tx,
            principal,
            &group_id,
            "model.update",
            idempotency_key,
            &payload_hash,
        )
        .await?
        .is_none()
        {
            sqlx::query("UPDATE llm_models SET model_key = ?, upstream_model = ?, status = ?, updated_at = ? WHERE id = ?")
                .bind(model_key).bind(upstream_model.trim()).bind(status).bind(now()).bind(model_id)
                .execute(&mut *tx).await.map_err(map_write_error)?;
            audit(
                &mut tx,
                principal,
                "llm.model.updated",
                "llm_model",
                model_id,
                &group_id,
            )
            .await?;
            record_mutation(
                &mut tx,
                principal,
                &group_id,
                "model.update",
                idempotency_key,
                &payload_hash,
                model_id,
            )
            .await?;
        }
        tx.commit().await.map_err(database_error)?;
        self.model(principal, model_id).await
    }

    async fn model(&self, principal: &Principal, model_id: &str) -> Result<LlmModel, AppError> {
        let row = sqlx::query("SELECT id, group_id, provider_id, model_key, upstream_model, status, created_at, updated_at FROM llm_models WHERE id = ?")
            .bind(model_id).fetch_optional(&self.pool).await.map_err(database_error)?
            .ok_or_else(|| AppError::BadRequest("model not found".into()))?;
        let group_id: String = row.get("group_id");
        self.authorization
            .require(principal, &group_id, Capability::LlmConfigure)
            .await?;
        Ok(LlmModel {
            id: row.get("id"),
            group_id,
            provider_id: row.get("provider_id"),
            model_key: row.get("model_key"),
            upstream_model: row.get("upstream_model"),
            status: row.get("status"),
            created_at: row.get("created_at"),
            updated_at: row.get("updated_at"),
        })
    }

    pub async fn create_prompt_profile(
        &self,
        principal: &Principal,
        group_id: &str,
        name: &str,
        system_prompt: &str,
        idempotency_key: &str,
    ) -> Result<PromptProfile, AppError> {
        require_human(principal)?;
        validate_label("prompt profile name", name, 120)?;
        validate_prompt(system_prompt)?;
        let payload_hash = mutation_payload_hash(&[group_id, name.trim(), system_prompt]);
        let mut tx = self
            .pool
            .begin_with("BEGIN IMMEDIATE")
            .await
            .map_err(database_error)?;
        self.authorization
            .require_in_transaction(&mut tx, principal, group_id, Capability::LlmConfigure)
            .await?;
        if let Some(id) = mutation_replay(
            &mut tx,
            principal,
            group_id,
            "prompt.create",
            idempotency_key,
            &payload_hash,
        )
        .await?
        {
            tx.commit().await.map_err(database_error)?;
            return self.prompt_profile(principal, &id).await;
        }
        let id = Uuid::now_v7().to_string();
        let timestamp = now();
        sqlx::query("INSERT INTO prompt_profiles (id, group_id, name, system_prompt, status, created_by_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?, ?)")
            .bind(&id).bind(group_id).bind(name.trim()).bind(system_prompt).bind(&principal.user_id).bind(timestamp).bind(timestamp)
            .execute(&mut *tx).await.map_err(map_write_error)?;
        audit(
            &mut tx,
            principal,
            "llm.prompt_profile.created",
            "prompt_profile",
            &id,
            group_id,
        )
        .await?;
        record_mutation(
            &mut tx,
            principal,
            group_id,
            "prompt.create",
            idempotency_key,
            &payload_hash,
            &id,
        )
        .await?;
        tx.commit().await.map_err(database_error)?;
        Ok(PromptProfile {
            id,
            group_id: group_id.into(),
            name: name.trim().into(),
            system_prompt: system_prompt.into(),
            status: "active".into(),
            created_at: timestamp,
            updated_at: timestamp,
        })
    }

    pub async fn update_prompt_profile(
        &self,
        principal: &Principal,
        profile_id: &str,
        name: &str,
        system_prompt: &str,
        status: &str,
        idempotency_key: &str,
    ) -> Result<PromptProfile, AppError> {
        require_human(principal)?;
        validate_label("prompt profile name", name, 120)?;
        validate_prompt(system_prompt)?;
        validate_status(status)?;
        let payload_hash = mutation_payload_hash(&[profile_id, name.trim(), system_prompt, status]);
        let mut tx = self
            .pool
            .begin_with("BEGIN IMMEDIATE")
            .await
            .map_err(database_error)?;
        let group_id: String =
            sqlx::query_scalar("SELECT group_id FROM prompt_profiles WHERE id = ?")
                .bind(profile_id)
                .fetch_optional(&mut *tx)
                .await
                .map_err(database_error)?
                .ok_or_else(|| AppError::BadRequest("prompt profile not found".into()))?;
        self.authorization
            .require_in_transaction(&mut tx, principal, &group_id, Capability::LlmConfigure)
            .await?;
        if mutation_replay(
            &mut tx,
            principal,
            &group_id,
            "prompt.update",
            idempotency_key,
            &payload_hash,
        )
        .await?
        .is_none()
        {
            sqlx::query("UPDATE prompt_profiles SET name = ?, system_prompt = ?, status = ?, updated_at = ? WHERE id = ?")
                .bind(name.trim()).bind(system_prompt).bind(status).bind(now()).bind(profile_id)
                .execute(&mut *tx).await.map_err(map_write_error)?;
            audit(
                &mut tx,
                principal,
                "llm.prompt_profile.updated",
                "prompt_profile",
                profile_id,
                &group_id,
            )
            .await?;
            record_mutation(
                &mut tx,
                principal,
                &group_id,
                "prompt.update",
                idempotency_key,
                &payload_hash,
                profile_id,
            )
            .await?;
        }
        tx.commit().await.map_err(database_error)?;
        self.prompt_profile(principal, profile_id).await
    }

    async fn prompt_profile(
        &self,
        principal: &Principal,
        profile_id: &str,
    ) -> Result<PromptProfile, AppError> {
        let row = sqlx::query("SELECT id, group_id, name, system_prompt, status, created_at, updated_at FROM prompt_profiles WHERE id = ?")
            .bind(profile_id).fetch_optional(&self.pool).await.map_err(database_error)?
            .ok_or_else(|| AppError::BadRequest("prompt profile not found".into()))?;
        let group_id: String = row.get("group_id");
        self.authorization
            .require(principal, &group_id, Capability::LlmConfigure)
            .await?;
        Ok(PromptProfile {
            id: row.get("id"),
            group_id,
            name: row.get("name"),
            system_prompt: row.get("system_prompt"),
            status: row.get("status"),
            created_at: row.get("created_at"),
            updated_at: row.get("updated_at"),
        })
    }

    pub async fn list_models(
        &self,
        principal: &Principal,
        group_id: &str,
    ) -> Result<Vec<LlmModel>, AppError> {
        self.authorization
            .require(principal, group_id, Capability::LlmConfigure)
            .await?;
        let rows = sqlx::query("SELECT model.id, model.group_id, model.provider_id, model.model_key, model.upstream_model, model.status, model.created_at, model.updated_at FROM llm_models model JOIN groups ON groups.id = model.group_id WHERE model.group_id = ? AND groups.status != 'archived' ORDER BY model.model_key, model.id")
            .bind(group_id).fetch_all(&self.pool).await.map_err(database_error)?;
        Ok(rows
            .into_iter()
            .map(|row| LlmModel {
                id: row.get("id"),
                group_id: row.get("group_id"),
                provider_id: row.get("provider_id"),
                model_key: row.get("model_key"),
                upstream_model: row.get("upstream_model"),
                status: row.get("status"),
                created_at: row.get("created_at"),
                updated_at: row.get("updated_at"),
            })
            .collect())
    }

    pub async fn list_prompt_profiles(
        &self,
        principal: &Principal,
        group_id: &str,
    ) -> Result<Vec<PromptProfile>, AppError> {
        self.authorization
            .require(principal, group_id, Capability::LlmConfigure)
            .await?;
        let rows = sqlx::query("SELECT profile.id, profile.group_id, profile.name, profile.system_prompt, profile.status, profile.created_at, profile.updated_at FROM prompt_profiles profile JOIN groups ON groups.id = profile.group_id WHERE profile.group_id = ? AND groups.status != 'archived' ORDER BY profile.name, profile.id")
            .bind(group_id).fetch_all(&self.pool).await.map_err(database_error)?;
        Ok(rows
            .into_iter()
            .map(|row| PromptProfile {
                id: row.get("id"),
                group_id: row.get("group_id"),
                name: row.get("name"),
                system_prompt: row.get("system_prompt"),
                status: row.get("status"),
                created_at: row.get("created_at"),
                updated_at: row.get("updated_at"),
            })
            .collect())
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn create_price_version(
        &self,
        principal: &Principal,
        group_id: &str,
        provider_id: &str,
        model_id: Option<&str>,
        currency: &str,
        unit: &str,
        input_cost_micros: i64,
        output_cost_micros: i64,
        idempotency_key: &str,
    ) -> Result<ProviderPriceVersion, AppError> {
        require_human(principal)?;
        validate_price(
            currency,
            unit,
            input_cost_micros,
            output_cost_micros,
            idempotency_key,
        )?;
        let payload_hash = price_payload_hash(
            group_id,
            provider_id,
            model_id,
            currency,
            unit,
            input_cost_micros,
            output_cost_micros,
        );
        let mut tx = self
            .pool
            .begin_with("BEGIN IMMEDIATE")
            .await
            .map_err(database_error)?;
        self.authorization
            .require_in_transaction(&mut tx, principal, group_id, Capability::LlmConfigure)
            .await?;
        if let Some(existing) = sqlx::query("SELECT id, group_id, provider_id, model_id, currency, unit, input_cost_micros, output_cost_micros, created_at FROM provider_price_versions WHERE group_id = ? AND operation = 'price.create' AND idempotency_key = ?")
            .bind(group_id).bind(idempotency_key).fetch_optional(&mut *tx).await.map_err(database_error)? {
            let result = price_from_row(&existing);
            let existing_hash = price_payload_hash(&result.group_id, &result.provider_id, result.model_id.as_deref(), &result.currency, &result.unit, result.input_cost_micros, result.output_cost_micros);
            if existing_hash != payload_hash { return Err(AppError::Conflict("idempotency key was used for another price payload".into())); }
            tx.commit().await.map_err(database_error)?;
            return Ok(result);
        }
        let provider_group: Option<String> = sqlx::query_scalar(
            "SELECT group_id FROM llm_providers WHERE id = ? AND status = 'active'",
        )
        .bind(provider_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(database_error)?;
        if provider_group.as_deref() != Some(group_id) {
            return Err(AppError::BadRequest(
                "provider must be active in the same group".into(),
            ));
        }
        if let Some(model_id) = model_id {
            let valid: i64 = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM llm_models WHERE id = ? AND group_id = ? AND provider_id = ? AND status = 'active')").bind(model_id).bind(group_id).bind(provider_id).fetch_one(&mut *tx).await.map_err(database_error)?;
            if valid != 1 {
                return Err(AppError::BadRequest(
                    "model must be active for the provider".into(),
                ));
            }
        }
        let result = ProviderPriceVersion {
            id: Uuid::now_v7().to_string(),
            group_id: group_id.into(),
            provider_id: provider_id.into(),
            model_id: model_id.map(str::to_string),
            currency: currency.into(),
            unit: unit.into(),
            input_cost_micros,
            output_cost_micros,
            created_at: now(),
        };
        sqlx::query("INSERT INTO provider_price_versions (id, group_id, provider_id, model_id, currency, unit, input_cost_micros, output_cost_micros, idempotency_key, created_by_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
            .bind(&result.id).bind(group_id).bind(provider_id).bind(model_id).bind(currency).bind(unit).bind(input_cost_micros).bind(output_cost_micros).bind(idempotency_key).bind(&principal.user_id).bind(result.created_at)
            .execute(&mut *tx).await.map_err(map_write_error)?;
        audit(
            &mut tx,
            principal,
            "llm.price_version.created",
            "provider_price_version",
            &result.id,
            group_id,
        )
        .await?;
        tx.commit().await.map_err(database_error)?;
        Ok(result)
    }

    pub async fn list_price_versions(
        &self,
        principal: &Principal,
        group_id: &str,
        cursor: Option<&str>,
        limit: usize,
    ) -> Result<(Vec<ProviderPriceVersion>, Option<String>), AppError> {
        self.authorization
            .require(principal, group_id, Capability::LlmConfigure)
            .await?;
        let limit = limit.clamp(1, 100);
        let cursor = cursor.unwrap_or("~");
        let rows = sqlx::query("SELECT price.id, price.group_id, price.provider_id, price.model_id, price.currency, price.unit, price.input_cost_micros, price.output_cost_micros, price.created_at FROM provider_price_versions price JOIN groups ON groups.id = price.group_id WHERE price.group_id = ? AND groups.status != 'archived' AND price.id < ? ORDER BY price.id DESC LIMIT ?")
            .bind(group_id).bind(cursor).bind((limit + 1) as i64)
            .fetch_all(&self.pool).await.map_err(database_error)?;
        let has_more = rows.len() > limit;
        let items = rows
            .into_iter()
            .take(limit)
            .map(|row| price_from_row(&row))
            .collect::<Vec<_>>();
        let next = if has_more {
            items.last().map(|item| item.id.clone())
        } else {
            None
        };
        Ok((items, next))
    }

    #[allow(dead_code)] // Resolve-at-use contract is consumed by LLM Gateway Task 3.
    pub(crate) async fn resolve_route(
        &self,
        group_id: &str,
        requested_model: Option<&str>,
    ) -> Result<ResolvedLlmRoute, AppError> {
        let route = self
            .resolve_route_metadata(group_id, requested_model)
            .await?;
        self.pin_route(route).await
    }

    pub(crate) async fn resolve_route_metadata(
        &self,
        group_id: &str,
        requested_model: Option<&str>,
    ) -> Result<ResolvedLlmRouteConfig, AppError> {
        let mut tx = self.pool.begin().await.map_err(database_error)?;
        let compiled = compile_in_transaction(&mut tx, group_id).await?;
        let policy_version_id = compiled.document.policy_version_id.clone();
        let policy_compiled_hash = hex::encode(Sha256::digest(
            serde_json::to_vec(&compiled.document)
                .map_err(|_| AppError::Internal("effective policy serialization failed".into()))?,
        ));
        if !compiled.document.llm.enabled {
            return Err(AppError::PolicyDenied(
                "LLM access is disabled by policy".into(),
            ));
        }
        let allowed_providers = compiled.document.llm.allowed_providers;
        let allowed_models = compiled.document.llm.allowed_models;
        let rows = sqlx::query("WITH RECURSIVE ancestors(id, parent_id, depth) AS (SELECT id, parent_id, 0 FROM groups WHERE id = ? AND status != 'archived' UNION ALL SELECT parent.id, parent.parent_id, child.depth + 1 FROM groups parent JOIN ancestors child ON child.parent_id = parent.id WHERE parent.status != 'archived') SELECT model.id AS model_id, model.model_key, model.upstream_model, model.status AS model_status, provider.id AS provider_id, provider.name AS provider_name, provider.provider_kind, provider.base_url, provider.secret_envelope, provider.status AS provider_status, ancestors.depth FROM ancestors JOIN llm_models model ON model.group_id = ancestors.id JOIN llm_providers provider ON provider.id = model.provider_id ORDER BY ancestors.depth, model.model_key, model.id")
            .bind(group_id).fetch_all(&mut *tx).await.map_err(database_error)?;
        let has_active_route = rows.iter().any(|row| {
            row.get::<String, _>("model_status") == "active"
                && row.get::<String, _>("provider_status") == "active"
        });
        let allowed_config_exists = rows.iter().any(|row| {
            allowed_providers.contains(&row.get::<String, _>("provider_id"))
                && allowed_models.contains(&row.get::<String, _>("model_id"))
        });
        let row = rows
            .into_iter()
            .find(|row| {
                let provider_id: String = row.get("provider_id");
                let model_id: String = row.get("model_id");
                row.get::<String, _>("model_status") == "active"
                    && row.get::<String, _>("provider_status") == "active"
                    && allowed_providers.contains(&provider_id)
                    && allowed_models.contains(&model_id)
                    && requested_model
                        .map(|value| value == model_id)
                        .unwrap_or(true)
            })
            .ok_or_else(|| {
                if allowed_providers.is_empty()
                    || allowed_models.is_empty()
                    || (has_active_route && !allowed_config_exists)
                {
                    AppError::PolicyDenied(
                        "no configured route is allowed by effective policy".into(),
                    )
                } else {
                    AppError::ConfigurationUnavailable(
                        "allowed provider or model is unavailable".into(),
                    )
                }
            })?;
        let provider_id: String = row.get("provider_id");
        let model_id: String = row.get("model_id");
        let prompt_profile_id = compiled.document.llm.prompt_profile_id;
        let system_prompt = if let Some(profile_id) = prompt_profile_id.as_deref() {
            let prompt: Option<String> = sqlx::query_scalar("WITH RECURSIVE ancestors(id, parent_id) AS (SELECT id, parent_id FROM groups WHERE id = ? AND status != 'archived' UNION ALL SELECT parent.id, parent.parent_id FROM groups parent JOIN ancestors child ON child.parent_id = parent.id WHERE parent.status != 'archived') SELECT profile.system_prompt FROM prompt_profiles profile JOIN ancestors ON ancestors.id = profile.group_id WHERE profile.id = ? AND profile.status = 'active'")
                .bind(group_id).bind(profile_id).fetch_optional(&mut *tx).await.map_err(database_error)?;
            Some(prompt.ok_or_else(|| {
                AppError::ConfigurationUnavailable(
                    "effective policy references an unavailable prompt profile".into(),
                )
            })?)
        } else {
            None
        };
        let price_row = sqlx::query("SELECT id, group_id, provider_id, model_id, currency, unit, input_cost_micros, output_cost_micros, created_at FROM provider_price_versions WHERE provider_id = ? AND (model_id = ? OR model_id IS NULL) ORDER BY CASE WHEN model_id = ? THEN 0 ELSE 1 END, created_at DESC, id DESC LIMIT 1")
            .bind(&provider_id).bind(&model_id).bind(&model_id).fetch_optional(&mut *tx).await.map_err(database_error)?
            .ok_or_else(|| AppError::Conflict("provider route has no price version".into()))?;
        let secret_envelope: Option<String> = row.get("secret_envelope");
        let secret = secret_envelope
            .as_ref()
            .map(|value| {
                let encrypted = EncryptedSecret::parse(value.clone())?;
                let plaintext = self
                    .cipher
                    .decrypt(&encrypted, &provider_secret_aad(&provider_id))?;
                let text = String::from_utf8(plaintext.to_vec()).map_err(|_| {
                    AppError::Internal("decrypted provider secret is not UTF-8".into())
                })?;
                Ok::<_, AppError>(ResolvedSecret(Zeroizing::new(text)))
            })
            .transpose()?;
        let base_url: String = row.get("base_url");
        let provider_kind = ProviderKind::parse(row.get("provider_kind"))?;
        let upstream_model: String = row.get("upstream_model");
        let price_version = price_from_row(&price_row);
        let config_fingerprint = gateway_config_fingerprint(&[
            &provider_id,
            provider_kind.as_str(),
            &base_url,
            secret_envelope.as_deref().unwrap_or(""),
            &model_id,
            &upstream_model,
            prompt_profile_id.as_deref().unwrap_or(""),
            system_prompt.as_deref().unwrap_or(""),
            &price_version.id,
            &price_version.currency,
            &price_version.unit,
            &price_version.input_cost_micros.to_string(),
            &price_version.output_cost_micros.to_string(),
        ]);
        tx.commit().await.map_err(database_error)?;
        Ok(ResolvedLlmRouteConfig {
            policy_version_id,
            policy_compiled_hash,
            provider_id,
            model_id,
            provider_kind,
            secret,
            model: upstream_model,
            prompt_profile_id,
            system_prompt,
            price_version,
            config_fingerprint,
            requests_per_minute: compiled.document.llm.requests_per_minute,
            max_concurrent_streams: compiled.document.llm.max_concurrent_streams,
            base_url,
        })
    }

    pub(crate) async fn pin_route(
        &self,
        route: ResolvedLlmRouteConfig,
    ) -> Result<ResolvedLlmRoute, AppError> {
        let endpoint =
            PinnedEndpoint::resolve(route.provider_kind, &route.base_url, self.resolver.as_ref())
                .await?;
        Ok(ResolvedLlmRoute {
            policy_version_id: route.policy_version_id,
            policy_compiled_hash: route.policy_compiled_hash,
            provider_id: route.provider_id,
            model_id: route.model_id,
            provider_kind: route.provider_kind,
            secret: route.secret,
            model: route.model,
            prompt_profile_id: route.prompt_profile_id,
            system_prompt: route.system_prompt,
            price_version: route.price_version,
            endpoint,
        })
    }
}

pub(crate) fn gateway_config_fingerprint(parts: &[&str]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    for part in parts {
        hasher.update((part.len() as u64).to_be_bytes());
        hasher.update(part.as_bytes());
    }
    hasher.finalize().into()
}

fn provider_secret_aad(provider_id: &str) -> Vec<u8> {
    format!("mlearn:llm-provider-secret:v1:{provider_id}").into_bytes()
}

fn validate_secret(secret: Option<&str>) -> Result<(), AppError> {
    if let Some(secret) = secret {
        if secret.is_empty() || secret.len() > 16_384 {
            return Err(AppError::BadRequest(
                "provider secret must be 1..16384 bytes".into(),
            ));
        }
    }
    Ok(())
}

fn validate_label(label: &str, value: &str, max: usize) -> Result<(), AppError> {
    if value.trim().is_empty() || value.trim().len() > max || value.chars().any(char::is_control) {
        return Err(AppError::BadRequest(format!("{label} is invalid")));
    }
    Ok(())
}

fn validate_identifier(label: &str, value: &str) -> Result<(), AppError> {
    if value.is_empty()
        || value.len() > 120
        || !value.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':' | b'/')
        })
    {
        return Err(AppError::BadRequest(format!("{label} is invalid")));
    }
    Ok(())
}

fn validate_status(value: &str) -> Result<(), AppError> {
    if matches!(value, "active" | "disabled") {
        Ok(())
    } else {
        Err(AppError::BadRequest(
            "LLM configuration status must be active or disabled".into(),
        ))
    }
}

fn validate_prompt(value: &str) -> Result<(), AppError> {
    if value.is_empty() || value.len() > 65_536 {
        Err(AppError::BadRequest(
            "system prompt must be 1..65536 bytes".into(),
        ))
    } else {
        Ok(())
    }
}

fn validate_price(
    currency: &str,
    unit: &str,
    input: i64,
    output: i64,
    idempotency_key: &str,
) -> Result<(), AppError> {
    if !matches!(currency, "USD" | "EUR" | "CHF" | "GBP") {
        return Err(AppError::BadRequest("unsupported price currency".into()));
    }
    if unit != "perMillionTokens" {
        return Err(AppError::BadRequest(
            "price unit must be perMillionTokens".into(),
        ));
    }
    if !(0..=MAX_SAFE_INTEGER).contains(&input) || !(0..=MAX_SAFE_INTEGER).contains(&output) {
        return Err(AppError::BadRequest(
            "price values must be nonnegative safe integers".into(),
        ));
    }
    if idempotency_key.is_empty() || idempotency_key.len() > 200 {
        return Err(AppError::BadRequest("invalid idempotency key".into()));
    }
    Ok(())
}

fn price_payload_hash(
    group_id: &str,
    provider_id: &str,
    model_id: Option<&str>,
    currency: &str,
    unit: &str,
    input: i64,
    output: i64,
) -> Vec<u8> {
    Sha256::digest(format!(
        "{group_id}\0{provider_id}\0{}\0{currency}\0{unit}\0{input}\0{output}",
        model_id.unwrap_or("")
    ))
    .to_vec()
}

fn mutation_payload_hash(parts: &[&str]) -> Vec<u8> {
    let mut hasher = Sha256::new();
    for part in parts {
        hasher.update((part.len() as u64).to_be_bytes());
        hasher.update(part.as_bytes());
    }
    hasher.finalize().to_vec()
}

async fn mutation_replay(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    principal: &Principal,
    group_id: &str,
    operation: &str,
    idempotency_key: &str,
    payload_hash: &[u8],
) -> Result<Option<String>, AppError> {
    validate_idempotency_key(idempotency_key)?;
    let row = sqlx::query("SELECT actor_user_id, payload_hash, target_id FROM llm_configuration_mutations WHERE group_id = ? AND operation = ? AND idempotency_key = ?")
        .bind(group_id).bind(operation).bind(idempotency_key)
        .fetch_optional(&mut **tx).await.map_err(database_error)?;
    let Some(row) = row else { return Ok(None) };
    let actor: String = row.get("actor_user_id");
    let existing_hash: Vec<u8> = row.get("payload_hash");
    if actor != principal.user_id || existing_hash != payload_hash {
        return Err(AppError::Conflict(
            "idempotency key was used for another LLM configuration mutation".into(),
        ));
    }
    Ok(Some(row.get("target_id")))
}

async fn record_mutation(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    principal: &Principal,
    group_id: &str,
    operation: &str,
    idempotency_key: &str,
    payload_hash: &[u8],
    target_id: &str,
) -> Result<(), AppError> {
    sqlx::query("INSERT INTO llm_configuration_mutations (group_id, operation, idempotency_key, payload_hash, actor_user_id, target_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(group_id).bind(operation).bind(idempotency_key).bind(payload_hash)
        .bind(&principal.user_id).bind(target_id).bind(now())
        .execute(&mut **tx).await.map_err(map_write_error)?;
    Ok(())
}

fn validate_idempotency_key(value: &str) -> Result<(), AppError> {
    if value.is_empty() || value.len() > 200 || value.chars().any(char::is_control) {
        return Err(AppError::BadRequest("invalid idempotency key".into()));
    }
    Ok(())
}

fn provider_from_row(row: &sqlx::sqlite::SqliteRow) -> Result<LlmProvider, AppError> {
    Ok(LlmProvider {
        id: row.get("id"),
        group_id: row.get("group_id"),
        name: row.get("name"),
        provider_kind: ProviderKind::parse(row.get("provider_kind"))?,
        base_url: row.get("base_url"),
        status: row.get("status"),
        has_secret: row.get::<i64, _>("has_secret") == 1,
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    })
}

fn price_from_row(row: &sqlx::sqlite::SqliteRow) -> ProviderPriceVersion {
    ProviderPriceVersion {
        id: row.get("id"),
        group_id: row.get("group_id"),
        provider_id: row.get("provider_id"),
        model_id: row.get("model_id"),
        currency: row.get("currency"),
        unit: row.get("unit"),
        input_cost_micros: row.get("input_cost_micros"),
        output_cost_micros: row.get("output_cost_micros"),
        created_at: row.get("created_at"),
    }
}

fn require_human(principal: &Principal) -> Result<(), AppError> {
    if principal.service_key_id.is_some() {
        Err(AppError::Forbidden(
            "LLM configuration requires a human actor".into(),
        ))
    } else {
        Ok(())
    }
}

async fn audit(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    principal: &Principal,
    action: &str,
    target_type: &str,
    target_id: &str,
    group_id: &str,
) -> Result<(), AppError> {
    sqlx::query("INSERT INTO audit_events (id, actor_user_id, action, target_type, target_id, metadata_json, created_at, authorized_group_id, request_id) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, NULL)")
        .bind(Uuid::now_v7().to_string()).bind(&principal.user_id).bind(action).bind(target_type).bind(target_id).bind(now()).bind(group_id)
        .execute(&mut **tx).await.map_err(database_error)?;
    Ok(())
}

fn now() -> i64 {
    OffsetDateTime::now_utc().unix_timestamp()
}
fn database_error(error: sqlx::Error) -> AppError {
    AppError::Internal(format!("database error: {error}"))
}
fn map_write_error(error: sqlx::Error) -> AppError {
    if matches!(&error, sqlx::Error::Database(db) if db.is_unique_violation() || db.is_foreign_key_violation() || db.is_check_violation())
    {
        AppError::Conflict("LLM configuration conflicts with existing data".into())
    } else {
        database_error(error)
    }
}

#[cfg(test)]
#[path = "configuration_tests.rs"]
mod tests;
