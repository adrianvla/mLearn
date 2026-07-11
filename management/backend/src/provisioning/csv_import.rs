use sha2::{Digest, Sha256};
use sqlx::Row;
use uuid::Uuid;

use super::{
    shared::{
        database_error, identity_type_str, insert_audit, normalize_email, now, parse_identity_type,
        valid_email,
    },
    CsvImportResult, CsvPreview, CsvRowError, ProvisioningService,
};
use crate::{
    authorization::Capability,
    error::AppError,
    identity::{IdentityType, Principal},
};

#[derive(Clone, Debug)]
struct CsvUserRow {
    email: String,
    display_name: String,
    identity_type: IdentityType,
    group_slug: String,
}

impl ProvisioningService {
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
            match self
                .slug_match_count_in_subtree(target_group_id, group_slug)
                .await?
            {
                0 => messages.push("group_slug is outside the target subtree"),
                1 => {}
                _ => messages.push("group_slug is ambiguous in the target subtree"),
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
        let payload_hash = canonical_payload_hash(&rows);
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
        if let Some(row) = sqlx::query("SELECT actor_user_id, target_group_id, payload_hash, result_json FROM provisioning_imports WHERE idempotency_key = ?")
            .bind(idempotency_key).fetch_optional(&mut *transaction).await.map_err(database_error)?
        {
            if row.get::<String, _>("actor_user_id") != principal.user_id
                || row.get::<String, _>("target_group_id") != target_group_id
                || row.get::<String, _>("payload_hash") != payload_hash
            {
                return Err(AppError::Conflict(
                    "idempotency key was used for another import payload".into(),
                ));
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
            let existing = sqlx::query("SELECT id, email, display_name, identity_type, is_root FROM users WHERE normalized_email = ?")
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
                let changes_global_fields = existing.get::<String, _>("email") != row.email.trim()
                    || existing.get::<String, _>("display_name") != row.display_name
                    || existing.get::<String, _>("identity_type")
                        != identity_type_str(&row.identity_type);
                if changes_global_fields {
                    let existing_groups: Vec<String> = sqlx::query_scalar(
                        "SELECT group_id FROM group_memberships WHERE user_id = ? AND status = 'active'",
                    )
                    .bind(&user_id)
                    .fetch_all(&mut *transaction)
                    .await
                    .map_err(database_error)?;
                    for existing_group_id in existing_groups {
                        self.authorization
                            .require_in_transaction(
                                &mut transaction,
                                principal,
                                &existing_group_id,
                                Capability::MembersManage,
                            )
                            .await?;
                    }
                    sqlx::query("UPDATE users SET email = ?, display_name = ?, identity_type = ?, updated_at = ? WHERE id = ?")
                        .bind(row.email.trim()).bind(&row.display_name).bind(identity_type_str(&row.identity_type))
                        .bind(now()).bind(&user_id).execute(&mut *transaction).await.map_err(database_error)?;
                    result.updated_users += 1;
                    (user_id, Some("user.updated"))
                } else {
                    (user_id, None)
                }
            } else {
                let user_id = Uuid::now_v7().to_string();
                sqlx::query("INSERT INTO users (id, email, normalized_email, display_name, status, identity_type, is_root, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, 0, ?, ?)")
                    .bind(&user_id).bind(row.email.trim()).bind(&normalized_email).bind(&row.display_name)
                    .bind(identity_type_str(&row.identity_type)).bind(now()).bind(now())
                    .execute(&mut *transaction).await.map_err(database_error)?;
                result.created_users += 1;
                (user_id, Some("user.created"))
            };
            if let Some(action) = action {
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
            }
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
        sqlx::query("INSERT INTO provisioning_imports (id, idempotency_key, actor_user_id, target_group_id, payload_hash, result_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
            .bind(&result.import_id).bind(idempotency_key).bind(&principal.user_id).bind(target_group_id)
            .bind(payload_hash).bind(serde_json::to_string(&result).map_err(|error| AppError::Internal(error.to_string()))?).bind(now())
            .execute(&mut *transaction).await.map_err(database_error)?;
        transaction.commit().await.map_err(database_error)?;
        Ok(result)
    }

    async fn slug_match_count_in_subtree(
        &self,
        target_group_id: &str,
        slug: &str,
    ) -> Result<i64, AppError> {
        let found: i64 = sqlx::query_scalar(
            "WITH RECURSIVE subtree(id, slug) AS (
                SELECT id, slug FROM groups WHERE id = ? AND status != 'archived'
                UNION ALL
                SELECT child.id, child.slug FROM groups child
                JOIN subtree parent ON child.parent_id = parent.id
                WHERE child.status != 'archived'
            ) SELECT COUNT(*) FROM subtree WHERE slug = ?",
        )
        .bind(target_group_id)
        .bind(slug)
        .fetch_one(&self.pool)
        .await
        .map_err(database_error)?;
        Ok(found)
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

fn canonical_payload_hash(rows: &[CsvUserRow]) -> String {
    let mut hasher = Sha256::new();
    hasher.update((rows.len() as u64).to_be_bytes());
    for row in rows {
        for value in [
            normalize_email(&row.email),
            row.display_name.clone(),
            identity_type_str(&row.identity_type).to_string(),
            row.group_slug.clone(),
        ] {
            hasher.update((value.len() as u64).to_be_bytes());
            hasher.update(value.as_bytes());
        }
    }
    hex::encode(hasher.finalize())
}

async fn resolve_group_in_subtree(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    target_group_id: &str,
    slug: &str,
) -> Result<Option<String>, AppError> {
    let matches: Vec<String> = sqlx::query_scalar(
        "WITH RECURSIVE subtree(id, slug) AS (
            SELECT id, slug FROM groups WHERE id = ? AND status != 'archived'
            UNION ALL SELECT child.id, child.slug FROM groups child
            JOIN subtree parent ON child.parent_id = parent.id WHERE child.status != 'archived'
        ) SELECT id FROM subtree WHERE slug = ? ORDER BY id LIMIT 2",
    )
    .bind(target_group_id)
    .bind(slug)
    .fetch_all(&mut **transaction)
    .await
    .map_err(database_error)?;
    match matches.as_slice() {
        [] => Ok(None),
        [group_id] => Ok(Some(group_id.clone())),
        _ => Err(AppError::BadRequest(
            "group_slug is ambiguous in the target subtree".into(),
        )),
    }
}
