use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::{rngs::OsRng, RngCore};
use serde::Serialize;
use sha2::{Digest, Sha256};
use sqlx::{Row, SqlitePool};
use std::collections::HashSet;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::{
    authorization::{AuthorizationService, Capability},
    error::AppError,
    identity::{IdentityType, Principal},
};

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CreatedApiKey {
    pub id: String,
    pub group_id: String,
    pub name: Option<String>,
    pub capabilities: Vec<Capability>,
    pub expires_at: Option<i64>,
    pub secret: String,
}

#[derive(Clone)]
pub struct ApiKeyService {
    pool: SqlitePool,
    authorization: AuthorizationService,
}

impl ApiKeyService {
    pub fn new(pool: SqlitePool) -> Self {
        Self {
            authorization: AuthorizationService::new(pool.clone()),
            pool,
        }
    }

    pub async fn create(
        &self,
        principal: &Principal,
        group_id: &str,
        capabilities: Vec<Capability>,
        expires_at: Option<i64>,
    ) -> Result<CreatedApiKey, AppError> {
        let mut seen = HashSet::new();
        let capabilities: Vec<_> = capabilities
            .into_iter()
            .filter(|capability| seen.insert(*capability))
            .collect();
        if capabilities
            .iter()
            .any(|capability| !capability.is_service_key_allowed())
        {
            return Err(AppError::BadRequest(
                "API keys cannot grant human-only mutation capabilities".into(),
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
                Capability::ApiKeysManage,
            )
            .await?;
        for capability in &capabilities {
            self.authorization
                .require_in_transaction(&mut transaction, principal, group_id, *capability)
                .await?;
        }
        if expires_at.is_some_and(|expiry| expiry <= now()) {
            return Err(AppError::BadRequest(
                "API key expiry must be in the future".into(),
            ));
        }

        let mut bytes = [0u8; 32];
        OsRng.fill_bytes(&mut bytes);
        let secret = format!("mlsk_{}", URL_SAFE_NO_PAD.encode(bytes));
        let key = CreatedApiKey {
            id: Uuid::now_v7().to_string(),
            group_id: group_id.to_string(),
            name: None,
            capabilities,
            expires_at,
            secret,
        };
        sqlx::query("INSERT INTO api_keys (id, group_id, created_by_user_id, name, secret_hash, status, expires_at, created_at, revoked_at) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, NULL)")
            .bind(&key.id)
            .bind(group_id)
            .bind(&principal.user_id)
            .bind(&key.name)
            .bind(hash_secret(&key.secret))
            .bind(expires_at)
            .bind(now())
            .execute(&mut *transaction)
            .await
            .map_err(database_error)?;
        for capability in &key.capabilities {
            sqlx::query("INSERT INTO api_key_capabilities (api_key_id, capability) VALUES (?, ?)")
                .bind(&key.id)
                .bind(capability.as_str())
                .execute(&mut *transaction)
                .await
                .map_err(database_error)?;
        }
        sqlx::query("INSERT INTO audit_events (id, actor_user_id, action, target_type, target_id, metadata_json, created_at, authorized_group_id, request_id) VALUES (?, ?, 'api_key.created', 'api_key', ?, ?, ?, ?, NULL)")
            .bind(Uuid::now_v7().to_string())
            .bind(&principal.user_id)
            .bind(&key.id)
            .bind(serde_json::json!({"capabilities": key.capabilities, "expiresAt": expires_at}).to_string())
            .bind(now())
            .bind(group_id)
            .execute(&mut *transaction)
            .await
            .map_err(database_error)?;
        transaction.commit().await.map_err(database_error)?;
        Ok(key)
    }

    pub async fn authenticate(&self, secret: &str) -> Result<Principal, AppError> {
        if !secret.starts_with("mlsk_") {
            return Err(AppError::Unauthorized);
        }
        let rows = sqlx::query("SELECT key.id, key.group_id, capability.capability FROM api_keys key LEFT JOIN api_key_capabilities capability ON capability.api_key_id = key.id WHERE key.secret_hash = ? AND key.status = 'active' AND (key.expires_at IS NULL OR key.expires_at > ?)")
            .bind(hash_secret(secret))
            .bind(now())
            .fetch_all(&self.pool)
            .await
            .map_err(database_error)?;
        let row = rows.first().ok_or(AppError::Unauthorized)?;
        for row in &rows {
            if let Some(capability) = row.get::<Option<String>, _>("capability") {
                let capability = Capability::from_str(&capability).ok_or(AppError::Unauthorized)?;
                if !capability.is_service_key_allowed() {
                    return Err(AppError::Unauthorized);
                }
            }
        }
        let key_id: String = row.get("id");
        Ok(Principal {
            user_id: String::new(),
            service_key_id: Some(key_id),
            session_id: "api-key".into(),
            device_id: "api-key".into(),
            active_group_id: Some(row.get("group_id")),
            identity_type: IdentityType::Admin,
            is_root: false,
        })
    }

    pub async fn revoke(
        &self,
        principal: &Principal,
        group_id: &str,
        key_id: &str,
    ) -> Result<(), AppError> {
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
                Capability::ApiKeysManage,
            )
            .await?;
        let changed = sqlx::query("UPDATE api_keys SET status = 'revoked', revoked_at = ? WHERE id = ? AND group_id = ? AND status = 'active'")
            .bind(now()).bind(key_id).bind(group_id)
            .execute(&mut *transaction).await.map_err(database_error)?.rows_affected();
        if changed != 1 {
            return Err(AppError::Conflict("active API key not found".into()));
        }
        sqlx::query("INSERT INTO audit_events (id, actor_user_id, action, target_type, target_id, metadata_json, created_at, authorized_group_id, request_id) VALUES (?, ?, 'api_key.revoked', 'api_key', ?, NULL, ?, ?, NULL)")
            .bind(Uuid::now_v7().to_string()).bind(&principal.user_id).bind(key_id).bind(now()).bind(group_id)
            .execute(&mut *transaction).await.map_err(database_error)?;
        transaction.commit().await.map_err(database_error)?;
        Ok(())
    }
}

fn hash_secret(secret: &str) -> String {
    hex::encode(Sha256::digest(secret.as_bytes()))
}

fn now() -> i64 {
    OffsetDateTime::now_utc().unix_timestamp()
}

fn database_error(error: sqlx::Error) -> AppError {
    AppError::Internal(format!("database error: {error}"))
}

#[cfg(test)]
mod tests {
    use crate::{
        authorization::{AuthorizationService, Capability},
        error::AppError,
        groups::tests::GroupFixture,
    };

    #[tokio::test]
    async fn api_key_plaintext_is_returned_once_and_hash_is_persisted() {
        let fixture = GroupFixture::german_tree().await;
        let service = super::ApiKeyService::new(fixture.pool.clone());
        let created = service
            .create(
                &fixture.german_a_teacher,
                &fixture.german_a,
                vec![Capability::GroupView],
                None,
            )
            .await
            .unwrap();

        assert!(created.secret.starts_with("mlsk_"));
        let raw_database = sqlx::query_scalar::<_, String>(
            "SELECT group_concat(COALESCE(secret_hash, ''), '') FROM api_keys",
        )
        .fetch_one(&fixture.pool)
        .await
        .unwrap();
        assert!(!raw_database.contains(&created.secret));
    }

    #[tokio::test]
    async fn authenticated_key_is_limited_to_its_group_and_exact_capabilities() {
        let fixture = GroupFixture::german_tree().await;
        let service = super::ApiKeyService::new(fixture.pool.clone());
        let created = service
            .create(
                &fixture.german_a_teacher,
                &fixture.german_a,
                vec![Capability::GroupView],
                None,
            )
            .await
            .unwrap();

        let principal = service.authenticate(&created.secret).await.unwrap();
        assert_eq!(principal.service_key_id.as_deref(), Some(created.id.as_str()));
        let authz = AuthorizationService::new(fixture.pool.clone());
        assert!(authz
            .require(&principal, &fixture.project_1, Capability::GroupView)
            .await
            .is_ok());
        assert!(matches!(
            authz
                .require(&principal, &fixture.project_1, Capability::GroupManage)
                .await,
            Err(AppError::Forbidden(_))
        ));
        assert!(matches!(
            authz
                .require(&principal, &fixture.german_b, Capability::GroupView)
                .await,
            Err(AppError::Forbidden(_))
        ));
    }

    #[tokio::test]
    async fn revoked_key_cannot_authenticate() {
        let fixture = GroupFixture::german_tree().await;
        let service = super::ApiKeyService::new(fixture.pool.clone());
        let created = service
            .create(
                &fixture.german_a_teacher,
                &fixture.german_a,
                vec![Capability::GroupView],
                None,
            )
            .await
            .unwrap();

        service
            .revoke(&fixture.german_a_teacher, &fixture.german_a, &created.id)
            .await
            .unwrap();

        assert!(matches!(
            service.authenticate(&created.secret).await,
            Err(AppError::Unauthorized)
        ));
    }

    #[tokio::test]
    async fn duplicate_capabilities_are_persisted_once() {
        let fixture = GroupFixture::german_tree().await;
        let service = super::ApiKeyService::new(fixture.pool.clone());

        let created = service
            .create(
                &fixture.german_a_teacher,
                &fixture.german_a,
                vec![Capability::GroupView, Capability::GroupView],
                None,
            )
            .await
            .unwrap();

        assert_eq!(created.capabilities, vec![Capability::GroupView]);
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM api_key_capabilities WHERE api_key_id = ?",
            )
            .bind(created.id)
            .fetch_one(&fixture.pool)
            .await
            .unwrap(),
            1
        );
    }

    #[tokio::test]
    async fn api_key_creation_rejects_human_only_mutation_capabilities() {
        let fixture = GroupFixture::german_tree().await;
        let service = super::ApiKeyService::new(fixture.pool);

        let result = service
            .create(
                &fixture.german_a_teacher,
                &fixture.german_a,
                vec![Capability::GroupManage],
                None,
            )
            .await;

        assert!(matches!(result, Err(AppError::BadRequest(_))));
    }

    #[tokio::test]
    async fn api_key_authentication_rejects_persisted_mutation_capability() {
        let fixture = GroupFixture::german_tree().await;
        let service = super::ApiKeyService::new(fixture.pool.clone());
        let created = service
            .create(
                &fixture.german_a_teacher,
                &fixture.german_a,
                vec![Capability::GroupView],
                None,
            )
            .await
            .unwrap();
        sqlx::query("INSERT INTO api_key_capabilities (api_key_id, capability) VALUES (?, 'group.manage')")
            .bind(&created.id)
            .execute(&fixture.pool)
            .await
            .unwrap();

        assert!(matches!(
            service.authenticate(&created.secret).await,
            Err(AppError::Unauthorized)
        ));
    }
}
