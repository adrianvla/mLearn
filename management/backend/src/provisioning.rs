use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
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
pub struct CsvRowError {
    pub row: usize,
    pub message: String,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CsvPreview {
    pub valid_rows: usize,
    pub errors: Vec<CsvRowError>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CsvImportResult {
    pub import_id: String,
    pub created_users: usize,
    pub updated_users: usize,
    pub memberships_created: usize,
    pub replayed: bool,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CreatedInvitation {
    pub id: String,
    pub group_id: String,
    pub expires_at: i64,
    pub secret: String,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProvisionedUser {
    pub id: String,
    pub email: String,
    pub display_name: String,
    pub identity_type: IdentityType,
    pub group_id: String,
}

#[derive(Clone, Debug)]
struct CsvUserRow {
    email: String,
    display_name: String,
    identity_type: IdentityType,
    group_slug: String,
}

#[derive(Clone)]
pub struct ProvisioningService {
    pool: SqlitePool,
    authorization: AuthorizationService,
}

impl ProvisioningService {
    pub fn new(pool: SqlitePool) -> Self {
        Self {
            authorization: AuthorizationService::new(pool.clone()),
            pool,
        }
    }

    pub async fn preview_csv(
        &self,
        principal: &Principal,
        target_group_id: &str,
        csv: &str,
    ) -> Result<CsvPreview, AppError> {
        self.authorization
            .require(principal, target_group_id, Capability::MembersManage)
            .await?;
        let mut reader = csv::ReaderBuilder::new()
            .trim(csv::Trim::All)
            .from_reader(csv.as_bytes());
        let headers = reader
            .headers()
            .map_err(|error| AppError::BadRequest(format!("invalid CSV header: {error}")))?;
        if headers.iter().collect::<Vec<_>>()
            != ["email", "display_name", "identity_type", "group_slug"]
        {
            return Err(AppError::BadRequest(
                "CSV columns must be email,display_name,identity_type,group_slug".into(),
            ));
        }
        let mut preview = CsvPreview {
            valid_rows: 0,
            errors: Vec::new(),
        };
        for (index, record) in reader.records().enumerate() {
            let row = index + 2;
            let record = match record {
                Ok(record) => record,
                Err(error) => {
                    preview.errors.push(CsvRowError {
                        row,
                        message: error.to_string(),
                    });
                    continue;
                }
            };
            let email = record.get(0).unwrap_or_default();
            let display_name = record.get(1).unwrap_or_default();
            let identity_type = record.get(2).unwrap_or_default();
            let group_slug = record.get(3).unwrap_or_default();
            let mut messages = Vec::new();
            if !valid_email(email) {
                messages.push("invalid email");
            }
            if display_name.is_empty() {
                messages.push("display_name is required");
            }
            if parse_identity_type(identity_type).is_none() {
                messages.push("invalid identity_type");
            }
            if !self.slug_is_in_subtree(target_group_id, group_slug).await? {
                messages.push("group_slug is outside the target subtree");
            }
            if messages.is_empty() {
                preview.valid_rows += 1;
            } else {
                preview.errors.push(CsvRowError {
                    row,
                    message: messages.join(", "),
                });
            }
        }
        Ok(preview)
    }

    pub async fn import_csv(
        &self,
        principal: &Principal,
        target_group_id: &str,
        csv: &str,
        idempotency_key: &str,
    ) -> Result<CsvImportResult, AppError> {
        if idempotency_key.trim().is_empty() || idempotency_key.len() > 200 {
            return Err(AppError::BadRequest("invalid idempotency key".into()));
        }
        let preview = self.preview_csv(principal, target_group_id, csv).await?;
        if !preview.errors.is_empty() {
            return Err(AppError::BadRequest(format!(
                "CSV contains {} invalid row(s)",
                preview.errors.len()
            )));
        }
        let rows = parse_csv_rows(csv)?;
        let mut transaction = self
            .pool
            .begin_with("BEGIN IMMEDIATE")
            .await
            .map_err(database_error)?;
        self.authorization
            .require_in_transaction(
                &mut transaction,
                principal,
                target_group_id,
                Capability::MembersManage,
            )
            .await?;
        if let Some(row) = sqlx::query("SELECT actor_user_id, target_group_id, result_json FROM provisioning_imports WHERE idempotency_key = ?")
            .bind(idempotency_key).fetch_optional(&mut *transaction).await.map_err(database_error)?
        {
            if row.get::<String, _>("actor_user_id") != principal.user_id
                || row.get::<String, _>("target_group_id") != target_group_id
            {
                return Err(AppError::Conflict("idempotency key was used for another import".into()));
            }
            let mut result: CsvImportResult = serde_json::from_str(row.get("result_json"))
                .map_err(|error| AppError::Internal(format!("invalid persisted import result: {error}")))?;
            result.replayed = true;
            transaction.commit().await.map_err(database_error)?;
            return Ok(result);
        }

        let mut result = CsvImportResult {
            import_id: Uuid::now_v7().to_string(),
            created_users: 0,
            updated_users: 0,
            memberships_created: 0,
            replayed: false,
        };
        for row in rows {
            let group_id =
                resolve_group_in_subtree(&mut transaction, target_group_id, &row.group_slug)
                    .await?
                    .ok_or_else(|| {
                        AppError::BadRequest("group_slug is outside the target subtree".into())
                    })?;
            let normalized_email = normalize_email(&row.email);
            let existing = sqlx::query("SELECT id, is_root FROM users WHERE normalized_email = ?")
                .bind(&normalized_email)
                .fetch_optional(&mut *transaction)
                .await
                .map_err(database_error)?;
            let (user_id, action) = if let Some(existing) = existing {
                if existing.get::<i64, _>("is_root") == 1 {
                    return Err(AppError::BadRequest(
                        "CSV import cannot modify the root administrator".into(),
                    ));
                }
                let user_id: String = existing.get("id");
                sqlx::query("UPDATE users SET email = ?, display_name = ?, identity_type = ?, updated_at = ? WHERE id = ?")
                    .bind(row.email.trim()).bind(&row.display_name).bind(identity_type_str(&row.identity_type))
                    .bind(now()).bind(&user_id).execute(&mut *transaction).await.map_err(database_error)?;
                result.updated_users += 1;
                (user_id, "user.updated")
            } else {
                let user_id = Uuid::now_v7().to_string();
                sqlx::query("INSERT INTO users (id, email, normalized_email, display_name, status, identity_type, is_root, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, 0, ?, ?)")
                    .bind(&user_id).bind(row.email.trim()).bind(&normalized_email).bind(&row.display_name)
                    .bind(identity_type_str(&row.identity_type)).bind(now()).bind(now())
                    .execute(&mut *transaction).await.map_err(database_error)?;
                result.created_users += 1;
                (user_id, "user.created")
            };
            insert_audit(
                &mut transaction,
                Some(&principal.user_id),
                action,
                "user",
                &user_id,
                &group_id,
                Some(idempotency_key),
                None,
            )
            .await?;
            let membership_exists: i64 = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM group_memberships WHERE group_id = ? AND user_id = ? AND status != 'archived')")
                .bind(&group_id).bind(&user_id).fetch_one(&mut *transaction).await.map_err(database_error)?;
            if membership_exists == 0 {
                let membership_id = Uuid::now_v7().to_string();
                sqlx::query("INSERT INTO group_memberships (id, group_id, user_id, invited_email, status, created_at, archived_at) VALUES (?, ?, ?, NULL, 'active', ?, NULL)")
                    .bind(&membership_id).bind(&group_id).bind(&user_id).bind(now())
                    .execute(&mut *transaction).await.map_err(database_error)?;
                result.memberships_created += 1;
                insert_audit(
                    &mut transaction,
                    Some(&principal.user_id),
                    "membership.created",
                    "group_membership",
                    &membership_id,
                    &group_id,
                    Some(idempotency_key),
                    None,
                )
                .await?;
            }
        }
        insert_audit(
            &mut transaction, Some(&principal.user_id), "provisioning.csv_imported", "provisioning_import",
            &result.import_id, target_group_id, Some(idempotency_key),
            Some(serde_json::json!({"createdUsers": result.created_users, "updatedUsers": result.updated_users, "membershipsCreated": result.memberships_created}).to_string()),
        ).await?;
        sqlx::query("INSERT INTO provisioning_imports (id, idempotency_key, actor_user_id, target_group_id, result_json, created_at) VALUES (?, ?, ?, ?, ?, ?)")
            .bind(&result.import_id).bind(idempotency_key).bind(&principal.user_id).bind(target_group_id)
            .bind(serde_json::to_string(&result).map_err(|error| AppError::Internal(error.to_string()))?).bind(now())
            .execute(&mut *transaction).await.map_err(database_error)?;
        transaction.commit().await.map_err(database_error)?;
        Ok(result)
    }

    pub async fn create_invitation(
        &self,
        principal: &Principal,
        group_id: &str,
        email: &str,
        identity_type: IdentityType,
        capabilities: Vec<Capability>,
        expires_at: i64,
    ) -> Result<CreatedInvitation, AppError> {
        if !valid_email(email) {
            return Err(AppError::BadRequest("invalid invitation email".into()));
        }
        self.create_access_token(
            principal,
            group_id,
            Some(normalize_email(email)),
            identity_type,
            capabilities,
            expires_at,
            1,
            "invitation",
        )
        .await
    }

    pub async fn create_join_code(
        &self,
        principal: &Principal,
        group_id: &str,
        identity_type: IdentityType,
        capabilities: Vec<Capability>,
        expires_at: i64,
        max_uses: i64,
    ) -> Result<CreatedInvitation, AppError> {
        if capabilities.iter().any(is_management_capability) {
            return Err(AppError::BadRequest(
                "join codes cannot grant management capabilities".into(),
            ));
        }
        if max_uses <= 0 {
            return Err(AppError::BadRequest("max_uses must be positive".into()));
        }
        self.create_access_token(
            principal,
            group_id,
            None,
            identity_type,
            capabilities,
            expires_at,
            max_uses,
            "join_code",
        )
        .await
    }

    pub async fn accept_invitation(
        &self,
        secret: &str,
        email: &str,
        display_name: &str,
    ) -> Result<ProvisionedUser, AppError> {
        if !valid_email(email) || display_name.trim().is_empty() {
            return Err(AppError::BadRequest(
                "valid email and display name are required".into(),
            ));
        }
        let mut transaction = self
            .pool
            .begin_with("BEGIN IMMEDIATE")
            .await
            .map_err(database_error)?;
        let invitation = sqlx::query("SELECT id, group_id, invited_email, identity_type, kind, max_uses, use_count FROM invitations WHERE token_hash = ? AND status = 'active' AND expires_at > ?")
            .bind(hash_secret(secret)).bind(now()).fetch_optional(&mut *transaction).await.map_err(database_error)?
            .ok_or(AppError::Unauthorized)?;
        let normalized_email = normalize_email(email);
        let invited_email: Option<String> = invitation.get("invited_email");
        if invited_email
            .as_deref()
            .is_some_and(|intended| intended != normalized_email)
        {
            return Err(AppError::Forbidden(
                "invitation is intended for another email".into(),
            ));
        }
        let identity_type = parse_identity_type(invitation.get("identity_type"))
            .ok_or_else(|| AppError::Internal("invalid invitation identity type".into()))?;
        let group_id: String = invitation.get("group_id");
        let invitation_id: String = invitation.get("id");
        let existing =
            sqlx::query("SELECT id, identity_type, is_root FROM users WHERE normalized_email = ?")
                .bind(&normalized_email)
                .fetch_optional(&mut *transaction)
                .await
                .map_err(database_error)?;
        let user_id = if let Some(existing) = existing {
            if existing.get::<i64, _>("is_root") == 1
                || existing.get::<String, _>("identity_type") != identity_type_str(&identity_type)
            {
                return Err(AppError::Conflict(
                    "existing account is incompatible with invitation".into(),
                ));
            }
            existing.get("id")
        } else {
            let user_id = Uuid::now_v7().to_string();
            sqlx::query("INSERT INTO users (id, email, normalized_email, display_name, status, identity_type, is_root, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, 0, ?, ?)")
                .bind(&user_id).bind(email.trim()).bind(&normalized_email).bind(display_name.trim())
                .bind(identity_type_str(&identity_type)).bind(now()).bind(now())
                .execute(&mut *transaction).await.map_err(database_error)?;
            user_id
        };
        let membership_id = Uuid::now_v7().to_string();
        sqlx::query("INSERT INTO group_memberships (id, group_id, user_id, invited_email, status, created_at, archived_at) VALUES (?, ?, ?, NULL, 'active', ?, NULL)")
            .bind(&membership_id).bind(&group_id).bind(&user_id).bind(now())
            .execute(&mut *transaction).await.map_err(map_membership_error)?;
        let capabilities: Vec<String> = sqlx::query_scalar(
            "SELECT capability FROM invitation_capabilities WHERE invitation_id = ?",
        )
        .bind(&invitation_id)
        .fetch_all(&mut *transaction)
        .await
        .map_err(database_error)?;
        for capability in capabilities {
            sqlx::query(
                "INSERT INTO membership_capabilities (membership_id, capability) VALUES (?, ?)",
            )
            .bind(&membership_id)
            .bind(capability)
            .execute(&mut *transaction)
            .await
            .map_err(database_error)?;
        }
        let use_count = invitation.get::<i64, _>("use_count") + 1;
        let status = if use_count >= invitation.get::<i64, _>("max_uses") {
            "accepted"
        } else {
            "active"
        };
        sqlx::query("UPDATE invitations SET use_count = ?, status = ? WHERE id = ?")
            .bind(use_count)
            .bind(status)
            .bind(&invitation_id)
            .execute(&mut *transaction)
            .await
            .map_err(database_error)?;
        insert_audit(
            &mut transaction,
            Some(&user_id),
            "invitation.accepted",
            "invitation",
            &invitation_id,
            &group_id,
            None,
            Some(serde_json::json!({"kind": invitation.get::<String, _>("kind")}).to_string()),
        )
        .await?;
        transaction.commit().await.map_err(database_error)?;
        Ok(ProvisionedUser {
            id: user_id,
            email: email.trim().to_string(),
            display_name: display_name.trim().to_string(),
            identity_type,
            group_id,
        })
    }

    #[allow(clippy::too_many_arguments)]
    async fn create_access_token(
        &self,
        principal: &Principal,
        group_id: &str,
        invited_email: Option<String>,
        identity_type: IdentityType,
        capabilities: Vec<Capability>,
        expires_at: i64,
        max_uses: i64,
        kind: &str,
    ) -> Result<CreatedInvitation, AppError> {
        if expires_at <= now() {
            return Err(AppError::BadRequest("expiry must be in the future".into()));
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
                Capability::MembersManage,
            )
            .await?;
        if !capabilities.is_empty() {
            self.authorization
                .require_in_transaction(
                    &mut transaction,
                    principal,
                    group_id,
                    Capability::PermissionsDelegate,
                )
                .await?;
        }
        for capability in &capabilities {
            self.authorization
                .require_in_transaction(&mut transaction, principal, group_id, *capability)
                .await?;
        }
        let mut bytes = [0u8; 32];
        OsRng.fill_bytes(&mut bytes);
        let prefix = if kind == "join_code" {
            "mljoin_"
        } else {
            "mlinv_"
        };
        let created = CreatedInvitation {
            id: Uuid::now_v7().to_string(),
            group_id: group_id.to_string(),
            expires_at,
            secret: format!("{prefix}{}", URL_SAFE_NO_PAD.encode(bytes)),
        };
        sqlx::query("INSERT INTO invitations (id, group_id, invited_email, identity_type, token_hash, kind, expires_at, max_uses, use_count, status, created_by_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'active', ?, ?)")
            .bind(&created.id).bind(group_id).bind(&invited_email).bind(identity_type_str(&identity_type))
            .bind(hash_secret(&created.secret)).bind(kind).bind(expires_at).bind(max_uses).bind(&principal.user_id).bind(now())
            .execute(&mut *transaction).await.map_err(database_error)?;
        let mut unique = HashSet::new();
        for capability in capabilities {
            if unique.insert(capability) {
                sqlx::query(
                    "INSERT INTO invitation_capabilities (invitation_id, capability) VALUES (?, ?)",
                )
                .bind(&created.id)
                .bind(capability.as_str())
                .execute(&mut *transaction)
                .await
                .map_err(database_error)?;
            }
        }
        let metadata = serde_json::json!({
            "emailHash": invited_email.as_deref().map(hash_secret),
            "identityType": identity_type_str(&identity_type), "expiresAt": expires_at, "maxUses": max_uses
        }).to_string();
        insert_audit(
            &mut transaction,
            Some(&principal.user_id),
            if kind == "join_code" {
                "join_code.created"
            } else {
                "invitation.created"
            },
            kind,
            &created.id,
            group_id,
            None,
            Some(metadata),
        )
        .await?;
        transaction.commit().await.map_err(database_error)?;
        Ok(created)
    }

    async fn slug_is_in_subtree(
        &self,
        target_group_id: &str,
        slug: &str,
    ) -> Result<bool, AppError> {
        let found: i64 = sqlx::query_scalar(
            "WITH RECURSIVE subtree(id, slug) AS (
                SELECT id, slug FROM groups WHERE id = ? AND status != 'archived'
                UNION ALL
                SELECT child.id, child.slug FROM groups child
                JOIN subtree parent ON child.parent_id = parent.id
                WHERE child.status != 'archived'
            ) SELECT EXISTS(SELECT 1 FROM subtree WHERE slug = ?)",
        )
        .bind(target_group_id)
        .bind(slug)
        .fetch_one(&self.pool)
        .await
        .map_err(database_error)?;
        Ok(found == 1)
    }
}

fn parse_csv_rows(value: &str) -> Result<Vec<CsvUserRow>, AppError> {
    let mut reader = csv::ReaderBuilder::new()
        .trim(csv::Trim::All)
        .from_reader(value.as_bytes());
    let headers = reader
        .headers()
        .map_err(|error| AppError::BadRequest(format!("invalid CSV header: {error}")))?;
    if headers.iter().collect::<Vec<_>>()
        != ["email", "display_name", "identity_type", "group_slug"]
    {
        return Err(AppError::BadRequest(
            "CSV columns must be email,display_name,identity_type,group_slug".into(),
        ));
    }
    reader
        .records()
        .map(|record| {
            let record = record
                .map_err(|error| AppError::BadRequest(format!("invalid CSV row: {error}")))?;
            Ok(CsvUserRow {
                email: record.get(0).unwrap_or_default().to_string(),
                display_name: record.get(1).unwrap_or_default().to_string(),
                identity_type: parse_identity_type(record.get(2).unwrap_or_default())
                    .ok_or_else(|| AppError::BadRequest("invalid identity_type".into()))?,
                group_slug: record.get(3).unwrap_or_default().to_string(),
            })
        })
        .collect()
}

async fn resolve_group_in_subtree(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    target_group_id: &str,
    slug: &str,
) -> Result<Option<String>, AppError> {
    sqlx::query_scalar(
        "WITH RECURSIVE subtree(id, slug) AS (
            SELECT id, slug FROM groups WHERE id = ? AND status != 'archived'
            UNION ALL SELECT child.id, child.slug FROM groups child
            JOIN subtree parent ON child.parent_id = parent.id WHERE child.status != 'archived'
        ) SELECT id FROM subtree WHERE slug = ? ORDER BY id LIMIT 1",
    )
    .bind(target_group_id)
    .bind(slug)
    .fetch_optional(&mut **transaction)
    .await
    .map_err(database_error)
}

#[allow(clippy::too_many_arguments)]
async fn insert_audit(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    actor_user_id: Option<&str>,
    action: &str,
    target_type: &str,
    target_id: &str,
    authorized_group_id: &str,
    request_id: Option<&str>,
    metadata: Option<String>,
) -> Result<(), AppError> {
    sqlx::query("INSERT INTO audit_events (id, actor_user_id, action, target_type, target_id, metadata_json, created_at, authorized_group_id, request_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(Uuid::now_v7().to_string()).bind(actor_user_id).bind(action).bind(target_type).bind(target_id)
        .bind(metadata).bind(now()).bind(authorized_group_id).bind(request_id)
        .execute(&mut **transaction).await.map_err(database_error)?;
    Ok(())
}

fn parse_identity_type(value: &str) -> Option<IdentityType> {
    match value {
        "admin" => Some(IdentityType::Admin),
        "teacher" => Some(IdentityType::Teacher),
        "learner" => Some(IdentityType::Learner),
        _ => None,
    }
}

fn identity_type_str(value: &IdentityType) -> &'static str {
    match value {
        IdentityType::Admin => "admin",
        IdentityType::Teacher => "teacher",
        IdentityType::Learner => "learner",
    }
}

fn normalize_email(value: &str) -> String {
    value.trim().to_ascii_lowercase()
}

fn hash_secret(secret: &str) -> String {
    hex::encode(Sha256::digest(secret.as_bytes()))
}

fn is_management_capability(capability: &Capability) -> bool {
    matches!(
        capability,
        Capability::GroupManage
            | Capability::MembersManage
            | Capability::PermissionsDelegate
            | Capability::PoliciesEdit
            | Capability::PoliciesPublish
            | Capability::ConversationsExport
            | Capability::LlmConfigure
            | Capability::ApiKeysManage
    )
}

fn valid_email(value: &str) -> bool {
    let mut parts = value.split('@');
    matches!((parts.next(), parts.next(), parts.next()), (Some(local), Some(domain), None) if !local.is_empty() && domain.contains('.'))
}

fn database_error(error: sqlx::Error) -> AppError {
    AppError::Internal(format!("database error: {error}"))
}

fn map_membership_error(error: sqlx::Error) -> AppError {
    if error
        .as_database_error()
        .is_some_and(|database| database.is_unique_violation())
    {
        AppError::Conflict("user already has a membership in this group".into())
    } else {
        database_error(error)
    }
}

fn now() -> i64 {
    OffsetDateTime::now_utc().unix_timestamp()
}

#[cfg(test)]
mod tests {
    use time::OffsetDateTime;

    use crate::{
        authorization::Capability, error::AppError, groups::tests::GroupFixture,
        identity::IdentityType,
    };

    const CSV: &str = "email,display_name,identity_type,group_slug\nlearner@example.test,Learner,learner,german-b\n";

    #[tokio::test]
    async fn teacher_import_cannot_target_sibling_group() {
        let fixture = GroupFixture::german_tree().await;
        let service = super::ProvisioningService::new(fixture.pool.clone());

        let result = service
            .preview_csv(&fixture.german_a_teacher, &fixture.german_b, CSV)
            .await;

        assert!(matches!(result, Err(AppError::Forbidden(_))));
    }

    #[tokio::test]
    async fn preview_reports_row_errors_without_writing() {
        let fixture = GroupFixture::german_tree().await;
        let service = super::ProvisioningService::new(fixture.pool.clone());
        let before: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
            .fetch_one(&fixture.pool)
            .await
            .unwrap();

        let preview = service
            .preview_csv(
                &fixture.german_a_teacher,
                &fixture.german_a,
                "email,display_name,identity_type,group_slug\nbad,,owner,german-a\n",
            )
            .await
            .unwrap();

        assert_eq!(preview.valid_rows, 0);
        assert_eq!(preview.errors[0].row, 2);
        let after: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
            .fetch_one(&fixture.pool)
            .await
            .unwrap();
        assert_eq!(before, after);
    }

    #[tokio::test]
    async fn import_is_idempotent_and_audits_user_and_membership_atomically() {
        let fixture = GroupFixture::german_tree().await;
        let service = super::ProvisioningService::new(fixture.pool.clone());
        let csv = "email,display_name,identity_type,group_slug\nlearner@example.test,Learner,learner,german-a\n";
        let first = service
            .import_csv(
                &fixture.german_a_teacher,
                &fixture.german_a,
                csv,
                "import-1",
            )
            .await
            .unwrap();
        let second = service
            .import_csv(
                &fixture.german_a_teacher,
                &fixture.german_a,
                csv,
                "import-1",
            )
            .await
            .unwrap();

        assert_eq!(first.import_id, second.import_id);
        assert!(second.replayed);
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM users WHERE normalized_email = 'learner@example.test'",
            )
            .fetch_one(&fixture.pool)
            .await
            .unwrap(),
            1
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM audit_events WHERE request_id = 'import-1'",
            )
            .fetch_one(&fixture.pool)
            .await
            .unwrap(),
            3
        );
    }

    #[tokio::test]
    async fn invitation_acceptance_checks_email_expiry_and_capability_ceiling() {
        let fixture = GroupFixture::german_tree().await;
        let service = super::ProvisioningService::new(fixture.pool.clone());
        let invitation = service
            .create_invitation(
                &fixture.german_a_teacher,
                &fixture.german_a,
                "invited@example.test",
                IdentityType::Learner,
                vec![Capability::GroupView],
                OffsetDateTime::now_utc().unix_timestamp() + 3600,
            )
            .await
            .unwrap();

        assert!(matches!(
            service
                .accept_invitation(&invitation.secret, "other@example.test", "Other")
                .await,
            Err(AppError::Forbidden(_))
        ));
        let accepted = service
            .accept_invitation(&invitation.secret, "invited@example.test", "Invited")
            .await
            .unwrap();
        assert_eq!(accepted.identity_type, IdentityType::Learner);

        let overreach = service
            .create_invitation(
                &fixture.german_a_teacher,
                &fixture.german_a,
                "admin@example.test",
                IdentityType::Admin,
                vec![Capability::PoliciesPublish],
                OffsetDateTime::now_utc().unix_timestamp() + 3600,
            )
            .await;
        assert!(matches!(overreach, Err(AppError::Forbidden(_))));
    }

    #[tokio::test]
    async fn join_codes_reject_management_capabilities() {
        let fixture = GroupFixture::german_tree().await;
        let service = super::ProvisioningService::new(fixture.pool.clone());
        let result = service
            .create_join_code(
                &fixture.german_a_teacher,
                &fixture.german_a,
                IdentityType::Teacher,
                vec![Capability::MembersManage],
                OffsetDateTime::now_utc().unix_timestamp() + 3600,
                10,
            )
            .await;

        assert!(matches!(result, Err(AppError::BadRequest(_))));
    }
}
