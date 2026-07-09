use serde::Serialize;
use sqlx::{Row, SqlitePool};
use std::collections::HashSet;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::{
    authorization::{AuthorizationService, Capability},
    error::AppError,
    identity::Principal,
};

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Group {
    pub id: String,
    pub parent_id: Option<String>,
    pub name: String,
    pub slug: String,
    pub status: String,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Membership {
    pub id: String,
    pub group_id: String,
    pub user_id: Option<String>,
    pub invited_email: Option<String>,
    pub status: String,
    pub capabilities: Vec<Capability>,
}

#[derive(Clone)]
pub struct GroupService {
    pool: SqlitePool,
    authorization: AuthorizationService,
}

impl GroupService {
    pub fn new(pool: SqlitePool) -> Self {
        Self {
            authorization: AuthorizationService::new(pool.clone()),
            pool,
        }
    }

    pub async fn create_group(
        &self,
        principal: &Principal,
        parent_id: &str,
        name: &str,
        slug: &str,
    ) -> Result<Group, AppError> {
        self.authorization
            .require(principal, parent_id, Capability::GroupManage)
            .await?;
        validate_group_fields(name, slug)?;
        let group = Group {
            id: Uuid::now_v7().to_string(),
            parent_id: Some(parent_id.to_string()),
            name: name.trim().to_string(),
            slug: slug.trim().to_string(),
            status: "active".into(),
        };
        let mut transaction = self.pool.begin().await.map_err(database_error)?;
        sqlx::query("INSERT INTO groups (id, parent_id, name, slug, status, created_at, archived_at) VALUES (?, ?, ?, ?, 'active', ?, NULL)")
            .bind(&group.id)
            .bind(parent_id)
            .bind(&group.name)
            .bind(&group.slug)
            .bind(now())
            .execute(&mut *transaction)
            .await
            .map_err(map_group_write_error)?;
        audit(
            &mut transaction,
            principal,
            "group.created",
            "group",
            &group.id,
            None,
        )
        .await?;
        transaction.commit().await.map_err(database_error)?;
        Ok(group)
    }

    pub async fn get_group(
        &self,
        principal: &Principal,
        group_id: &str,
    ) -> Result<Group, AppError> {
        self.authorization
            .require(principal, group_id, Capability::GroupView)
            .await?;
        fetch_group(&self.pool, group_id).await
    }

    pub async fn update_group(
        &self,
        principal: &Principal,
        group_id: &str,
        parent_id: Option<&str>,
        name: &str,
        slug: &str,
    ) -> Result<Group, AppError> {
        self.authorization
            .require(principal, group_id, Capability::GroupManage)
            .await?;
        validate_group_fields(name, slug)?;
        let current_parent: Option<String> = sqlx::query_scalar("SELECT parent_id FROM groups WHERE id = ?")
            .bind(group_id)
            .fetch_one(&self.pool)
            .await
            .map_err(database_error)?;
        if current_parent.is_some() && parent_id.is_none() {
            return Err(AppError::BadRequest("non-root group requires a parent".into()));
        }
        if let Some(parent_id) = parent_id {
            self.authorization
                .require(principal, parent_id, Capability::GroupManage)
                .await?;
            if parent_id == group_id || self.is_descendant(group_id, parent_id).await? {
                return Err(AppError::Conflict("group move would create a cycle".into()));
            }
        }
        let mut transaction = self.pool.begin().await.map_err(database_error)?;
        sqlx::query("UPDATE groups SET parent_id = ?, name = ?, slug = ? WHERE id = ? AND status != 'archived'")
            .bind(parent_id)
            .bind(name.trim())
            .bind(slug.trim())
            .bind(group_id)
            .execute(&mut *transaction)
            .await
            .map_err(map_group_write_error)?;
        audit(
            &mut transaction,
            principal,
            "group.updated",
            "group",
            group_id,
            None,
        )
        .await?;
        transaction.commit().await.map_err(database_error)?;
        fetch_group(&self.pool, group_id).await
    }

    pub async fn archive_group(
        &self,
        principal: &Principal,
        group_id: &str,
    ) -> Result<(), AppError> {
        self.authorization
            .require(principal, group_id, Capability::GroupManage)
            .await?;
        let mut transaction = self.pool.begin().await.map_err(database_error)?;
        let changed = sqlx::query("UPDATE groups SET status = 'archived', archived_at = ? WHERE id = ? AND status != 'archived'")
            .bind(now())
            .bind(group_id)
            .execute(&mut *transaction)
            .await
            .map_err(database_error)?
            .rows_affected();
        if changed == 0 {
            return Err(AppError::Conflict(
                "group is already archived or missing".into(),
            ));
        }
        audit(
            &mut transaction,
            principal,
            "group.archived",
            "group",
            group_id,
            None,
        )
        .await?;
        transaction.commit().await.map_err(database_error)?;
        Ok(())
    }

    pub async fn add_membership(
        &self,
        principal: &Principal,
        group_id: &str,
        member: &Principal,
        capabilities: &[Capability],
    ) -> Result<Membership, AppError> {
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
            self.require_delegable_in_transaction(
                &mut transaction,
                principal,
                group_id,
                capabilities,
            )
            .await?;
        }
        let membership_id = Uuid::now_v7().to_string();
        sqlx::query("INSERT INTO group_memberships (id, group_id, user_id, invited_email, status, created_at, archived_at) VALUES (?, ?, ?, NULL, 'active', ?, NULL)")
            .bind(&membership_id)
            .bind(group_id)
            .bind(&member.user_id)
            .bind(now())
            .execute(&mut *transaction)
            .await
            .map_err(map_group_write_error)?;
        insert_capabilities(&mut transaction, &membership_id, capabilities).await?;
        audit(
            &mut transaction,
            principal,
            "membership.created",
            "group_membership",
            &membership_id,
            None,
        )
        .await?;
        transaction.commit().await.map_err(database_error)?;
        self.membership_by_id(&membership_id).await
    }

    pub async fn delegate_capabilities(
        &self,
        principal: &Principal,
        group_id: &str,
        member: &Principal,
        capabilities: &[Capability],
    ) -> Result<Membership, AppError> {
        let mut transaction = self
            .pool
            .begin_with("BEGIN IMMEDIATE")
            .await
            .map_err(database_error)?;
        self.require_delegable_in_transaction(
            &mut transaction,
            principal,
            group_id,
            capabilities,
        )
        .await?;
        let membership_id: String = sqlx::query_scalar("SELECT id FROM group_memberships WHERE group_id = ? AND user_id = ? AND status = 'active'")
            .bind(group_id)
            .bind(&member.user_id)
            .fetch_optional(&mut *transaction)
            .await
            .map_err(database_error)?
            .ok_or_else(|| AppError::Conflict("active membership not found".into()))?;
        replace_capabilities(&mut transaction, &membership_id, capabilities).await?;
        audit(&mut transaction, principal, "membership.capabilities_delegated", "group_membership", &membership_id, None).await?;
        transaction.commit().await.map_err(database_error)?;
        self.membership_by_id(&membership_id).await
    }

    pub async fn update_membership_capabilities(
        &self,
        principal: &Principal,
        group_id: &str,
        membership_id: &str,
        capabilities: &[Capability],
    ) -> Result<Membership, AppError> {
        let mut transaction = self
            .pool
            .begin_with("BEGIN IMMEDIATE")
            .await
            .map_err(database_error)?;
        self.require_delegable_in_transaction(
            &mut transaction,
            principal,
            group_id,
            capabilities,
        )
        .await?;
        let belongs_to_group: i64 = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM group_memberships WHERE id = ? AND group_id = ? AND status = 'active')",
        )
        .bind(membership_id)
        .bind(group_id)
        .fetch_one(&mut *transaction)
        .await
        .map_err(database_error)?;
        if belongs_to_group != 1 {
            return Err(AppError::Conflict("active membership not found".into()));
        }
        replace_capabilities(&mut transaction, membership_id, capabilities).await?;
        audit(
            &mut transaction,
            principal,
            "membership.capabilities_delegated",
            "group_membership",
            &membership_id,
            None,
        )
        .await?;
        transaction.commit().await.map_err(database_error)?;
        self.membership_by_id(membership_id).await
    }

    pub async fn visible_tree(&self, principal: &Principal) -> Result<Vec<Group>, AppError> {
        let rows = sqlx::query(
            "WITH RECURSIVE visible(id) AS (
                SELECT membership.group_id
                FROM group_memberships membership
                JOIN membership_capabilities capability ON capability.membership_id = membership.id
                JOIN groups source ON source.id = membership.group_id
                WHERE membership.user_id = ? AND membership.status = 'active'
                  AND capability.capability = 'group.view' AND source.status != 'archived'
                UNION
                SELECT child.id FROM groups child JOIN visible parent ON child.parent_id = parent.id
                WHERE child.status != 'archived'
            )
            SELECT groups.id, groups.parent_id, groups.name, groups.slug, groups.status
            FROM groups JOIN visible ON visible.id = groups.id
            ORDER BY groups.name, groups.id",
        )
        .bind(&principal.user_id)
        .fetch_all(&self.pool)
        .await
        .map_err(database_error)?;
        Ok(rows.into_iter().map(group_from_row).collect())
    }

    pub async fn list_memberships(
        &self,
        principal: &Principal,
        group_id: &str,
    ) -> Result<Vec<Membership>, AppError> {
        self.authorization
            .require(principal, group_id, Capability::MembersView)
            .await?;
        let ids: Vec<String> = sqlx::query_scalar("SELECT id FROM group_memberships WHERE group_id = ? AND status != 'archived' ORDER BY created_at")
            .bind(group_id)
            .fetch_all(&self.pool)
            .await
            .map_err(database_error)?;
        let mut memberships = Vec::with_capacity(ids.len());
        for id in ids {
            memberships.push(self.membership_by_id(&id).await?);
        }
        Ok(memberships)
    }

    pub async fn archive_membership(
        &self,
        principal: &Principal,
        group_id: &str,
        membership_id: &str,
    ) -> Result<(), AppError> {
        self.authorization
            .require(principal, group_id, Capability::MembersManage)
            .await?;
        let mut transaction = self.pool.begin().await.map_err(database_error)?;
        let changed = sqlx::query("UPDATE group_memberships SET status = 'archived', archived_at = ? WHERE id = ? AND group_id = ? AND status != 'archived'")
            .bind(now()).bind(membership_id).bind(group_id).execute(&mut *transaction).await.map_err(database_error)?.rows_affected();
        if changed == 0 {
            return Err(AppError::Conflict(
                "membership is archived or missing".into(),
            ));
        }
        audit(
            &mut transaction,
            principal,
            "membership.archived",
            "group_membership",
            membership_id,
            None,
        )
        .await?;
        transaction.commit().await.map_err(database_error)?;
        Ok(())
    }

    pub async fn invite(
        &self,
        principal: &Principal,
        group_id: &str,
        email: &str,
    ) -> Result<Membership, AppError> {
        self.authorization
            .require(principal, group_id, Capability::MembersManage)
            .await?;
        let email = email.trim().to_lowercase();
        if !email.contains('@') {
            return Err(AppError::BadRequest(
                "valid invitation email required".into(),
            ));
        }
        let membership_id = Uuid::now_v7().to_string();
        let mut transaction = self.pool.begin().await.map_err(database_error)?;
        sqlx::query("INSERT INTO group_memberships (id, group_id, user_id, invited_email, status, created_at, archived_at) VALUES (?, ?, NULL, ?, 'invited', ?, NULL)")
            .bind(&membership_id).bind(group_id).bind(&email).bind(now()).execute(&mut *transaction).await.map_err(map_group_write_error)?;
        audit(
            &mut transaction,
            principal,
            "membership.invited",
            "group_membership",
            &membership_id,
            None,
        )
        .await?;
        transaction.commit().await.map_err(database_error)?;
        self.membership_by_id(&membership_id).await
    }

    pub async fn activate(&self, principal: &Principal, group_id: &str) -> Result<(), AppError> {
        self.authorization
            .require(principal, group_id, Capability::GroupView)
            .await?;
        let mut transaction = self.pool.begin().await.map_err(database_error)?;
        sqlx::query("UPDATE sessions SET active_group_id = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL")
            .bind(group_id).bind(&principal.session_id).bind(&principal.user_id).execute(&mut *transaction).await.map_err(database_error)?;
        audit(
            &mut transaction,
            principal,
            "group.activated",
            "group",
            group_id,
            None,
        )
        .await?;
        transaction.commit().await.map_err(database_error)?;
        Ok(())
    }

    async fn require_delegable_in_transaction(
        &self,
        transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
        principal: &Principal,
        group_id: &str,
        capabilities: &[Capability],
    ) -> Result<(), AppError> {
        self.authorization
            .require_in_transaction(
                transaction,
                principal,
                group_id,
                Capability::PermissionsDelegate,
            )
            .await?;
        for capability in capabilities {
            self.authorization
                .require_in_transaction(transaction, principal, group_id, *capability)
                .await?;
        }
        Ok(())
    }

    async fn is_descendant(
        &self,
        ancestor_id: &str,
        possible_descendant_id: &str,
    ) -> Result<bool, AppError> {
        let found: i64 = sqlx::query_scalar(
            "WITH RECURSIVE descendants(id) AS (
                SELECT id FROM groups WHERE parent_id = ?
                UNION ALL SELECT child.id FROM groups child JOIN descendants parent ON child.parent_id = parent.id
            ) SELECT EXISTS(SELECT 1 FROM descendants WHERE id = ?)",
        ).bind(ancestor_id).bind(possible_descendant_id).fetch_one(&self.pool).await.map_err(database_error)?;
        Ok(found == 1)
    }

    async fn membership_by_id(&self, membership_id: &str) -> Result<Membership, AppError> {
        let row = sqlx::query("SELECT id, group_id, user_id, invited_email, status FROM group_memberships WHERE id = ?")
            .bind(membership_id).fetch_optional(&self.pool).await.map_err(database_error)?
            .ok_or_else(|| AppError::Conflict("membership not found".into()))?;
        let capability_values: Vec<String> = sqlx::query_scalar("SELECT capability FROM membership_capabilities WHERE membership_id = ? ORDER BY capability")
            .bind(membership_id).fetch_all(&self.pool).await.map_err(database_error)?;
        let capabilities = Capability::ALL
            .into_iter()
            .filter(|capability| {
                capability_values
                    .iter()
                    .any(|value| value == capability.as_str())
            })
            .collect();
        Ok(Membership {
            id: row.get("id"),
            group_id: row.get("group_id"),
            user_id: row.get("user_id"),
            invited_email: row.get("invited_email"),
            status: row.get("status"),
            capabilities,
        })
    }
}

async fn fetch_group(pool: &SqlitePool, group_id: &str) -> Result<Group, AppError> {
    sqlx::query("SELECT id, parent_id, name, slug, status FROM groups WHERE id = ?")
        .bind(group_id)
        .fetch_optional(pool)
        .await
        .map_err(database_error)?
        .map(group_from_row)
        .ok_or_else(|| AppError::Conflict("group not found".into()))
}

fn group_from_row(row: sqlx::sqlite::SqliteRow) -> Group {
    Group {
        id: row.get("id"),
        parent_id: row.get("parent_id"),
        name: row.get("name"),
        slug: row.get("slug"),
        status: row.get("status"),
    }
}

async fn insert_capabilities(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    membership_id: &str,
    capabilities: &[Capability],
) -> Result<(), AppError> {
    let mut inserted = HashSet::new();
    for capability in capabilities {
        if !inserted.insert(*capability) {
            continue;
        }
        sqlx::query(
            "INSERT INTO membership_capabilities (membership_id, capability) VALUES (?, ?)",
        )
        .bind(membership_id)
        .bind(capability.as_str())
        .execute(&mut **transaction)
        .await
        .map_err(database_error)?;
    }
    Ok(())
}

async fn replace_capabilities(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    membership_id: &str,
    capabilities: &[Capability],
) -> Result<(), AppError> {
    sqlx::query("DELETE FROM membership_capabilities WHERE membership_id = ?")
        .bind(membership_id)
        .execute(&mut **transaction)
        .await
        .map_err(database_error)?;
    insert_capabilities(transaction, membership_id, capabilities).await
}

async fn audit(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    principal: &Principal,
    action: &str,
    target_type: &str,
    target_id: &str,
    metadata: Option<String>,
) -> Result<(), AppError> {
    let authorized_group_id = match target_type {
        "group" => Some(target_id.to_string()),
        "group_membership" => sqlx::query_scalar("SELECT group_id FROM group_memberships WHERE id = ?")
            .bind(target_id)
            .fetch_optional(&mut **transaction)
            .await
            .map_err(database_error)?,
        _ => None,
    };
    sqlx::query("INSERT INTO audit_events (id, actor_user_id, action, target_type, target_id, metadata_json, created_at, authorized_group_id, request_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)")
        .bind(Uuid::now_v7().to_string()).bind(&principal.user_id).bind(action).bind(target_type).bind(target_id).bind(metadata).bind(now()).bind(authorized_group_id)
        .execute(&mut **transaction).await.map_err(database_error)?;
    Ok(())
}

fn validate_group_fields(name: &str, slug: &str) -> Result<(), AppError> {
    if name.trim().is_empty() {
        return Err(AppError::BadRequest("group name is required".into()));
    }
    let slug = slug.trim();
    if slug.is_empty()
        || !slug
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    {
        return Err(AppError::BadRequest(
            "group slug must contain lowercase letters, digits, or hyphens".into(),
        ));
    }
    Ok(())
}

fn now() -> i64 {
    OffsetDateTime::now_utc().unix_timestamp()
}
fn database_error(error: sqlx::Error) -> AppError {
    AppError::Internal(format!("database error: {error}"))
}
fn map_group_write_error(error: sqlx::Error) -> AppError {
    if matches!(&error, sqlx::Error::Database(db) if db.is_unique_violation()) {
        AppError::Conflict("group or membership already exists".into())
    } else {
        database_error(error)
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use crate::{
        authorization::{AuthorizationService, Capability},
        error::AppError,
        identity::{IdentityType, Principal},
    };
    use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
    use std::{str::FromStr, sync::Arc, time::Duration};
    use tokio::sync::Barrier;

    pub(crate) struct GroupFixture {
        pub(crate) pool: sqlx::SqlitePool,
        pub(crate) groups: super::GroupService,
        pub(crate) authz: AuthorizationService,
        pub(crate) german: String,
        pub(crate) german_a: String,
        pub(crate) german_b: String,
        pub(crate) project_1: String,
        pub(crate) german_a_teacher: Principal,
        pub(crate) other_teacher: Principal,
    }

    impl GroupFixture {
        pub(crate) async fn german_tree() -> Self {
            let pool = SqlitePoolOptions::new()
                .max_connections(1)
                .connect("sqlite::memory:")
                .await
                .unwrap();
            sqlx::migrate!("./migrations").run(&pool).await.unwrap();
            let german_a_teacher = principal("teacher-a");
            let other_teacher = principal("teacher-other");
            for principal in [&german_a_teacher, &other_teacher] {
                sqlx::query("INSERT INTO users (id, email, normalized_email, display_name, status, identity_type, is_root, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', 'teacher', 0, 1, 1)")
                    .bind(&principal.user_id).bind(format!("{}@test.invalid", principal.user_id)).bind(format!("{}@test.invalid", principal.user_id)).bind(&principal.user_id).execute(&pool).await.unwrap();
            }
            let german = "german".to_string();
            let german_a = "german-a".to_string();
            let german_b = "german-b".to_string();
            let project_1 = "project-1".to_string();
            for (id, parent, name) in [
                (&german, None, "German"),
                (&german_a, Some(german.as_str()), "German A"),
                (&german_b, Some(german.as_str()), "German B"),
                (&project_1, Some(german_a.as_str()), "Project 1"),
            ] {
                sqlx::query("INSERT INTO groups (id, parent_id, name, slug, status, created_at, archived_at) VALUES (?, ?, ?, ?, 'active', 1, NULL)").bind(id).bind(parent).bind(name).bind(id).execute(&pool).await.unwrap();
            }
            sqlx::query("INSERT INTO group_memberships (id, group_id, user_id, status, created_at) VALUES ('membership-a', ?, ?, 'active', 1)").bind(&german_a).bind(&german_a_teacher.user_id).execute(&pool).await.unwrap();
            for capability in [
                Capability::GroupView,
                Capability::GroupManage,
                Capability::MembersView,
                Capability::MembersManage,
                Capability::PermissionsDelegate,
                Capability::ApiKeysManage,
            ] {
                sqlx::query("INSERT INTO membership_capabilities (membership_id, capability) VALUES ('membership-a', ?)").bind(capability.as_str()).execute(&pool).await.unwrap();
            }
            sqlx::query("INSERT INTO group_memberships (id, group_id, user_id, status, created_at) VALUES ('membership-other', ?, ?, 'active', 1)").bind(&project_1).bind(&other_teacher.user_id).execute(&pool).await.unwrap();
            Self {
                pool: pool.clone(),
                groups: super::GroupService::new(pool.clone()),
                authz: AuthorizationService::new(pool),
                german,
                german_a,
                german_b,
                project_1,
                german_a_teacher,
                other_teacher,
            }
        }
    }

    fn principal(user_id: &str) -> Principal {
        Principal {
            user_id: user_id.into(),
            session_id: format!("session-{user_id}"),
            device_id: format!("device-{user_id}"),
            active_group_id: None,
            identity_type: IdentityType::Teacher,
            is_root: false,
        }
    }

    #[tokio::test]
    async fn delegator_cannot_grant_capability_they_do_not_hold() {
        let fixture = GroupFixture::german_tree().await;
        let result = fixture
            .groups
            .delegate_capabilities(
                &fixture.german_a_teacher,
                &fixture.project_1,
                &fixture.other_teacher,
                &[Capability::LlmConfigure],
            )
            .await;
        assert!(matches!(result, Err(AppError::Forbidden(_))));
    }

    #[tokio::test]
    async fn identity_type_and_root_marker_do_not_imply_group_authority() {
        let fixture = GroupFixture::german_tree().await;
        let unassigned_root = Principal {
            user_id: "unassigned-root".into(),
            session_id: "session".into(),
            device_id: "device".into(),
            active_group_id: None,
            identity_type: IdentityType::Admin,
            is_root: true,
        };
        assert!(matches!(
            fixture
                .authz
                .require(&unassigned_root, &fixture.german, Capability::GroupView)
                .await,
            Err(AppError::Forbidden(_))
        ));
    }

    #[tokio::test]
    async fn update_rejects_a_parent_from_the_groups_own_subtree() {
        let fixture = GroupFixture::german_tree().await;
        let result = fixture
            .groups
            .update_group(
                &fixture.german_a_teacher,
                &fixture.german_a,
                Some(&fixture.project_1),
                "German A",
                "german-a",
            )
            .await;
        assert!(matches!(result, Err(AppError::Conflict(message)) if message.contains("cycle")));
    }

    #[tokio::test]
    async fn visible_tree_contains_only_the_membership_subtree() {
        let fixture = GroupFixture::german_tree().await;
        let visible = fixture
            .groups
            .visible_tree(&fixture.german_a_teacher)
            .await
            .unwrap();
        let ids: Vec<_> = visible.into_iter().map(|group| group.id).collect();

        assert!(ids.contains(&fixture.german_a));
        assert!(ids.contains(&fixture.project_1));
        assert!(!ids.contains(&fixture.german));
        assert!(!ids.contains(&fixture.german_b));
    }

    #[tokio::test]
    async fn failed_audit_rolls_back_group_creation() {
        let fixture = GroupFixture::german_tree().await;
        sqlx::query("CREATE TRIGGER fail_group_audit BEFORE INSERT ON audit_events WHEN NEW.action = 'group.created' BEGIN SELECT RAISE(ABORT, 'injected audit failure'); END")
            .execute(&fixture.groups.pool)
            .await
            .unwrap();

        assert!(fixture
            .groups
            .create_group(
                &fixture.german_a_teacher,
                &fixture.german_a,
                "Rolled Back",
                "rolled-back",
            )
            .await
            .is_err());
        let count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM groups WHERE slug = 'rolled-back'")
                .fetch_one(&fixture.groups.pool)
                .await
                .unwrap();
        assert_eq!(count, 0);
    }

    #[tokio::test]
    async fn concurrent_opposing_moves_allow_only_one_and_keep_recursive_queries_safe() {
        let path = std::env::temp_dir().join(format!("mlearn-groups-{}.db", uuid::Uuid::now_v7()));
        let options = SqliteConnectOptions::from_str(&format!("sqlite://{}", path.display()))
            .unwrap()
            .create_if_missing(true)
            .foreign_keys(true)
            .journal_mode(SqliteJournalMode::Wal)
            .busy_timeout(Duration::from_secs(5));
        let pool = SqlitePoolOptions::new().max_connections(4).connect_with(options).await.unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        for (id, parent) in [("root", None), ("a", Some("root")), ("b", Some("root"))] {
            sqlx::query("INSERT INTO groups (id, parent_id, name, slug, status, created_at) VALUES (?, ?, ?, ?, 'active', 1)")
                .bind(id).bind(parent).bind(id).bind(id).execute(&pool).await.unwrap();
        }
        let barrier = Arc::new(Barrier::new(2));
        let first_pool = pool.clone();
        let first_barrier = barrier.clone();
        let first = tokio::spawn(async move {
            let cycle: i64 = sqlx::query_scalar("WITH RECURSIVE descendants(id) AS (SELECT id FROM groups WHERE parent_id = 'a' UNION ALL SELECT child.id FROM groups child JOIN descendants parent ON child.parent_id = parent.id) SELECT EXISTS(SELECT 1 FROM descendants WHERE id = 'b')")
                .fetch_one(&first_pool).await.unwrap();
            assert_eq!(cycle, 0);
            first_barrier.wait().await;
            sqlx::query("UPDATE groups SET parent_id = 'b' WHERE id = 'a'").execute(&first_pool).await
        });
        let second_pool = pool.clone();
        let second = tokio::spawn(async move {
            let cycle: i64 = sqlx::query_scalar("WITH RECURSIVE descendants(id) AS (SELECT id FROM groups WHERE parent_id = 'b' UNION ALL SELECT child.id FROM groups child JOIN descendants parent ON child.parent_id = parent.id) SELECT EXISTS(SELECT 1 FROM descendants WHERE id = 'a')")
                .fetch_one(&second_pool).await.unwrap();
            assert_eq!(cycle, 0);
            barrier.wait().await;
            sqlx::query("UPDATE groups SET parent_id = 'a' WHERE id = 'b'").execute(&second_pool).await
        });
        let (first, second) = tokio::join!(first, second);
        let results = [first.unwrap(), second.unwrap()];
        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        assert_eq!(results.iter().filter(|result| result.is_err()).count(), 1);
        let count: i64 = sqlx::query_scalar("WITH RECURSIVE tree(id) AS (SELECT id FROM groups WHERE parent_id IS NULL UNION ALL SELECT child.id FROM groups child JOIN tree parent ON child.parent_id = parent.id) SELECT COUNT(*) FROM tree")
            .fetch_one(&pool).await.unwrap();
        assert_eq!(count, 3);
    }

    #[tokio::test]
    async fn database_rejects_a_second_root_group() {
        let fixture = GroupFixture::german_tree().await;
        let result = sqlx::query("INSERT INTO groups (id, parent_id, name, slug, status, created_at) VALUES ('second-root', NULL, 'Second Root', 'second-root', 'active', 1)")
            .execute(&fixture.groups.pool).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn service_rejects_detaching_a_non_root_group() {
        let fixture = GroupFixture::german_tree().await;
        let result = fixture.groups.update_group(&fixture.german_a_teacher, &fixture.german_a, None, "German A", "german-a").await;
        assert!(matches!(result, Err(AppError::BadRequest(message)) if message.contains("parent")));
    }

    #[tokio::test]
    async fn duplicate_capabilities_are_deduplicated() {
        let fixture = GroupFixture::german_tree().await;
        let membership = fixture.groups.add_membership(
            &fixture.german_a_teacher,
            &fixture.german_a,
            &fixture.other_teacher,
            &[Capability::GroupView, Capability::GroupView],
        ).await.unwrap();
        assert_eq!(membership.capabilities, vec![Capability::GroupView]);
    }

    #[tokio::test]
    async fn revocation_that_wins_prevents_concurrent_delegation() {
        let path = std::env::temp_dir().join(format!("mlearn-delegation-{}.db", uuid::Uuid::now_v7()));
        let options = SqliteConnectOptions::from_str(&format!("sqlite://{}", path.display()))
            .unwrap()
            .create_if_missing(true)
            .foreign_keys(true)
            .journal_mode(SqliteJournalMode::Wal)
            .busy_timeout(Duration::from_secs(5));
        let pool = SqlitePoolOptions::new().min_connections(2).max_connections(2).connect_with(options).await.unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        for user in ["delegator", "recipient"] {
            sqlx::query("INSERT INTO users (id, email, normalized_email, display_name, status, identity_type, is_root, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', 'teacher', 0, 1, 1)")
                .bind(user).bind(format!("{user}@test.invalid")).bind(format!("{user}@test.invalid")).bind(user).execute(&pool).await.unwrap();
        }
        sqlx::query("INSERT INTO groups (id, parent_id, name, slug, status, created_at) VALUES ('root', NULL, 'Root', 'root', 'active', 1)").execute(&pool).await.unwrap();
        for (membership, user) in [("delegator-membership", "delegator"), ("recipient-membership", "recipient")] {
            sqlx::query("INSERT INTO group_memberships (id, group_id, user_id, status, created_at) VALUES (?, 'root', ?, 'active', 1)").bind(membership).bind(user).execute(&pool).await.unwrap();
        }
        for capability in [Capability::PermissionsDelegate, Capability::LlmConfigure] {
            sqlx::query("INSERT INTO membership_capabilities (membership_id, capability) VALUES ('delegator-membership', ?)").bind(capability.as_str()).execute(&pool).await.unwrap();
        }
        let service = super::GroupService::new(pool.clone());
        let delegator = principal("delegator");
        let recipient = principal("recipient");

        let mut revocation = pool.begin_with("BEGIN IMMEDIATE").await.unwrap();
        sqlx::query("DELETE FROM membership_capabilities WHERE membership_id = 'delegator-membership' AND capability = 'llm.configure'")
            .execute(&mut *revocation).await.unwrap();
        let delegation = tokio::spawn(async move {
            service.delegate_capabilities(&delegator, "root", &recipient, &[Capability::LlmConfigure]).await
        });
        let mut consecutive_busy_observations = 0;
        for _ in 0..10_000 {
            if pool.num_idle() == 0 {
                consecutive_busy_observations += 1;
                if consecutive_busy_observations == 100 {
                    break;
                }
            } else {
                consecutive_busy_observations = 0;
            }
            tokio::task::yield_now().await;
        }
        assert_eq!(consecutive_busy_observations, 100, "delegation never reached the write boundary");
        revocation.commit().await.unwrap();
        let result = delegation.await.unwrap();

        assert!(matches!(result, Err(AppError::Forbidden(_))));
        let granted: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM membership_capabilities WHERE membership_id = 'recipient-membership' AND capability = 'llm.configure'")
            .fetch_one(&pool).await.unwrap();
        assert_eq!(granted, 0);
    }
}
