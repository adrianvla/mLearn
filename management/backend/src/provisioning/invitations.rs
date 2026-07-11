use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::{rngs::OsRng, RngCore};
use sqlx::Row;
use std::collections::HashSet;
use uuid::Uuid;

use super::{
    shared::{
        database_error, hash_secret, identity_type_str, insert_audit, is_management_capability,
        map_membership_error, normalize_email, now, parse_identity_type, valid_email,
    },
    CreatedInvitation, ProvisionedUser, ProvisioningService,
};
use crate::{
    authorization::Capability,
    error::AppError,
    identity::{IdentityType, Principal},
};

impl ProvisioningService {
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
        let invitation = sqlx::query("SELECT id, group_id, invited_email, identity_type, kind, max_uses, use_count, created_by_user_id FROM invitations WHERE token_hash = ? AND status = 'active' AND expires_at > ?")
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
        let group_is_active: i64 = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM groups WHERE id = ? AND status = 'active')",
        )
        .bind(&group_id)
        .fetch_one(&mut *transaction)
        .await
        .map_err(database_error)?;
        if group_is_active != 1 {
            return Err(AppError::Conflict(
                "invitation target group is not active".into(),
            ));
        }
        let creator_user_id: String = invitation.get("created_by_user_id");
        let creator_is_active: i64 = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM users WHERE id = ? AND status = 'active')",
        )
        .bind(&creator_user_id)
        .fetch_one(&mut *transaction)
        .await
        .map_err(database_error)?;
        if creator_is_active != 1 {
            return Err(AppError::Forbidden(
                "invitation creator is not active".into(),
            ));
        }
        let capabilities: Vec<String> = sqlx::query_scalar(
            "SELECT capability FROM invitation_capabilities WHERE invitation_id = ?",
        )
        .bind(&invitation_id)
        .fetch_all(&mut *transaction)
        .await
        .map_err(database_error)?;
        let creator = Principal {
            user_id: creator_user_id,
            service_key_id: None,
            session_id: String::new(),
            device_id: String::new(),
            active_group_id: Some(group_id.clone()),
            identity_type: IdentityType::Learner,
            is_root: false,
        };
        self.authorization
            .require_in_transaction(
                &mut transaction,
                &creator,
                &group_id,
                Capability::MembersManage,
            )
            .await?;
        self.authorization
            .require_in_transaction(
                &mut transaction,
                &creator,
                &group_id,
                Capability::PermissionsDelegate,
            )
            .await?;
        for capability in &capabilities {
            let capability = Capability::from_str(capability).ok_or_else(|| {
                AppError::Internal("invalid persisted invitation capability".into())
            })?;
            self.authorization
                .require_in_transaction(&mut transaction, &creator, &group_id, capability)
                .await?;
        }
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
        self.authorization
            .require_in_transaction(
                &mut transaction,
                principal,
                group_id,
                Capability::PermissionsDelegate,
            )
            .await?;
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
}
