use std::net::{Ipv4Addr, Ipv6Addr};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{Row, SqlitePool};
use time::OffsetDateTime;
use url::{Host, Url};
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::{
    authorization::{AuthorizationService, Capability},
    crypto::{EncryptedSecret, SecretCipher},
    error::AppError,
    identity::Principal,
    policy::compiler::compile_in_transaction,
};

const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ProviderKind {
    #[serde(rename = "openaiCompatible")]
    OpenAiCompatible,
    Ollama,
}

impl ProviderKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::OpenAiCompatible => "openaiCompatible",
            Self::Ollama => "ollama",
        }
    }

    fn parse(value: &str) -> Result<Self, AppError> {
        match value {
            "openaiCompatible" => Ok(Self::OpenAiCompatible),
            "ollama" => Ok(Self::Ollama),
            _ => Err(AppError::Internal(
                "persisted provider kind is invalid".into(),
            )),
        }
    }
}

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

pub struct ResolvedLlmRoute {
    pub provider_id: String,
    pub provider_kind: ProviderKind,
    pub base_url: String,
    #[allow(dead_code)] // Consumed by the streaming provider adapter in LLM Gateway Task 3.
    pub(crate) secret: Option<ResolvedSecret>,
    pub model: String,
    pub prompt_profile_id: Option<String>,
    pub price_version: ProviderPriceVersion,
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
}

impl LlmConfigurationService {
    pub fn new(pool: SqlitePool, cipher: SecretCipher) -> Self {
        Self {
            authorization: AuthorizationService::new(pool.clone()),
            pool,
            cipher,
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
    ) -> Result<LlmProvider, AppError> {
        require_human(principal)?;
        validate_label("provider name", name, 120)?;
        let base_url = validate_base_url(kind, base_url)?;
        validate_secret(secret)?;
        let mut tx = self.pool.begin().await.map_err(database_error)?;
        self.authorization
            .require_in_transaction(&mut tx, principal, group_id, Capability::LlmConfigure)
            .await?;
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
        tx.commit().await.map_err(database_error)?;
        self.provider(principal, &id).await
    }

    pub async fn update_provider_secret(
        &self,
        principal: &Principal,
        provider_id: &str,
        secret: Option<&str>,
    ) -> Result<LlmProvider, AppError> {
        require_human(principal)?;
        validate_secret(secret)?;
        let mut tx = self.pool.begin().await.map_err(database_error)?;
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
        let envelope = secret
            .map(|value| {
                self.cipher
                    .encrypt(value.as_bytes(), &provider_secret_aad(provider_id))
            })
            .transpose()?;
        sqlx::query("UPDATE llm_providers SET secret_envelope = ?, updated_at = ? WHERE id = ?")
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
        let rows = sqlx::query("WITH RECURSIVE ancestors(id, parent_id, depth) AS (SELECT id, parent_id, 0 FROM groups WHERE id = ? AND status != 'archived' UNION ALL SELECT parent.id, parent.parent_id, child.depth + 1 FROM groups parent JOIN ancestors child ON child.parent_id = parent.id WHERE parent.status != 'archived') SELECT provider.id, provider.group_id, provider.name, provider.provider_kind, provider.base_url, provider.status, provider.secret_envelope IS NOT NULL AS has_secret, provider.created_at, provider.updated_at FROM ancestors JOIN llm_providers provider ON provider.group_id = ancestors.id ORDER BY ancestors.depth, provider.name, provider.id")
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
    ) -> Result<LlmModel, AppError> {
        require_human(principal)?;
        validate_identifier("model key", model_key)?;
        validate_label("upstream model", upstream_model, 200)?;
        let mut tx = self.pool.begin().await.map_err(database_error)?;
        self.authorization
            .require_in_transaction(&mut tx, principal, group_id, Capability::LlmConfigure)
            .await?;
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

    pub async fn create_prompt_profile(
        &self,
        principal: &Principal,
        group_id: &str,
        name: &str,
        system_prompt: &str,
    ) -> Result<PromptProfile, AppError> {
        require_human(principal)?;
        validate_label("prompt profile name", name, 120)?;
        if system_prompt.is_empty() || system_prompt.len() > 65_536 {
            return Err(AppError::BadRequest(
                "system prompt must be 1..65536 bytes".into(),
            ));
        }
        let mut tx = self.pool.begin().await.map_err(database_error)?;
        self.authorization
            .require_in_transaction(&mut tx, principal, group_id, Capability::LlmConfigure)
            .await?;
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

    pub async fn list_models(
        &self,
        principal: &Principal,
        group_id: &str,
    ) -> Result<Vec<LlmModel>, AppError> {
        self.authorization
            .require(principal, group_id, Capability::LlmConfigure)
            .await?;
        let rows = sqlx::query("WITH RECURSIVE ancestors(id, parent_id, depth) AS (SELECT id, parent_id, 0 FROM groups WHERE id = ? AND status != 'archived' UNION ALL SELECT parent.id, parent.parent_id, child.depth + 1 FROM groups parent JOIN ancestors child ON child.parent_id = parent.id WHERE parent.status != 'archived') SELECT model.id, model.group_id, model.provider_id, model.model_key, model.upstream_model, model.status, model.created_at, model.updated_at FROM ancestors JOIN llm_models model ON model.group_id = ancestors.id ORDER BY ancestors.depth, model.model_key, model.id")
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
        let rows = sqlx::query("WITH RECURSIVE ancestors(id, parent_id, depth) AS (SELECT id, parent_id, 0 FROM groups WHERE id = ? AND status != 'archived' UNION ALL SELECT parent.id, parent.parent_id, child.depth + 1 FROM groups parent JOIN ancestors child ON child.parent_id = parent.id WHERE parent.status != 'archived') SELECT profile.id, profile.group_id, profile.name, profile.system_prompt, profile.status, profile.created_at, profile.updated_at FROM ancestors JOIN prompt_profiles profile ON profile.group_id = ancestors.id ORDER BY ancestors.depth, profile.name, profile.id")
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
        if let Some(existing) = sqlx::query("SELECT id, group_id, provider_id, model_id, currency, unit, input_cost_micros, output_cost_micros, created_at FROM provider_price_versions WHERE idempotency_key = ?")
            .bind(idempotency_key).fetch_optional(&mut *tx).await.map_err(database_error)? {
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
        let rows = sqlx::query("WITH RECURSIVE ancestors(id, parent_id) AS (SELECT id, parent_id FROM groups WHERE id = ? AND status != 'archived' UNION ALL SELECT parent.id, parent.parent_id FROM groups parent JOIN ancestors child ON child.parent_id = parent.id WHERE parent.status != 'archived') SELECT price.id, price.group_id, price.provider_id, price.model_id, price.currency, price.unit, price.input_cost_micros, price.output_cost_micros, price.created_at FROM provider_price_versions price JOIN ancestors ON ancestors.id = price.group_id WHERE price.id < ? ORDER BY price.id DESC LIMIT ?")
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

    pub async fn resolve_route(
        &self,
        group_id: &str,
        requested_model: Option<&str>,
    ) -> Result<ResolvedLlmRoute, AppError> {
        let mut tx = self.pool.begin().await.map_err(database_error)?;
        let compiled = compile_in_transaction(&mut tx, group_id).await?;
        if !compiled.document.llm.enabled {
            return Err(AppError::Forbidden(
                "LLM access is disabled by policy".into(),
            ));
        }
        let allowed_providers = compiled.document.llm.allowed_providers;
        let allowed_models = compiled.document.llm.allowed_models;
        let rows = sqlx::query("WITH RECURSIVE ancestors(id, parent_id, depth) AS (SELECT id, parent_id, 0 FROM groups WHERE id = ? AND status != 'archived' UNION ALL SELECT parent.id, parent.parent_id, child.depth + 1 FROM groups parent JOIN ancestors child ON child.parent_id = parent.id WHERE parent.status != 'archived') SELECT model.id AS model_id, model.model_key, model.upstream_model, provider.id AS provider_id, provider.name AS provider_name, provider.provider_kind, provider.base_url, provider.secret_envelope, ancestors.depth FROM ancestors JOIN llm_models model ON model.group_id = ancestors.id AND model.status = 'active' JOIN llm_providers provider ON provider.id = model.provider_id AND provider.status = 'active' ORDER BY ancestors.depth, model.model_key, model.id")
            .bind(group_id).fetch_all(&mut *tx).await.map_err(database_error)?;
        let row = rows
            .into_iter()
            .find(|row| {
                let provider_id: String = row.get("provider_id");
                let provider_name: String = row.get("provider_name");
                let provider_kind: String = row.get("provider_kind");
                let model_key: String = row.get("model_key");
                let upstream_model: String = row.get("upstream_model");
                (allowed_providers.is_empty()
                    || allowed_providers.contains(&provider_id)
                    || allowed_providers.contains(&provider_name)
                    || allowed_providers.contains(&provider_kind))
                    && (allowed_models.is_empty()
                        || allowed_models.contains(&model_key)
                        || allowed_models.contains(&upstream_model))
                    && requested_model
                        .map(|value| value == model_key)
                        .unwrap_or(true)
            })
            .ok_or_else(|| {
                AppError::Conflict("no active provider route matches effective policy".into())
            })?;
        let provider_id: String = row.get("provider_id");
        let model_id: String = row.get("model_id");
        let prompt_profile_id = compiled.document.llm.prompt_profile_id;
        if let Some(profile_id) = prompt_profile_id.as_deref() {
            let valid: i64 = sqlx::query_scalar("WITH RECURSIVE ancestors(id, parent_id) AS (SELECT id, parent_id FROM groups WHERE id = ? AND status != 'archived' UNION ALL SELECT parent.id, parent.parent_id FROM groups parent JOIN ancestors child ON child.parent_id = parent.id WHERE parent.status != 'archived') SELECT EXISTS(SELECT 1 FROM prompt_profiles profile JOIN ancestors ON ancestors.id = profile.group_id WHERE profile.id = ? AND profile.status = 'active')")
                .bind(group_id).bind(profile_id).fetch_one(&mut *tx).await.map_err(database_error)?;
            if valid != 1 {
                return Err(AppError::Conflict(
                    "effective policy references an unavailable prompt profile".into(),
                ));
            }
        }
        let price_row = sqlx::query("SELECT id, group_id, provider_id, model_id, currency, unit, input_cost_micros, output_cost_micros, created_at FROM provider_price_versions WHERE provider_id = ? AND (model_id = ? OR model_id IS NULL) ORDER BY CASE WHEN model_id = ? THEN 0 ELSE 1 END, created_at DESC, id DESC LIMIT 1")
            .bind(&provider_id).bind(&model_id).bind(&model_id).fetch_optional(&mut *tx).await.map_err(database_error)?
            .ok_or_else(|| AppError::Conflict("provider route has no price version".into()))?;
        let secret_envelope: Option<String> = row.get("secret_envelope");
        let secret = secret_envelope
            .map(|value| {
                let encrypted = EncryptedSecret::parse(value)?;
                let plaintext = self
                    .cipher
                    .decrypt(&encrypted, &provider_secret_aad(&provider_id))?;
                let text = String::from_utf8(plaintext.to_vec()).map_err(|_| {
                    AppError::Internal("decrypted provider secret is not UTF-8".into())
                })?;
                Ok::<_, AppError>(ResolvedSecret(Zeroizing::new(text)))
            })
            .transpose()?;
        tx.commit().await.map_err(database_error)?;
        Ok(ResolvedLlmRoute {
            provider_id,
            provider_kind: ProviderKind::parse(row.get("provider_kind"))?,
            base_url: row.get("base_url"),
            secret,
            model: row.get("upstream_model"),
            prompt_profile_id,
            price_version: price_from_row(&price_row),
        })
    }
}

pub fn validate_base_url(kind: ProviderKind, value: &str) -> Result<String, AppError> {
    let url = Url::parse(value)
        .map_err(|_| AppError::BadRequest("provider base URL is invalid".into()))?;
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(AppError::BadRequest(
            "provider base URL cannot contain credentials, query, or fragment".into(),
        ));
    }
    let host = url
        .host()
        .ok_or_else(|| AppError::BadRequest("provider base URL requires a host".into()))?;
    let host_name = host.to_string().to_ascii_lowercase();
    if is_forbidden_host(&host, &host_name) {
        return Err(AppError::BadRequest(
            "provider base URL targets a forbidden network".into(),
        ));
    }
    let safe_ollama_service = kind == ProviderKind::Ollama
        && matches!(host_name.as_str(), "ollama" | "mlearn-backend")
        && url.scheme() == "http";
    if url.scheme() != "https" && !safe_ollama_service {
        return Err(AppError::BadRequest(
            "provider base URL must use HTTPS".into(),
        ));
    }
    if !matches!(url.scheme(), "https" | "http") {
        return Err(AppError::BadRequest(
            "provider base URL scheme is unsupported".into(),
        ));
    }
    Ok(url.as_str().trim_end_matches('/').to_string())
}

fn is_forbidden_host(host: &Host<&str>, name: &str) -> bool {
    if name == "localhost"
        || name.ends_with(".localhost")
        || name.ends_with(".local")
        || name.ends_with(".internal")
        || name == "metadata.google.internal"
    {
        return true;
    }
    match host {
        Host::Ipv4(ip) => forbidden_v4(*ip),
        Host::Ipv6(ip) => forbidden_v6(*ip),
        Host::Domain(_) => false,
    }
}

fn forbidden_v4(ip: Ipv4Addr) -> bool {
    ip.is_private()
        || ip.is_loopback()
        || ip.is_link_local()
        || ip.is_unspecified()
        || ip.is_broadcast()
        || ip.is_multicast()
        || ip.octets()[0] == 0
        || ip.octets()[0] >= 224
}

fn forbidden_v6(ip: Ipv6Addr) -> bool {
    ip.is_loopback()
        || ip.is_unspecified()
        || ip.is_multicast()
        || (ip.segments()[0] & 0xfe00) == 0xfc00
        || (ip.segments()[0] & 0xffc0) == 0xfe80
        || matches!(ip.to_ipv4_mapped(), Some(v4) if forbidden_v4(v4))
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
mod tests {
    use crate::{authorization::Capability, crypto::SecretCipher, groups::tests::GroupFixture};

    use super::{validate_base_url, validate_price, LlmConfigurationService, ProviderKind};

    #[test]
    fn provider_urls_fail_closed_against_ssrf_targets() {
        for url in [
            "http://example.com/v1",
            "https://localhost/v1",
            "https://127.0.0.1/v1",
            "https://169.254.169.254/latest/meta-data",
            "https://user:password@example.com/v1",
        ] {
            assert!(
                validate_base_url(ProviderKind::OpenAiCompatible, url).is_err(),
                "{url}"
            );
        }
        assert!(
            validate_base_url(ProviderKind::OpenAiCompatible, "https://api.openai.com/v1").is_ok()
        );
        assert!(validate_base_url(ProviderKind::Ollama, "http://ollama:11434").is_ok());
    }

    #[test]
    fn prices_require_exact_currency_unit_and_safe_nonnegative_integers() {
        assert!(validate_price(
            "USD",
            "perMillionTokens",
            0,
            9_007_199_254_740_991,
            "request"
        )
        .is_ok());
        for invalid in [
            validate_price("usd", "perMillionTokens", 1, 1, "request"),
            validate_price("USD", "tokens", 1, 1, "request"),
            validate_price("USD", "perMillionTokens", -1, 1, "request"),
            validate_price("USD", "perMillionTokens", 1, 1, ""),
        ] {
            assert!(invalid.is_err());
        }
    }

    #[test]
    fn associated_data_contains_entity_identity_and_purpose() {
        assert_ne!(
            super::provider_secret_aad("one"),
            super::provider_secret_aad("two")
        );
        assert!(String::from_utf8(super::provider_secret_aad("one"))
            .unwrap()
            .starts_with("mlearn:llm-provider-secret:v1:"));
    }

    async fn fixture_service() -> (GroupFixture, LlmConfigurationService) {
        let fixture = GroupFixture::german_tree().await;
        sqlx::query("INSERT INTO membership_capabilities (membership_id, capability) VALUES ('membership-a', ?), ('membership-other', ?)")
            .bind(Capability::LlmConfigure.as_str())
            .bind(Capability::LlmConfigure.as_str())
            .execute(&fixture.pool)
            .await
            .unwrap();
        let service =
            LlmConfigurationService::new(fixture.pool.clone(), SecretCipher::from_key([33_u8; 32]));
        (fixture, service)
    }

    #[tokio::test]
    async fn provider_secret_is_encrypted_and_sibling_actor_is_denied() {
        let (fixture, service) = fixture_service().await;
        let provider = service
            .create_provider(
                &fixture.german_a_teacher,
                &fixture.german_a,
                "School OpenAI",
                ProviderKind::OpenAiCompatible,
                "https://api.openai.com/v1",
                Some("plaintext-provider-secret"),
            )
            .await
            .unwrap();
        let stored: String =
            sqlx::query_scalar("SELECT secret_envelope FROM llm_providers WHERE id = ?")
                .bind(&provider.id)
                .fetch_one(&fixture.pool)
                .await
                .unwrap();
        assert!(stored.starts_with("v1."));
        assert!(!stored.contains("plaintext-provider-secret"));
        assert!(service
            .list_providers(&fixture.other_teacher, &fixture.german_a)
            .await
            .is_err());
        let health = service
            .provider_health(&fixture.german_a_teacher, &provider.id)
            .await
            .unwrap();
        assert!(health.configuration_valid);
        assert!(!health.network_check_performed);
    }

    #[tokio::test]
    async fn swapping_provider_ciphertext_fails_entity_authentication() {
        let (fixture, service) = fixture_service().await;
        let mut ids = Vec::new();
        for (name, secret) in [("First", "first-secret"), ("Second", "second-secret")] {
            ids.push(
                service
                    .create_provider(
                        &fixture.german_a_teacher,
                        &fixture.german_a,
                        name,
                        ProviderKind::OpenAiCompatible,
                        "https://api.openai.com/v1",
                        Some(secret),
                    )
                    .await
                    .unwrap()
                    .id,
            );
        }
        let second: String =
            sqlx::query_scalar("SELECT secret_envelope FROM llm_providers WHERE id = ?")
                .bind(&ids[1])
                .fetch_one(&fixture.pool)
                .await
                .unwrap();
        sqlx::query("UPDATE llm_providers SET secret_envelope = ? WHERE id = ?")
            .bind(second)
            .bind(&ids[0])
            .execute(&fixture.pool)
            .await
            .unwrap();
        assert!(service
            .provider_health(&fixture.german_a_teacher, &ids[0])
            .await
            .is_err());
    }

    #[tokio::test]
    async fn price_versions_are_append_only_and_creation_is_payload_idempotent() {
        let (fixture, service) = fixture_service().await;
        let provider = service
            .create_provider(
                &fixture.german_a_teacher,
                &fixture.german_a,
                "Pricing provider",
                ProviderKind::OpenAiCompatible,
                "https://api.openai.com/v1",
                None,
            )
            .await
            .unwrap();
        let first = service
            .create_price_version(
                &fixture.german_a_teacher,
                &fixture.german_a,
                &provider.id,
                None,
                "USD",
                "perMillionTokens",
                100,
                200,
                "price-request-1",
            )
            .await
            .unwrap();
        let replay = service
            .create_price_version(
                &fixture.german_a_teacher,
                &fixture.german_a,
                &provider.id,
                None,
                "USD",
                "perMillionTokens",
                100,
                200,
                "price-request-1",
            )
            .await
            .unwrap();
        assert_eq!(first, replay);
        assert!(service
            .create_price_version(
                &fixture.german_a_teacher,
                &fixture.german_a,
                &provider.id,
                None,
                "USD",
                "perMillionTokens",
                999,
                200,
                "price-request-1",
            )
            .await
            .is_err());
        assert!(sqlx::query(
            "UPDATE provider_price_versions SET input_cost_micros = 0 WHERE id = ?"
        )
        .bind(&first.id)
        .execute(&fixture.pool)
        .await
        .is_err());
    }
}
