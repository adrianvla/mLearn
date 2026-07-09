use sha2::{Digest, Sha256};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::{authorization::Capability, error::AppError, identity::IdentityType};

#[allow(clippy::too_many_arguments)]
pub(super) async fn insert_audit(
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

pub(super) fn parse_identity_type(value: &str) -> Option<IdentityType> {
    match value {
        "admin" => Some(IdentityType::Admin),
        "teacher" => Some(IdentityType::Teacher),
        "learner" => Some(IdentityType::Learner),
        _ => None,
    }
}

pub(super) fn identity_type_str(value: &IdentityType) -> &'static str {
    match value {
        IdentityType::Admin => "admin",
        IdentityType::Teacher => "teacher",
        IdentityType::Learner => "learner",
    }
}

pub(super) fn normalize_email(value: &str) -> String {
    value.trim().to_ascii_lowercase()
}

pub(super) fn hash_secret(secret: &str) -> String {
    hex::encode(Sha256::digest(secret.as_bytes()))
}

pub(super) fn is_management_capability(capability: &Capability) -> bool {
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

pub(super) fn valid_email(value: &str) -> bool {
    let mut parts = value.split('@');
    matches!((parts.next(), parts.next(), parts.next()), (Some(local), Some(domain), None) if !local.is_empty() && domain.contains('.'))
}

pub(super) fn database_error(error: sqlx::Error) -> AppError {
    AppError::Internal(format!("database error: {error}"))
}

pub(super) fn map_membership_error(error: sqlx::Error) -> AppError {
    if error
        .as_database_error()
        .is_some_and(|database| database.is_unique_violation())
    {
        AppError::Conflict("user already has a membership in this group".into())
    } else {
        database_error(error)
    }
}

pub(super) fn now() -> i64 {
    OffsetDateTime::now_utc().unix_timestamp()
}
