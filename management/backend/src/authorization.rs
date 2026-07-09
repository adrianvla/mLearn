use serde::{Deserialize, Serialize};
use sqlx::{Sqlite, SqlitePool, Transaction};

use crate::{error::AppError, identity::Principal};

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum Capability {
    #[serde(rename = "group.view")]
    GroupView,
    #[serde(rename = "group.manage")]
    GroupManage,
    #[serde(rename = "members.view")]
    MembersView,
    #[serde(rename = "members.manage")]
    MembersManage,
    #[serde(rename = "permissions.delegate")]
    PermissionsDelegate,
    #[serde(rename = "policies.view")]
    PoliciesView,
    #[serde(rename = "policies.edit")]
    PoliciesEdit,
    #[serde(rename = "policies.publish")]
    PoliciesPublish,
    #[serde(rename = "analytics.view")]
    AnalyticsView,
    #[serde(rename = "conversations.view")]
    ConversationsView,
    #[serde(rename = "conversations.export")]
    ConversationsExport,
    #[serde(rename = "llm.configure")]
    LlmConfigure,
    #[serde(rename = "api_keys.manage")]
    ApiKeysManage,
}

impl Capability {
    pub const ALL: [Self; 13] = [
        Self::GroupView,
        Self::GroupManage,
        Self::MembersView,
        Self::MembersManage,
        Self::PermissionsDelegate,
        Self::PoliciesView,
        Self::PoliciesEdit,
        Self::PoliciesPublish,
        Self::AnalyticsView,
        Self::ConversationsView,
        Self::ConversationsExport,
        Self::LlmConfigure,
        Self::ApiKeysManage,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::GroupView => "group.view",
            Self::GroupManage => "group.manage",
            Self::MembersView => "members.view",
            Self::MembersManage => "members.manage",
            Self::PermissionsDelegate => "permissions.delegate",
            Self::PoliciesView => "policies.view",
            Self::PoliciesEdit => "policies.edit",
            Self::PoliciesPublish => "policies.publish",
            Self::AnalyticsView => "analytics.view",
            Self::ConversationsView => "conversations.view",
            Self::ConversationsExport => "conversations.export",
            Self::LlmConfigure => "llm.configure",
            Self::ApiKeysManage => "api_keys.manage",
        }
    }
}

#[derive(Clone)]
pub struct AuthorizationService {
    pool: SqlitePool,
}

impl AuthorizationService {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub async fn require(
        &self,
        principal: &Principal,
        group_id: &str,
        capability: Capability,
    ) -> Result<(), AppError> {
        let authorized: i64 = sqlx::query_scalar(
            "WITH RECURSIVE ancestors(id, parent_id) AS (
                SELECT id, parent_id FROM groups WHERE id = ? AND status != 'archived'
                UNION ALL
                SELECT parent.id, parent.parent_id
                FROM groups parent JOIN ancestors child ON child.parent_id = parent.id
                WHERE parent.status != 'archived'
            )
            SELECT EXISTS(
                SELECT 1 FROM ancestors
                JOIN group_memberships membership ON membership.group_id = ancestors.id
                JOIN membership_capabilities capability ON capability.membership_id = membership.id
                WHERE membership.user_id = ? AND membership.status = 'active'
                  AND capability.capability = ?
            )",
        )
        .bind(group_id)
        .bind(&principal.user_id)
        .bind(capability.as_str())
        .fetch_one(&self.pool)
        .await
        .map_err(database_error)?;

        if authorized == 1 {
            Ok(())
        } else {
            Err(AppError::Forbidden(format!(
                "{} is required for group {group_id}",
                capability.as_str()
            )))
        }
    }

    pub(crate) async fn require_in_transaction(
        &self,
        transaction: &mut Transaction<'_, Sqlite>,
        principal: &Principal,
        group_id: &str,
        capability: Capability,
    ) -> Result<(), AppError> {
        let authorized: i64 = sqlx::query_scalar(
            "WITH RECURSIVE ancestors(id, parent_id) AS (
                SELECT id, parent_id FROM groups WHERE id = ? AND status != 'archived'
                UNION ALL
                SELECT parent.id, parent.parent_id
                FROM groups parent JOIN ancestors child ON child.parent_id = parent.id
                WHERE parent.status != 'archived'
            )
            SELECT EXISTS(
                SELECT 1 FROM ancestors
                JOIN group_memberships membership ON membership.group_id = ancestors.id
                JOIN membership_capabilities capability ON capability.membership_id = membership.id
                WHERE membership.user_id = ? AND membership.status = 'active'
                  AND capability.capability = ?
            )",
        )
        .bind(group_id)
        .bind(&principal.user_id)
        .bind(capability.as_str())
        .fetch_one(&mut **transaction)
        .await
        .map_err(database_error)?;

        if authorized == 1 {
            Ok(())
        } else {
            Err(AppError::Forbidden(format!(
                "{} is required for group {group_id}",
                capability.as_str()
            )))
        }
    }
}

fn database_error(error: sqlx::Error) -> AppError {
    AppError::Internal(format!("database error: {error}"))
}

#[cfg(test)]
mod tests {
    use super::{AuthorizationService, Capability};

    #[tokio::test]
    async fn child_manager_cannot_see_parent_or_sibling() {
        let fixture = crate::groups::tests::GroupFixture::german_tree().await;

        assert!(fixture
            .authz
            .require(
                &fixture.german_a_teacher,
                &fixture.german_a,
                Capability::GroupView
            )
            .await
            .is_ok());
        assert!(fixture
            .authz
            .require(
                &fixture.german_a_teacher,
                &fixture.project_1,
                Capability::GroupView
            )
            .await
            .is_ok());
        assert!(fixture
            .authz
            .require(
                &fixture.german_a_teacher,
                &fixture.german,
                Capability::GroupView
            )
            .await
            .is_err());
        assert!(fixture
            .authz
            .require(
                &fixture.german_a_teacher,
                &fixture.german_b,
                Capability::GroupView
            )
            .await
            .is_err());
    }

    #[test]
    fn capability_strings_are_the_public_contract() {
        assert_eq!(
            serde_json::to_string(&Capability::PermissionsDelegate).unwrap(),
            "\"permissions.delegate\""
        );
        assert_eq!(
            serde_json::to_string(&Capability::ApiKeysManage).unwrap(),
            "\"api_keys.manage\""
        );
    }

    #[allow(dead_code)]
    fn service_is_public(_: AuthorizationService) {}
}
